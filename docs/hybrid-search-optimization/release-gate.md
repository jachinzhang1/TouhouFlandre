# HSO-007 发布验收闸门

此清单在 HSO-007 执行。所有项目初始为未通过；只有附带命令、环境或人工检查证据的项目才能勾选。生产首次启用 `local-primary` 前必须完成远程模式基线和回退演练。

## 1. 契约与生成物

- [ ] OpenAPI 源包含版本化搜索快照、动态策略、`CatalogSummary.version` 和单人恢复/创建新增字段。
- [ ] `CatalogSummary.version` 在 OpenAPI/shared 中可选以兼容旧 API，但新 API 实际响应非空且与 CatalogState/索引版本一致。
- [ ] Go、Web 生成物与源契约一致，二次生成无漂移。
- [ ] 搜索快照 URL 同时包含题库版本与索引 schema 版本。
- [ ] 现有 `/api/characters/search`、`GET /api/sessions/{id}` 和旧请求形状仍可用。
- [ ] 未修改 WebSocket 协议版本；除 HSO-005 明确的 additive resolve 幂等记录迁移外，未新增搜索快照数据库迁移。

## 2. 搜索语义一致性

- [ ] Go 和 TypeScript 共同黄金样例全部通过。
- [ ] NFKC、大小写、分隔符、字段边界、别名、作品首字母和 `THxx` 行为一致。
- [ ] enabled、允许 ID、作品筛选、排序、方向、分页和 ID tie-break 一致。
- [ ] 角色目录、单人、竞速和接力在同一输入下与远程模式返回相同 ID 顺序和 total。
- [ ] 缺失或空游戏允许范围不会泄漏全题库结果。

## 3. 缓存与版本隔离

- [ ] 相同 `(catalogVersion, indexSchemaVersion)` 的并发服务端加载合并为一次。
- [ ] 服务端 LRU 淘汰后能从不可变快照重建相同内容。
- [ ] 浏览器同标签页多个消费者只发起一次索引请求。
- [ ] 一个消费者卸载/取消不会取消仍在使用共享索引的其他消费者；最后消费者离开后的清理不留下失效 Promise。
- [ ] immutable、ETag 和代理缓存头正确；重复加载不重新传输响应主体。
- [ ] 普通缓存坏 JSON/schema/版本不符时只执行一次 `cache: "reload"` 修复；修复成功恢复本地，修复失败不循环下载且无需手工清缓存。
- [ ] 旧题局继续使用旧版本索引，新题局使用新版本，切换时不保留旧结果。
- [ ] 提升 `indexSchemaVersion` 会使用新 URL；旧 Web 不支持时安全回退远程。

## 4. 回退与兼容

- [ ] `CHARACTER_SEARCH_MODE` 缺失或非法时为 `remote`。
- [ ] `CHARACTER_SEARCH_QUESTION_SCOPE_FILTER_ENABLED=true`/`false` 分别产生 `gameScopeMode=strict`/`full`，并验证游戏入口没有扩大范围。
- [ ] 冷启动策略 404/405、超时、坏 JSON、未知 mode/schema 和旧 API binary 均自动使用远程搜索。
- [ ] 策略缺失/未知 `gameScopeMode` 时游戏上下文不启用本地；`strict` 使用非空 selected IDs，`full` 强制远程，角色目录仍可本地。
- [ ] 已加载索引时策略单次超时、网络错误、408/429/5xx 在 5 分钟内沿用 last-known-good；新索引键和宽限超时仍远程，成功取得 remote 后立即停止本地。
- [ ] 3 秒策略与 5 秒索引显式超时在恰好低于、等于和超过边界时符合故障矩阵，用户取消不计入熔断。
- [ ] 索引瞬时故障只触发一次远程回退，并按 5 秒/30 秒/2 分钟/5 分钟退避通过单探针自行恢复，不产生结果竞争。
- [ ] 索引 400/404、修复后仍校验失败、未知 schema 和本地引擎异常进入结构性熔断；相同 revision 的 60 秒策略重验不会使其周期性重试。
- [ ] policy revision/索引键变化、页面重载和显式 retry 各只允许一个半开探针；成功恢复本地，失败稳定远程。
- [ ] 合法本地空结果不触发远程请求。
- [ ] 生产策略从 `local-primary` 改为 `remote` 后，已打开页面在 60 秒或重新获得焦点时停止本地搜索。
- [ ] snapshot 投影/序列化失败时 source 层与 Go 远程搜索仍可用；底层 CatalogSnapshot 失败时返回最终可重试错误且无 local/remote 循环。
- [ ] 新 API 对真实缺失版本返回 `CATALOG_VERSION_NOT_FOUND` 且带 `Cache-Control: no-store`；旧路由缺失被识别为 `COMPATIBILITY_ROUTE_MISSING`，即使旧响应缺少 header 也不会被客户端缓存。
- [ ] 旧 Web 对新 API、新 Web 对旧 API、API 回滚和 Web 回滚四种组合均通过冒烟测试。
- [ ] 带 fallback reason 的跨源预检失败后，无 header 重试成功；旧 API/能力未知时省略该 header。

## 5. 单人加载

