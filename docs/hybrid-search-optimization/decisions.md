# HSO 混合搜索架构决策记录

本文档冻结多个 Issue 共同依赖的行为。单个 Issue 不得另行选择相冲突的缓存、路由、范围或回退语义；确需修改时先更新本记录及受影响 Issue。

## 1. 职责边界

- Postgres `CatalogSnapshot` 继续保存不可变题库版本。
- 新的 `CatalogSearchSnapshotProvider` 负责把指定题库版本投影为可下载搜索快照，并在 API 进程内缓存该投影。
- 浏览器 `CharacterSearchEngine` 负责查询归一化、字段内包含匹配、范围/作品过滤、排序和分页。
- 现有 Go `SearchCharacters` 和 `GET /api/characters/search` 完整保留，既是语义基线也是正式回退路径。
- `GuessEvaluator` 与现有 `CatalogRuntimeProvider` 继续负责答案匹配和反馈；搜索改造不重构其所有权。

搜索建议不是安全边界。无论候选来自本地还是远程，服务端提交接口都必须重新校验角色是否允许、是否重复和题局是否仍可操作。

## 2. 版本化搜索快照契约

新增公开只读资源：

```http
GET /api/catalog/{catalogVersion}/search-index/{indexSchemaVersion}
```

首版 `indexSchemaVersion=1`。响应至少包含：

```text
catalogVersion
indexSchemaVersion
entries[]:
  id
  display fields required by CharacterSearchResult
  searchTerms[]
  nameSortKey
```

`searchTerms` 必须保留字段边界；一个查询只能完整包含在某一个 term 中，不能跨姓名、别名或作品字段拼接命中。条目只包含 `enabledAsGuess=true` 的公开角色，不包含答案信息。

资源 URL 同时含题库版本和索引 schema，因此响应使用长期 `public, max-age=31536000, immutable` 缓存和稳定 ETag。Go API 与 Next 同源代理必须保持一致的内容和缓存头。浏览器以 HTTP 缓存持久化原始响应，并在当前 JavaScript 运行时按同一键缓存校验后的解析结果和进行中的加载 Promise；不新增 IndexedDB schema。

若索引投影规则或 wire shape 变化，必须提升 `indexSchemaVersion`，不能在同一 URL 下替换内容。若只有前端查询实现修复且 v1 数据仍兼容，可仅发布新 Web；旧 Web 仍可使用 v1 或远程搜索。

## 3. 服务端快照缓存与回退隔离

服务端缓存分成两层，不能让索引 wire schema 的故障同时破坏远程回退：

1. `CatalogSearchSourceProvider` 按 `catalogVersion` 从不可变 `CatalogSnapshot` 加载并缓存 Go 搜索需要的公开角色源数据。现有远程搜索 handler 只依赖这一层，并继续调用当前 Go 过滤、匹配、排序和分页函数。
2. `CatalogSearchSnapshotProvider` 在源数据之上按 `(catalogVersion, indexSchemaVersion)` 投影并缓存浏览器下载的索引。索引 schema 选择、序列化、ETag 或 payload 校验失败不得污染源数据缓存，也不得阻止远程 handler 使用同版本源数据。

两层都合并相同键的并发首次加载。成功结果进入进程内最近最少使用缓存，首版容量各固定为 8 个键；淘汰只导致下次从不可变数据库快照重建，不影响正确性。失败不得写入成功缓存，失败的 in-flight 条目必须移除，后续请求允许重试。底层数据库或 `CatalogSnapshot` 本身不可读时本地与远程都可能失败，这是共享数据依赖而非可由搜索路由掩盖的故障，必须由 readiness、错误指标和最终可重试错误暴露。

`CatalogRuntimeProvider` 不与上述 Provider 合并，避免搜索发布影响答案判定回滚面。

## 4. 本地搜索语义

TypeScript 内核必须逐项复现当前 Go 行为：

- Unicode NFKC；
- Unicode 小写转换；
- 删除空白、下划线、点号、中点和连字符；
- 简体、繁体、日文、英文、罗马字、别名、作品标题/ID、作品拼音首字母和 `THxx` 分字段匹配；
- 空查询匹配范围内全部角色；
- `enabledAsGuess`、游戏允许 ID 和作品 ID 过滤先于分页；
- `appearance` 或 `name` 排序，方向一致，相同主键时用角色 ID 稳定打破平局；
- offset/limit 与当前接口一致。

