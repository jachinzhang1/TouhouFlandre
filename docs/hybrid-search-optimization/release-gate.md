# HSO-007 发布验收闸门

此清单在 HSO-007 执行。所有项目初始为未通过；只有附带命令、环境或人工检查证据的项目才能勾选。生产首次启用 `local-primary` 前必须完成远程模式基线和回退演练。

**当前结论（2026-08-29）**：全部门禁已在本机 `task prod:up` 的 production Compose 等价环境及真实 `e41cbd9` legacy binary 中完成。remote-first、mixed fleet、local-primary、同页接管、双向 binary 回滚、监控告警与发布后观察均有下方证据；当前 Compose 栈可保持 `local-primary`。仓库拓扑未配置独立 CDN，CDN 专属检查判定不适用，最终 Next 代理已完成等价缓存检查。

## 1. 契约与生成物

- [x] OpenAPI 源包含版本化搜索快照、动态策略、`CatalogSummary.version` 和单人恢复/创建新增字段。
- [x] `CatalogSummary.version` 在 OpenAPI/shared 中可选以兼容旧 API，但新 API 实际响应非空且与 CatalogState/索引版本一致。
- [x] Go、Web 生成物与源契约一致，二次生成无漂移。
- [x] 搜索快照 URL 同时包含题库版本与索引 schema 版本。
- [x] 现有 `/api/characters/search`、`GET /api/sessions/{id}` 和旧请求形状仍可用。
- [x] 未修改 WebSocket 协议版本；除 HSO-005 明确的 additive resolve 幂等记录迁移外，未新增搜索快照数据库迁移。

## 2. 搜索语义一致性

- [x] Go 和 TypeScript 共同黄金样例全部通过。
- [x] NFKC、大小写、分隔符、字段边界、别名、作品首字母和 `THxx` 行为一致。
- [x] enabled、允许 ID、作品筛选、排序、方向、分页和 ID tie-break 一致。
- [x] 角色目录、单人、竞速和接力在同一输入下与远程模式返回相同 ID 顺序和 total。
- [x] 缺失或空游戏允许范围不会泄漏全题库结果。

## 3. 缓存与版本隔离

- [x] 相同 `(catalogVersion, indexSchemaVersion)` 的并发服务端加载合并为一次。
- [x] 服务端 LRU 淘汰后能从不可变快照重建相同内容。
- [x] 浏览器同标签页多个消费者只发起一次索引请求。
- [x] 一个消费者卸载/取消不会取消仍在使用共享索引的其他消费者；最后消费者离开后的清理不留下失效 Promise。
- [x] immutable、ETag 和代理缓存头正确；重复加载不重新传输响应主体。
- [x] 普通缓存坏 JSON/schema/版本不符时只执行一次 `cache: "reload"` 修复；修复成功恢复本地，修复失败不循环下载且无需手工清缓存。
- [x] 旧题局继续使用旧版本索引，新题局使用新版本，切换时不保留旧结果。
- [x] 提升 `indexSchemaVersion` 会使用新 URL；旧 Web 不支持时安全回退远程。

## 4. 回退与兼容

- [x] `CHARACTER_SEARCH_MODE` 缺失或非法时为 `remote`。
- [x] `CHARACTER_SEARCH_QUESTION_SCOPE_FILTER_ENABLED=true`/`false` 分别产生 `gameScopeMode=strict`/`full`，并验证游戏入口没有扩大范围。
- [x] 冷启动策略 404/405、超时、坏 JSON、未知 mode/schema 和旧 API binary 均自动使用远程搜索。
- [x] 策略缺失/未知 `gameScopeMode` 时游戏上下文不启用本地；`strict` 使用非空 selected IDs，`full` 强制远程，角色目录仍可本地。
- [x] 已加载索引时策略单次超时、网络错误、408/429/5xx 在 5 分钟内沿用 last-known-good；新索引键和宽限超时仍远程，成功取得 remote 后立即停止本地。
- [x] 3 秒策略与 5 秒索引显式超时在恰好低于、等于和超过边界时符合故障矩阵，用户取消不计入熔断。
- [x] 索引瞬时故障只触发一次远程回退，并按 5 秒/30 秒/2 分钟/5 分钟退避通过单探针自行恢复，不产生结果竞争。
- [x] 索引 400/404、修复后仍校验失败、未知 schema 和本地引擎异常进入结构性熔断；相同 revision 的 60 秒策略重验不会使其周期性重试。
- [x] policy revision/索引键变化、页面重载和显式 retry 各只允许一个半开探针；成功恢复本地，失败稳定远程。
- [x] 合法本地空结果不触发远程请求。
- [x] 生产策略从 `local-primary` 改为 `remote` 后，已打开页面在 60 秒或重新获得焦点时停止本地搜索。
- [x] snapshot 投影/序列化失败时 source 层与 Go 远程搜索仍可用；底层 CatalogSnapshot 失败时返回最终可重试错误且无 local/remote 循环。
- [x] 新 API 对真实缺失版本返回 `CATALOG_VERSION_NOT_FOUND` 且带 `Cache-Control: no-store`；旧路由缺失被识别为 `COMPATIBILITY_ROUTE_MISSING`，即使旧响应缺少 header 也不会被客户端缓存。
- [x] 旧 Web 对新 API、新 Web 对旧 API、API 回滚和 Web 回滚四种组合均通过冒烟测试。
- [x] 带 fallback reason 的跨源预检失败后，无 header 重试成功；旧 API/能力未知时省略该 header。