- [ ] 有效随机/每日旧局通过一个主请求恢复，计时和猜测记录不变。
- [ ] 缺失或不匹配旧局通过同一主请求创建，`supersededSession` 延续统计和草稿处理。
- [ ] 相同 `idempotencyKey`+请求指纹的重试/并发只返回一个 session；不同指纹返回 `409 IDEMPOTENCY_KEY_REUSED`；唯一约束和保留/过期规则有证据。
- [ ] 随机新局不再为了创建而先请求 `/api/catalog/full`。
- [ ] 每日日期判断不再阻塞于单独 `/api/catalog` 请求，其他难度状态只后台刷新。
- [ ] 旧 API 下兼容路径仍可进入随机和每日题。

## 6. 性能与网络

- [ ] 固定设备和题库下本地查询 P95 小于 16ms。
- [ ] 本地索引就绪后连续输入不产生 `/api/characters/search` 请求。
- [ ] 搜索快照 gzip/brotli 体积未超过 HSO-001 冻结预算。
- [ ] 冷索引、热浏览器缓存、远程热连接和模拟弱网结果均已记录。
- [ ] 正常网络、低于/超过超时的延迟、单次/连续丢包和断网恢复均记录误回退次数、额外等待、熔断持续时间及半开恢复结果。
- [ ] 断网可用性证据仅覆盖同一页面已有已校验内存索引且仍在 5 分钟宽限内；刷新页面、超出宽限或无内存索引不宣称离线，远程失败显示可重试错误。
- [ ] 随机/每日主加载请求数量和端到端耗时相对基线有可复现对比。
- [ ] 索引预取不阻塞题局主体渲染，不造成明显主线程长任务。

## 7. 安全、错误与用户体验

- [ ] 搜索快照不包含答案、私有投影、访客令牌或未授权状态。
- [ ] 修改浏览器缓存或提交范围外 ID 仍被服务端拒绝。
- [ ] 本地/远程切换不清除已猜角色集合，不允许重复提交。
- [ ] 初始索引加载、远程回退和最终错误均有可理解状态与重试入口。
- [ ] 无未处理 Promise rejection、过期请求覆盖、跨房间结果闪现或无限重试。

## 8. 可观测性

- [ ] `/metrics` 可区分策略 mode/outcome、source/snapshot 加载与缓存 outcome、索引构建耗时、远程 fallback reason、远程错误与延迟。
- [ ] `X-Character-Search-Fallback-Reason` 缺失和未知值分别归一化为 `none`/`unknown`，且不参与授权、搜索结果或错误响应。
- [ ] 指标与结构化日志不包含查询词、题库版本、session/room/match/角色 ID、昵称、token 或答案等高基数/私有值。
- [ ] 可从 fake clock/Playwright trace 证明瞬时故障恢复时长和结构性故障无周期重试；可从预发布指标查询或告警发现 fallback 异常升高。

## 9. 自动化与文档

- [ ] `pnpm lint:openapi`
- [ ] `pnpm check:openapi-refs`
- [ ] `task check:generated`
- [ ] `cd apps/api && go test ./... -count=1`
- [ ] `pnpm --filter @touhouflandre/web typecheck`
- [ ] `pnpm --filter @touhouflandre/web test`
- [ ] `pnpm --filter @touhouflandre/web build`
- [ ] 搜索与单人加载 Playwright 桌面和移动视口通过。
- [ ] `docs/architecture.md`、`docs/features.md` 和必要的部署配置说明已同步。

## 10. 发布与回滚

- [ ] 首次部署保持 `CHARACTER_SEARCH_MODE=remote` 并完成线上远程搜索抽查。
- [ ] 滚动升级先让整个 API fleet 支持策略、索引、结构化 404 和 CORS header，fleet 全兼容前策略保持 remote；抽查索引/缓存后才启用 local-primary。
- [ ] 线上索引响应、缓存头、内容版本和体积抽查通过后才切换 `local-primary`。
- [ ] 已实际演练服务端切回 `remote`，无需发布 Web、清缓存或迁移数据库。
- [ ] 回滚先切 remote 并等待传播/抽查已打开页面停止本地，再回滚 API binary；不要求清浏览器缓存或结束题局。
- [ ] local-primary 启用后的观察窗口内 fallback reason、索引错误和远程错误率无未解释异常，发布前可控 trace 的恢复用例全部通过；异常时只改服务端策略即可止损。
- [ ] 回滚旧 API binary 时新 Web 自动远程搜索，回滚旧 Web 时旧接口仍工作。
- [ ] 发布后抽查角色目录、单人、竞速和接力，并记录一个弱网样本。

## 验收记录模板

```markdown
## HSO-007 验收记录（YYYY-MM-DD）

- 提交：
- 环境：
- 生产题库版本 / 索引 schema：
- 契约与生成物：
- Go / Web 测试：
- Playwright：
- 搜索一致性：
- 冷/热/弱网性能：
- 瞬时故障误回退 / 恢复：
- 结构性熔断无周期重试：
- 坏缓存 repair：
- fallback 指标 / 日志脱敏：
- scope mode strict/full 与跨源 CORS：
- resolve 幂等重试/并发与迁移：
- 单人请求数量：
- local-primary 启用：
- remote 紧急回退演练：
- 兼容矩阵：
- 已知限制：
```