HSO-001 建立同一份语言无关黄金样例，Go 和 TypeScript 测试共同消费。HSO-003 不通过复制当前测试文字来宣称一致，必须对同一输入输出做双端断言。

本地搜索在索引就绪后同步完成，不保留网络防抖，也不缓存具体查询结果。约 170 个条目不足以证明需要 Web Worker；若后续实测主线程 P95 超过发布预算，再作为独立需求评估。

## 5. 动态策略、熔断与紧急回退

新增短生命周期策略资源：

```http
GET /api/catalog/search-policy
```

响应字段固定为：

```text
mode: remote | local-primary
indexSchemaVersion: integer
revision: string
gameScopeMode: strict | full
revalidateAfterSeconds: 60
```

服务端环境变量 `CHARACTER_SEARCH_MODE` 控制模式，缺省值和非法值均解析为 `remote`。`CHARACTER_SEARCH_QUESTION_SCOPE_FILTER_ENABLED=true` 映射为 `gameScopeMode=strict`，`false` 映射为 `full`；该字段必须与实际远程搜索范围保持一致。可选 `CHARACTER_SEARCH_POLICY_REVISION` 缺省为 `v1`；策略 `revision` 由该值、mode、scope mode 与 indexSchemaVersion 组成，在所有 API 实例间必须一致。同一配置跨请求保持稳定；修复结构性故障但不改变 mode/schema 时，部署者必须提升该环境变量。不能使用每次请求随机值。策略响应使用 `Cache-Control: no-store`；浏览器只在内存保存。正常重验分散在上次成功后的 45 至 60 秒内，不能晚于 `revalidateAfterSeconds`，页面从后台恢复可见时立即重验，避免所有标签页在同一秒集中请求。

策略请求超时固定为 3 秒，索引请求超时固定为 5 秒；实现必须使用可注入时钟和具名常量测试恰好低于、等于和超过边界的行为，不能依赖浏览器或代理的隐式超时。用户取消产生的 `AbortError` 不得转换为超时故障。

### 5.1 策略状态

- 冷启动没有已验证策略时，策略 404/405、超时、网络错误、408/429/5xx、坏 JSON、未知 mode 或未知 schema 均使用远程搜索。
- 页面已有最后一次成功的 `local-primary` 时，后续策略请求仅因超时、网络错误、408/429/5xx 失败，可在不超过 5 分钟的 last-known-good 宽限期内继续使用**已经成功校验并加载到内存的同一索引键**。宽限期内不得为新题库版本下载新索引；没有可用内存索引的查询走远程。这样短暂策略波动不会主动把已有本地能力切到同样依赖网络的远程路径。
- 策略 404/405、可解析但结构非法、未知 mode/schema 不使用宽限期，立即远程。这些响应表示 binary 或契约不兼容，不是普通网络波动。
- 任一成功响应 `mode=remote` 都立即停止本地查询。只要策略端点可达，运维回退仍在 60 秒内或页面恢复可见时生效；端点不可达时无法同时保证接收新开关和继续本地可用，5 分钟宽限是本计划明确选择的可用性边界。
- 宽限期内继续按 45 至 60 秒重验；超出宽限仍未成功则远程。之后任何成功且受支持的 `local-primary` 响应都可重新进入本地选择，不需要刷新页面。
- 策略缺少 `gameScopeMode` 或声明未知值时，角色目录可以继续远程搜索，但游戏上下文不得启用本地搜索；只有明确收到 `strict` 或 `full` 才能按范围规则选择本地路径。

### 5.2 本地路径故障分类

熔断键固定为 `(catalogVersion, indexSchemaVersion, policyRevision)`，状态仅存在于当前页面生命周期。故障按下表处理：

