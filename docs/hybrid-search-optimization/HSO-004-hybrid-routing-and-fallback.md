# HSO-004：建立本地优先、远程可接管的混合搜索路由

**类型**：功能/Web 架构 Issue  
**优先级**：P0  
**依赖**：HSO-002、HSO-003  
**状态**：已完成（2026-08-28）
**建议标签**：`type:feature` `area:web` `area:architecture` `area:reliability` `area:test`

## 要解决的问题

服务端索引和浏览器搜索内核单独存在还不能安全替换当前请求路径。系统需要一个统一路由器读取服务端策略，在本地搜索和旧 Go API 之间选择，处理策略刷新、旧版本兼容、索引失败、过期请求和页内熔断，同时保持现有 Hook 对调用方稳定。

## 要做到什么程度

在根布局挂载唯一 `CharacterSearchProvider`，将 `useCharacterSearch` 改为混合入口。现有调用方尚未提供本地题库版本/范围时仍走远程，因此本 Issue 可以独立部署而不提前切换角色目录或游戏模式。具备完整本地上下文且策略为 `local-primary` 时才使用 HSO-003 内核；任何已冻结故障条件都原参数回退现有 API。路由器必须区分策略瞬时波动、本地瞬时故障和结构性故障，让短故障自行恢复，同时避免永久坏索引每分钟重复拖慢玩家。

## 路由规则

1. 冷启动策略未知、策略结构/兼容错误或 `mode=remote`：远程。
2. 已成功使用 `local-primary` 后的策略重验仅发生超时、网络错误、408/429/5xx：最长 5 分钟沿用 last-known-good，但只能查询已经校验并加载到内存的同一索引；新索引键仍远程。
3. `mode=local-primary`，调用方提供支持的 schema、题库版本和合法范围，且为角色目录或 `gameScopeMode=strict` 的游戏上下文：加载索引并本地搜索。
4. 索引网络/超时/408/429/5xx：当前查询只回退一次远程；当前熔断键按 5 秒、30 秒、2 分钟、5 分钟有界退避，在下一次查询用单探针半开恢复。
5. 普通 HTTP 缓存内容校验失败：清内存并执行一次 `cache: "reload"` 修复；仍失败或遇到 400/404、未知 schema、engine throw 时结构性熔断，只在上下文/policy revision 变化、页面重载或用户显式重试时半开一次。
6. 成功取得 `mode=remote` 立即远程；成功取得相同 revision 不无条件清除故障熔断，新 revision 清除旧 revision 的熔断状态。
7. 合法本地空结果：直接返回空，不访问远程。
8. `gameScopeMode=strict` 时游戏上下文必须有非空有效 `selectedCharacterIds` 才能本地搜索；`full` 时游戏上下文强制远程以保留完整快照语义，角色目录仍可本地搜索。策略缺少该字段时游戏上下文远程。

## 属于本 Issue

- `CharacterSearchProvider` 的单例策略状态、45 至 60 秒分散重验、visibility/focus 重验、3 秒显式超时、5 分钟 last-known-good 宽限和卸载清理。
- `useCharacterSearch` 内部 local/remote 路由，保留现有 results/total/error/loading/retry 公开字段，可增加 `refreshing` 但调用方不必使用。
- 扩展搜索上下文类型，允许携带 `catalogVersion` 和 `selectedCharacterIds`；字段暂时可选，缺失时保持远程。
- 本地索引就绪后同步计算，不使用 120ms 网络防抖；远程路径保留现有防抖、AbortController、参数和错误行为。
- 上下文版本、允许 ID、room/match/session 或筛选变化时取消旧远程请求并阻止旧本地/索引 Promise 覆盖。
- 以 `(catalogVersion, indexSchemaVersion, policyRevision)` 保存瞬时/修复中/结构性/半开状态；退避时钟加入可注入的正负 20% 抖动，同键半开只允许一个探针。
- 策略和索引的共享请求使用 Provider 自己的 `AbortController`；单个 Hook 的 `AbortSignal` 只取消该消费者订阅，不得取消其他消费者。无消费者时才可按实现能力取消共享请求；页面查询请求保持独立取消层级。
- 调用 HSO-003 repair API 完成同键每 revision 最多一次的强制 HTTP 缓存修复；路由器不自行拼 cache-busting URL。
- 按故障分类执行单次 fallback；远程失败直接暴露现有可重试错误，不反向切回本地形成循环。
- 远程请求在已确认新 API 能力且同源/CORS 允许时增加受控 `X-Character-Search-Fallback-Reason`，只使用决策记录中的固定枚举；策略 404/405、旧 API 或能力未知时省略，预检失败时无 header 重试一次；请求的业务参数与改造前完全一致。
- Provider 未挂载、策略 endpoint 为 404 的旧 API、未知 schema 和运行时解析异常的安全默认值。
- 在测试中可注入策略客户端、索引仓库、远程适配器、时钟和抖动源，不把 fetch mock 或真实时间等待散落到页面。

## 不属于本 Issue

- 不修改角色目录、SingleGamePage、GuessInputBar、竞速或接力调用参数；由 HSO-006 接入。
- 不实现或修改搜索算法、索引 payload 和 Go handler。
- 不改变远程搜索的 120ms 防抖或增加查询结果 LRU。
- 不实现按用户百分比灰度、管理后台按钮、跨标签页共享或持久化客户端策略/熔断状态。
- 不删除旧 API，也不把本地搜索结果作为服务端猜测校验依据。

## 可能涉及的代码