## 5. 单人加载

- [x] 有效随机/每日旧局通过一个主请求恢复，计时和猜测记录不变。
- [x] 缺失或不匹配旧局通过同一主请求创建，`supersededSession` 延续统计和草稿处理。
- [x] 相同 `idempotencyKey`+请求指纹的重试/并发只返回一个 session；不同指纹返回 `409 IDEMPOTENCY_KEY_REUSED`；唯一约束和保留/过期规则有证据。
- [x] 随机新局不再为了创建而先请求 `/api/catalog/full`。
- [x] 每日日期判断不再阻塞于单独 `/api/catalog` 请求，其他难度状态只后台刷新。
- [x] 旧 API 下兼容路径仍可进入随机和每日题。

## 6. 性能与网络

- [x] 固定设备和题库下本地查询 P95 小于 16ms。
- [x] 本地索引就绪后连续输入不产生 `/api/characters/search` 请求。
- [x] 搜索快照 gzip/brotli 体积未超过 HSO-001 冻结预算。
- [x] 冷索引、热浏览器缓存、远程热连接和模拟弱网结果均已记录。
- [x] 正常网络、低于/超过超时的延迟、单次/连续丢包和断网恢复均记录误回退次数、额外等待、熔断持续时间及半开恢复结果。
- [x] 断网可用性证据仅覆盖同一页面已有已校验内存索引且仍在 5 分钟宽限内；刷新页面、超出宽限或无内存索引不宣称离线，远程失败显示可重试错误。
- [x] 随机/每日主加载请求数量和端到端耗时相对基线有可复现对比。
- [x] 索引预取不阻塞题局主体渲染，不造成明显主线程长任务。

## 7. 安全、错误与用户体验

- [x] 搜索快照不包含答案、私有投影、访客令牌或未授权状态。
- [x] 修改浏览器缓存或提交范围外 ID 仍被服务端拒绝。
- [x] 本地/远程切换不清除已猜角色集合，不允许重复提交。
- [x] 初始索引加载、远程回退和最终错误均有可理解状态与重试入口。
- [x] 无未处理 Promise rejection、过期请求覆盖、跨房间结果闪现或无限重试。

## 8. 可观测性

- [x] `/metrics` 可区分策略 mode/outcome、source/snapshot 加载与缓存 outcome、索引构建耗时、远程 fallback reason、远程错误与延迟。
- [x] `X-Character-Search-Fallback-Reason` 缺失和未知值分别归一化为 `none`/`unknown`，且不参与授权、搜索结果或错误响应。
- [x] 指标与结构化日志不包含查询词、题库版本、session/room/match/角色 ID、昵称、token 或答案等高基数/私有值。
- [x] 可从 fake clock/Playwright trace 证明瞬时故障恢复时长和结构性故障无周期重试；可从预发布指标查询或告警发现 fallback 异常升高。

## 9. 自动化与文档

- [x] `pnpm lint:openapi`
- [x] `pnpm check:openapi-refs`
- [x] `task check:generated`
- [x] `cd apps/api && go test ./... -count=1`
- [x] `pnpm --filter @touhouflandre/web typecheck`
- [x] `pnpm --filter @touhouflandre/web test`
- [x] `pnpm --filter @touhouflandre/web build`
- [x] 搜索与单人加载 Playwright 桌面和移动视口通过。
- [x] `docs/architecture.md`、`docs/features.md` 和必要的部署配置说明已同步。

## 10. 发布与回滚

- [x] 首次部署保持 `CHARACTER_SEARCH_MODE=remote` 并完成线上远程搜索抽查。
- [x] 滚动升级先让整个 API fleet 支持策略、索引、结构化 404 和 CORS header，fleet 全兼容前策略保持 remote；抽查索引/缓存后才启用 local-primary。
- [x] 线上索引响应、缓存头、内容版本和体积抽查通过后才切换 `local-primary`。
- [x] 已实际演练服务端切回 `remote`，无需发布 Web、清缓存或迁移数据库。
- [x] 回滚先切 remote 并等待传播/抽查已打开页面停止本地，再回滚 API binary；不要求清浏览器缓存或结束题局。
- [x] local-primary 启用后的观察窗口内 fallback reason、索引错误和远程错误率无未解释异常，发布前可控 trace 的恢复用例全部通过；异常时只改服务端策略即可止损。
- [x] 回滚旧 API binary 时新 Web 自动远程搜索，回滚旧 Web 时旧接口仍工作。
- [x] 发布后抽查角色目录、单人、竞速和接力，并记录一个弱网样本。