| 分类           | 例子                                                              | 当前查询                                 | 自动恢复                                                                                                                             |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 非故障         | 合法空结果、用户取消、调用方上下文切换、远程业务 4xx              | 按原语义结束                             | 不打开或升级熔断                                                                                                                     |
| 瞬时故障       | 索引网络错误、显式超时、408、429、5xx                             | 原参数回退一次远程                       | 依次等待 5 秒、30 秒、2 分钟、5 分钟后进入半开；退避加入正负 20% 抖动且最大 5 分钟，429 的 `Retry-After` 在上限内优先                |
| 可修复缓存故障 | 从普通 HTTP 缓存取得的坏 JSON、schema 校验失败或声明版本不符      | 先执行一次强制修复；仍失败才回退一次远程 | 清除内存成功值/in-flight Promise，并对同一不可变 URL 使用 `cache: reload` 绕过 HTTP 缓存一次；修复成功立即关闭熔断，失败转结构性故障 |
| 结构性故障     | 索引 400/404、强制修复后仍校验失败、未知索引 schema、本地引擎抛错 | 原参数回退一次远程                       | 不按 60 秒周期盲目重试；只在题库/schema/policy revision 变化、页面重载或用户显式重试时允许一个半开探针                               |

半开状态同一熔断键只允许一个索引/引擎探针；其他并发查询继续远程。探针成功才关闭熔断并清空退避计数，失败按分类重新打开。成功取得相同 revision 的策略不会无条件清除熔断；新 revision 或上下文键变化清除旧键状态。这样瞬时故障可以自行恢复，而永久坏索引不会每分钟让玩家重复等待一次失败。

### 5.3 结果与远程失败边界

每个查询只能发布一个来源的结果。开始远程 fallback 前必须使当前本地完成失效；迟到的索引、本地引擎或旧上下文 Promise 不得覆盖远程结果。自动回退不得循环重试，远程失败直接暴露现有可重试错误，不反向切回本地。

远程请求使用可选请求头 `X-Character-Search-Fallback-Reason` 标记固定低基数原因：`policy_remote`、`policy_unavailable`、`context_incomplete`、`index_transient`、`index_invalid` 或 `engine_error`；新 API 的 CORS `AllowHeaders` 必须显式包含该 header，旧 API 可以忽略。只有策略端点成功确认新 API 能力后才发送该 header；策略 404/405、旧 API 或能力未知时省略。若跨源预检因该 header 失败，客户端必须无 header 重试一次并继续原搜索，不能形成回退循环。服务端只把受控枚举归一化为指标/结构化日志标签，缺失为 `none`、未知为 `unknown`，不得记录查询词、题库版本、session/room ID 或其他高基数、私有值。该请求头只用于观测，不能参与授权、搜索语义或错误响应，且不能作为唯一可信的生产事实。

策略切换不要求前端重新部署、清除 HTTP 缓存或迁移数据。切换为 `remote` 后，已缓存的不可变索引仍可保留，但不再参与查询。

### 5.4 取消层级与同页离线边界

索引下载和策略请求属于 Provider 共享资源，底层 fetch 必须使用 Provider 自己的 `AbortController`。单个 Hook/页面消费者的 `AbortSignal` 只能让该消费者忽略结果，不得取消其他消费者正在使用的共享请求，也不得把旧页面的取消转换成全局索引故障。只有在确认没有消费者且实现明确支持时，Provider 才可取消共享请求；页面查询请求仍可由该查询自己的 controller 取消。

本计划只承诺“同一页面生命周期内，已有已校验内存索引且仍在 5 分钟 last-known-good 窗口内”可以在断网时继续本地搜索。刷新页面、超过宽限期、没有已验证策略/内存索引或需要新题库版本时，即使浏览器 HTTP 缓存可能有索引字节，也不得宣称离线可用；此时走远程或显示最终可重试错误。刷新后的离线搜索列为后续需求。

## 6. 搜索上下文与范围

统一 Hook 的调用方需要同时提供本地和远程所需信息：

- 角色目录：当前 `catalogVersion`，无游戏允许 ID 限制；
- 单人：`sessionId + catalogVersion + selectedCharacterIds`；
- 多人：`roomId + matchIndex + catalogVersion + selectedCharacterIds`。

本地路径使用版本和 ID 集合；远程路径保留原来的 session/room 参数。版本或允许集合变化视为上下文切换，立即丢弃旧结果和旧异步完成。游戏上下文缺少版本或允许集合时禁止用整表代替；若远程身份参数完整则走远程，否则显示可重试错误。