- `apps/web/src/features/character-search/CharacterSearchProvider.tsx`
- `apps/web/src/features/character-search/router.ts`
- `apps/web/src/hooks/useCharacterSearch.ts`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/features/character-search/searchApi.ts`（独立搜索 adapter；不与 HSO-005 共改 `api.ts`）
- 对应 Provider、Hook 和路由测试

## 验收标准

- [ ] 冷启动默认/非法/缺失策略只调用远程 API，不预取本地索引。
- [ ] 已加载本地索引时一次策略超时/5xx 在 5 分钟宽限内继续本地；冷启动、宽限超时、新索引键、策略 404/405/坏结构/未知 mode/schema 仍安全远程。
- [ ] local-primary + 完整上下文只加载一次索引，查询不调用远程 API。
- [ ] strict 模式下游戏本地结果只来自非空 selectedCharacterIds；full 模式或策略缺少 gameScopeMode 时游戏上下文只走远程，角色目录仍可按策略本地搜索。
- [ ] 3 秒策略超时和 5 秒索引超时边界由 fake timer 精确覆盖；AbortError 不计故障。
- [ ] 索引瞬时故障各只产生一次远程 fallback，并按 5 秒/30 秒/2 分钟/5 分钟退避；每次半开同键只有一个探针，成功后恢复本地并清零计数。
- [ ] 坏 HTTP 缓存只触发一次 repair；repair 成功不进入长期熔断，失败与 400/404、未知 schema、版本不符、engine throw 进入结构性熔断且不会按 60 秒周期重试。
- [ ] 合法空本地结果为 total=0，远程 mock 调用次数仍为零。
- [ ] 相同 policy revision 的普通策略成功不清结构性熔断；新 revision、索引键变化、页面重载或显式 retry 各只允许一个新探针。
- [ ] 服务端切为 remote 后，已打开页面在 60 秒内或恢复焦点时停止本地查询。
- [ ] 远程路径发送的 q/sessionId/roomId/matchIndex/catalogVersion/workIds/sort/direction/offset/limit 与改造前一致，fallback reason 与每个路由分支的固定枚举一致。
- [ ] 快速输入、切 session、切 match 和卸载不会出现旧结果覆盖或 state-after-unmount。
- [ ] 一个页面消费者取消不会取消其他消费者的共享策略/索引请求；最后消费者离开后的清理不会让新消费者复用已失效 Promise。
- [ ] 当前查询开始远程 fallback 后，任何迟到的本地/索引结果都不能覆盖；远程失败不会反向切本地或无限重试。
- [ ] 现有未提供本地字段的所有 Hook 测试继续通过，证明本 Issue 单独合并不会改变用户搜索路径。
- [ ] 跨源带 fallback reason 的预检失败时，无 header 重试成功且不会重复触发 fallback。

## 测试计划

- Vitest fake timers 和固定抖动源覆盖策略初始、45 至 60 秒重验、超时边界、5 分钟宽限、四级退避、focus 重验、卸载清理和 remote/local 切换。
- 使用 HSO-001 故障矩阵组合注入索引/引擎/远程各类成功与失败，断言调用次数、结果来源、fallback reason、熔断状态和恢复时间。
- 并发测试覆盖单探针半开、cache reload repair 去重、共享请求消费者加入/离开以及 fallback 后迟到 Promise 失效。
- 复跑现有 `useCharacterSearch` 测试，保留 AbortSignal 与远程参数断言。
- Web typecheck、全量 Vitest 和 production build 通过。

## 依赖与后续

依赖 HSO-002 的端点和 HSO-003 的纯内核。完成后 HSO-006 只需要补齐各模式的版本、允许范围和 scope mode，不能绕过 Provider 直接调用 engine 或 index repository。搜索请求封装由本 Issue 的独立 adapter 所有，HSO-005 不修改同一路径。

## 实施与验收记录（2026-08-28）

- 新增 `CharacterSearchProvider`、`CharacterSearchRouter` 与独立 `searchApi` adapter，并在根布局挂载单例 Provider；策略请求、索引请求和页面查询分别保持各自取消层级。
- `useCharacterSearch` 现通过 Provider 统一路由，扩展单人/多人上下文的可选 `catalogVersion` 与 `selectedCharacterIds`；未提供本地字段的既有调用方继续使用远程 API 和原 120ms 防抖。
- 实现策略冷启动/重验/visibility 重验、3 秒策略超时、5 分钟 last-known-good、local-primary/remote 切换，以及 `strict`/`full` 游戏范围 fail-closed 规则。
- 实现索引加载 5 秒超时、瞬时故障单次远程 fallback、5 秒/30 秒/2 分钟/5 分钟抖动退避与单探针半开；支持 429 `Retry-After` 上限处理。坏缓存 repair 仍由 HSO-003 仓库按同键同 revision 去重，repair/校验/引擎故障进入结构性熔断。
- 远程 adapter 保持原业务参数，按固定 fallback reason 发送观测 header；策略 404/405 省略 header，跨源预检以无 header 重试一次。迟到的本地/索引 Promise 不会覆盖已发布结果。
- 新增 `router.test.ts`，覆盖冷启动策略故障、旧 API route-missing、完整本地上下文、strict 空范围、full 强制远程、瞬时退避和策略 3 秒边界；既有索引、引擎与 Hook 测试继续通过。
- 验证通过：
  - `pnpm --filter @touhouflandre/web typecheck`
  - `pnpm --filter @touhouflandre/web exec vitest run src/features/character-search src/hooks/useCharacterSearch.test.tsx`（24 tests）
  - `pnpm --filter @touhouflandre/web test`（57 files，287 tests）
  - `pnpm --filter @touhouflandre/web build`
  - Windows Git `diff --check`
- 未新增迁移、OpenAPI 契约或生成物；角色目录、SingleGamePage、GuessInputBar、竞速/接力调用参数仍由 HSO-006 接入。后续需由 HSO-006 为各模式补齐真实版本、允许 ID 与 scope mode。