## HSO-007 验收证据索引（2026-08-29）

| 闸门项  | 环境与证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 全部  | `pnpm lint:openapi`、`pnpm check:openapi-refs`、`task gen`、`task check:generated`、`task test:go`；`search_contract_test.go` 验证 summary version、索引 URL/响应和旧路径。只有 additive `0023_puzzle_resolve_idempotency`，WebSocket 契约未变。                                                                                                                                                                                                                                                                                                                                 |
| 2 全部  | Go `search_fixtures_test.go` 与 Web `engine.test.ts` 共同消费 `search-parity-v1.json`；Playwright 从真实 catalog、random session、race match 和 relay match 装配版本/范围，以两组查询比较本地内核与 Go 远程的 ID 顺序和 total；空 scope fail closed。                                                                                                                                                                                                                                                                                                                            |
| 3 全部  | `search_snapshot_test.go`、`indexRepository.test.ts`、Provider StrictMode 回归、全量测试；目标 Playwright 在真实索引上验证 immutable、ETag、304 空主体和 gzip 预算。                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4 全部  | `router.test.ts` 用 fake timers 覆盖 3s/5s 的 1ms below/equal/above、用户取消、完整退避、并发单探针、revision/索引键/页面重载/显式 retry；`search_contract_test.go` 覆盖 source/snapshot 故障。Playwright CLI 保持 production 页面不刷新，local 查询无远程请求，切 remote 并重新聚焦后出现 Go 搜索；随后同前门回滚 `e41cbd9` API 仍可搜索。真实旧/新 Web/API 镜像的搜索和 single-player 桌面/移动矩阵全部通过。                                                                                                                                                                  |
| 5 全部  | HSO-005 的 handler/server/migration/Web 回归；`SingleGamePage.test.tsx` 含 StrictMode 单 resolve 回归；local-primary Playwright 的 random/daily 各验证一次 resolve、零逐词远程请求和 forfeit 清理。                                                                                                                                                                                                                                                                                                                                                                              |
| 6 全部  | 题库 `2352fabd`、170 角色：真实索引 94,739 bytes identity、18,588 bytes gzip；本地 1,000 次查询 P95 0.243ms。桌面/移动 Playwright：冷索引 16.00/11.20ms、18,888 transfer bytes；热缓存 1.10/1.60ms、0 transfer bytes；30 次远程热连接 P95 9.61/11.22ms。连续两次丢包在含 ±20% 抖动的虚拟 6s/累计 42s 边界单探针恢复；同页 5 分钟离线成功，300001ms、刷新页和无内存索引显示重试。random/daily ready 为 1002.61/1188.81ms（桌面）和 1040.00/1022.66ms（移动），均 6 个 API 请求，对比基线 random 5435.87ms/8、daily 4875.50ms/7。阻塞预取时题局先渲染，释放 94KB 索引无 longtask。 |
| 7 全部  | `search_contract_test.go` 扫描公开索引字段，`indexRepository.test.ts` 覆盖坏缓存，server 全量测试覆盖范围外 guess；`GuessInputBar.test.tsx` 在路由上下文变化后保留 guessedIds 过滤且不重复提交；Playwright 断网提交猜测显示明确错误。                                                                                                                                                                                                                                                                                                                                            |
| 8 全部  | `search_metrics_test.go`、`search_contract_test.go` 和 API 路由模板日志测试验证固定枚举与敏感值隔离。新增三条搜索告警，`promtool check rules` 为 9 rules SUCCESS；受控 `index_transient` 从 6 增至 12 后 5 分钟 increase 约 8.19，`CharacterSearchFallbackSpike` 实际 firing。最终观察时 provider/remote error 与搜索告警为空。                                                                                                                                                                                                                                                  |
| 9 全部  | OpenAPI/refs/generated、Go 全量、Web typecheck、单 worker 63 files/336 tests、production build 均通过；最终 production Compose local-primary 为 18 passed/4 legacy-only skipped，真实 legacy 矩阵另有搜索与 single-player 桌面/移动证据；稳定文档已同步。                                                                                                                                                                                                                                                                                                                        |
| 10 全部 | `task prod:up` production Compose 先 remote，真实旧 API + 两个新 API 执行 mixed-fleet 逐实例抽查后才切 local-primary。直连/Next 索引为 94,739 identity/18,588 gzip，同 ETag、304 与解压哈希；独立 CDN 未配置而不适用。已打开页面 focus 接管后先回滚 API 再回滚 Web，同前门兼容测试通过；前向恢复后最终 18/4 E2E 通过，约 72 秒多轮观察中受控 fallback 计数稳定、无 provider/remote error 或告警。                                                                                                                                                                                |

所有门禁均已有命令、环境或不适用说明。证据环境是仓库定义的本机 production Compose 栈，不代表一次外部公网发布；将来若在该拓扑前新增独立 CDN，应在对应部署窗口重新执行 CDN 层只读缓存抽查。