`CatalogSummary.version` 在 OpenAPI 和 shared 类型中声明为**可选 additive 字段**，以兼容仍返回旧摘要的 API；新 API 必须返回非空版本并与 `CatalogState` 一致。新 Web 运行时缺少或无法验证该字段时，角色目录也不得下载未知版本索引，使用远程搜索或显示可重试错误。`PublicGameSession` 与多人 `MatchView.questionScope` 已能提供冻结版本和 `selectedCharacterIds`；若运行时接收到旧投影缺字段，按上述 fail-closed 规则回退。

`gameScopeMode=strict` 时，游戏上下文只有在 `selectedCharacterIds` 非空且有效时才能走本地；远程也继续使用同一集合。`gameScopeMode=full` 时保留现有“远程可返回整份版本快照”的语义，游戏上下文强制走远程，不得把本地 selected ID 静默改成全量；角色目录仍可本地搜索。缺失或空集合在 strict 模式下是零结果/远程上下文，不得泄漏整表。

## 7. 单人恢复或创建

新增 `POST /api/puzzles/{mode}/resolve`，请求复用现有创建字段并增加 `idempotencyKey` 与可选 `resumeSessionId`。旧 `POST /api/puzzles/{mode}` 保持 create-only 原义，避免新 Web 请求旧 API 时在得知“不支持恢复”之前已经创建题局。服务端按以下顺序处理：

1. ID 存在且会话的模式、每日日期和难度与请求一致：返回原会话，`resolution=resumed`；已结束的同一题局仍可恢复。
2. ID 不存在：按现有规则创建，`resolution=created`。
3. ID 存在但不匹配：返回新会话和可选 `supersededSession`，让 Web 延续现有统计归档/草稿清理语义。

`idempotencyKey` 由客户端为一次 resolve 意图生成并在重试中复用。服务端在同一事务中持久化 key、规范化请求指纹（mode、resumeSessionId、difficulty、questionScope 等会影响结果的字段）和最终 session/响应绑定，并对 key 建立唯一约束：相同 key 且指纹相同必须返回首次结果，相同 key 但指纹不同返回明确的 `409 IDEMPOTENCY_KEY_REUSED`，不得创建第二局。并发相同 key 的请求必须由数据库冲突/锁保证只有一个创建事务提交，另一个读取已保存结果。记录至少保留到关联 session 的可恢复窗口结束（具体清理由后续维护任务执行）；过期后 key 才可按文档化规则重新使用。旧 create-only 端点不承诺幂等，也不受该记录约束。

随机题请求可直接携带 localStorage 中已解析的 `QuestionScopeConfigInput`；服务端按当前题库规范化并在响应 `session.questionScope` 返回修正结果，Web 再保存修正值。无效或无法解析的本地值等价于未提供，使用服务端默认范围。每日题日期和默认范围完全由服务端决定。

该变化不删除 `GET /api/sessions/{sessionId}`，也不改变显式“重新开始”、放弃、计时或统计接口。每日其他难度状态可在主会话返回后后台刷新，不能继续阻塞首屏题局。

## 8. 双向版本兼容与部署顺序

所有 API 变化均为新增端点或新增响应字段，不修改旧搜索和旧创建请求/响应。部署与回滚矩阵固定如下：

| Web | API                 | 行为                                                                            |
| --- | ------------------- | ------------------------------------------------------------------------------- |
| 旧  | 新                  | 继续使用 Go 搜索和旧题局流程                                                    |
| 新  | 旧                  | 策略端点缺失，自动使用 Go 搜索；题局请求不发送新能力或对 404/不支持做旧流程兼容 |
| 新  | 新，`remote`        | 所有搜索使用 Go，先验证兼容基线                                                 |
| 新  | 新，`local-primary` | 本地优先，故障自动回退 Go                                                       |

新 Web 调用 resolve 端点收到 404/405 时，在当前页面生命周期内退回现有 `GET session -> POST puzzle` 流程；因为旧创建端点尚未被调用，不会产生重复题局。该兼容路径在本计划内不得删除。

### 8.1 滚动部署与索引 404 分类

启用 `local-primary` 前必须先部署所有支持策略、索引端点、结构化错误码和 CORS header 的 API 实例，确认整个 API fleet 兼容后保持 `remote` 做索引抽查，再切换 `local-primary`。升级未完成期间策略只能返回 `remote`。回滚时先把策略切回 `remote`，等待传播/抽查已打开页面停止本地，再回滚 API binary。

索引确实不存在的 404 必须由新 API 返回结构化错误码 `CATALOG_VERSION_NOT_FOUND` 和 `Cache-Control: no-store`；旧 binary 或旧路由造成的无结构化 404 由客户端归类为 `COMPATIBILITY_ROUTE_MISSING`，即使旧响应缺少该 header 也不得缓存。兼容窗口内不能把 route-missing 当作永久题库缺失；客户端只远程回退并等待兼容部署/策略 revision 变化或显式重试。

## 9. 性能与发布口径

性能目标分成可确定和需实测两类：

- 本地索引就绪后，输入变化不得产生 `/api/characters/search` 请求；固定测试数据下本地计算 P95 小于 16ms。
- 同一标签页同一版本只允许一个并发索引下载；重复消费者复用 Promise。
- 浏览器缓存命中时允许一次本地缓存读取，不得重新下载响应主体。
- 随机题无旧局时只等待一次创建请求；每日恢复或创建也只等待一次主请求，后台状态刷新不计入主加载。
- 搜索快照压缩体积预算由 HSO-001 根据真实响应确定，并记录相对当前 `/api/catalog/characters` 与 `/api/catalog/full` 的对比。
- 生产基线只读，使用预先创建的 session 测量恢复；随机 fresh/daily fresh 只在 disposable local/pre-release 数据库执行并清理。每个场景先 warmup，再收集至少 30 个有效样本（建议 50），报告 p50/p95/p99、请求数和环境；一次采样不构成 SLA。

可观测性至少覆盖策略响应 mode/outcome、索引 source/snapshot 两层的加载与缓存 outcome、索引构建耗时、远程搜索的受控 fallback reason、远程错误率和延迟。所有标签必须是固定枚举；不得使用题库版本、查询词、session、room、match、角色 ID、昵称或答案。HSO-007 必须记录正常网络和模拟波动下的误回退次数、熔断持续时间、半开恢复成功率以及同一结构性故障是否产生周期性重试。

紧急回退验收要求在不刷新页面的情况下，于策略重新验证窗口内从本地切到远程；已有游戏上下文、已猜角色过滤和提交行为保持不变。

## 10. Issue 文件所有权

为保证 HSO-002 完成后 HSO-004 与 HSO-005 可以并行，两个 Web adapter 分开拥有路径：HSO-004 只新增/维护 `apps/web/src/features/character-search/searchApi.ts`（或等价独立搜索 adapter），HSO-005 只新增/维护 `apps/web/src/lib/puzzleApi.ts`（或等价独立题局 adapter）。`apps/web/src/lib/api.ts` 中现有兼容方法保留但不由两个并行 Issue 同时扩展；HSO-006 只装配两个 adapter，不复制请求逻辑。HSO-002 负责搜索快照/策略的 OpenAPI source、生成物和服务端端点；HSO-005 在其之后独占 resolve path/schema 的 OpenAPI 扩展和对应生成更新，二者不并行修改同一接口面。

## 11. 被否决的替代方案

- **删除 Go 搜索后只保留本地实现**：故障时需要重新发布 Web，不能满足紧急无损回退。
- **复活当前 `/api/catalog/characters` 作为新接口**：只有当前版本，字段已标记弃用，无法安全服务冻结旧题局和索引 schema 升级。
- **只缓存最近查询结果**：精确查询短期重复率低，不能消除新搜索词的网络往返。
- **把当前完整 `CatalogFull` 直接作为搜索索引**：携带设置和字段定义等无关数据，缓存失效也没有独立索引 schema；继续由设置功能使用，不作为搜索运行时契约。
- **Redis 或独立搜索服务**：当前数据规模不需要新增基础设施，且不能解决玩家到服务器的公网往返。
- **在每个游戏模式内实现搜索**：会复制算法和范围处理，违背统一入口要求。
- **仅使用构建期前端环境变量作为开关**：切换需要重新构建和发布 Web，不能满足服务器侧紧急回退。
