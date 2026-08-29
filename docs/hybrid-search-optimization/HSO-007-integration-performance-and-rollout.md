# HSO-007：完成一致性、性能、兼容与紧急回退发布验收

**类型**：集成/质量/发布 Issue  
**优先级**：P0，生产 local-primary 前阻断  
**依赖**：HSO-006  
**状态**：已完成（2026-08-29）
**建议标签**：`type:test` `area:performance` `area:reliability` `area:release` `area:docs`

## 要解决的问题

单元测试通过不能证明生产弱网体验改善，也不能证明动态 remote 开关能接管已打开页面。索引缓存头可能在 Go、Next 和 Cloudflare 之间丢失，新旧 Web/API 组合也可能破坏回退；一次正常瞬时波动还可能错误地造成长期远程降级，永久坏索引也可能周期性触发失败。发布前需要统一证据，而不是直接开启本地模式。

## 要做到什么程度

执行并填写 `release-gate.md`，比较 HSO-001 基线，验证全部模式语义、请求数量、冷/热/弱网性能、版本隔离、浏览器缓存、双向 binary 兼容和服务端紧急回退。先以 `remote` 部署，再在索引抽查通过后切换 `local-primary`；出现问题只改服务端策略即可恢复旧 Go 搜索。

## 属于本 Issue

- 补齐跨 Issue 集成测试、Playwright 网络断言和必要的最小兼容修复。
- 对同一 fixture 比较 Go 与浏览器结果，覆盖目录、单人、竞速和接力真实装配。
- 测量索引冷下载、浏览器缓存命中、本地输入、远程热连接、模拟高延迟/丢包和单人题局加载。
- 使用 HSO-001 故障矩阵演练策略与索引的单次/连续超时、408/429/5xx、坏缓存、结构性错误和恢复，记录结果来源、额外等待、退避、半开探针和熔断持续时间。
- 验证 Go 直连、Next 同源和生产代理/CDN 的 Content-Encoding、ETag、Cache-Control 与缓存命中。
- 在真实滚动部署或等价容器中验证混合 API fleet：升级完成前策略只能为 remote；先确认所有实例支持策略/索引端点、结构化 404 和 CORS，再抽查索引后才允许 local-primary。回滚先切 remote，等待传播后再回滚 API binary。
- 验证真实缺失版本的 `CATALOG_VERSION_NOT_FOUND` 与旧 binary 路由缺失的 `COMPATIBILITY_ROUTE_MISSING` 区分，错误响应均不被缓存。
- 注入 snapshot 投影/序列化失败，验证 source 层和远程 Go 搜索仍可用；注入底层 CatalogSnapshot 失败，验证最终错误和 readiness/指标准确暴露而非伪装成成功 fallback。
- 演练 local-primary -> remote，确认已打开页面在 60 秒或 focus 重验时切换；保留不可变索引不影响回退。
- 演练旧 Web/新 API、新 Web/旧 API、Web 回滚和 API 回滚。
- 演练 resolve 相同幂等键的超时重试和双标签页并发，确认只产生一个 session。
- 检查搜索快照公开字段、客户端篡改和范围外 guessId 的服务端拒绝。
- 检查 `/metrics` 和结构化日志中的策略、索引、fallback、远程错误/延迟信号；固定枚举之外折叠为 unknown，任何查询词、题库/题局/房间/角色标识和答案都不得成为标签。
- 同步稳定架构、功能、部署和故障处理文档；填写发布验收记录。

## 不属于本 Issue

- 不新增搜索字段、改变匹配排序或调整题库范围产品规则。
- 不在验收阶段删除远程接口、旧创建/恢复接口或兼容路径。
- 不为达成指标引入 Redis、Service Worker、Web Worker、第三方搜索库或搜索快照迁移；HSO-005 的 additive 幂等迁移按其 Issue 方案验收，不在本 Issue 临时新增。
- 不用降低 fixture、跳过弱网用例或放宽 fail-closed 规则来让闸门通过。
- 不进行未获授权的生产写入、压力测试或流量切换；线上检查保持只读和低频。

## 可能涉及的代码与文档

- `apps/web/e2e/` 下搜索、单人加载和兼容场景
- API/Web 相关测试中的跨模块 fixture 与测试配置
- `docs/hybrid-search-optimization/{baseline.md,release-gate.md}`
- `docs/{architecture.md,features.md,deployment.md}`
- 生产环境变量与反向代理缓存配置说明

## 验收标准

- [x] `release-gate.md` 每一项有命令、环境或人工检查证据，无无证据勾选。
- [x] 本地搜索全部黄金样例和四个真实入口与 Go 结果有序一致。
- [x] 本地索引就绪后的输入搜索 API 请求数为零，P95 小于 16ms。
- [x] 搜索快照压缩体积不超过 HSO-001 冻结预算，热缓存不重新传输主体。
- [x] 随机新局和每日恢复/创建主流程各只有一次主请求，统计/计时行为无回归。
- [x] 弱网下冷索引失败可远程搜索；同一页面已有已校验内存索引且仍在 5 分钟宽限内时断网可本地搜索；刷新页面、超出宽限或无内存索引时不宣称离线，远程失败显示可重试错误，提交猜测仍明确报告网络错误。
- [x] 已加载索引时单次策略超时/5xx 不切走本地；单次索引瞬时失败会远程一次并在规定退避后通过单探针恢复，本页不需要刷新。
- [x] 同一结构性错误在相同 policy revision 下不会按 60 秒周期重复索引请求或反复显示 loading；revision 变化或显式 retry 后只探测一次。
- [x] 坏 HTTP 缓存的强制 reload 成功后恢复本地；修复仍坏时稳定远程，均不要求玩家清浏览器数据。
- [x] snapshot 层故障不影响 source 层远程搜索；共享底层数据故障产生准确的最终错误、readiness/指标信号且无循环重试。
- [x] strict/full scope 配置下游戏入口的本地/远程范围与旧远程语义一致，未出现全量泄漏。
- [x] 四种 Web/API 版本组合和 remote/local-primary 组合均通过既定冒烟用例。
- [x] 带 fallback reason 的跨源预检、无 header 重试和旧 API 省略 header 均通过。
- [x] 服务端切回 remote 的实际演练不要求发布 Web、清除浏览器缓存、改数据库或结束当前题局。
- [x] resolve 幂等重试、不同指纹冲突和并发创建的结果符合契约，幂等记录迁移可回滚且不改变旧 create-only API。
- [x] 低基数生产指标可区分策略不可用、索引瞬时/结构性故障和 engine error，并能发现 fallback 异常升高；可控测试 trace 可计算熔断持续时间与恢复成功率；敏感值和高基数值扫描为零。
- [x] 全量 Go、Web、OpenAPI、生成漂移、build 和目标 E2E 全部通过。
- [x] 稳定文档准确描述本地优先、远程权威回退和单人 resolve 边界。

## 测试计划

- 按发布闸门顺序执行 contract/codegen、Go、Web unit/type/build、Playwright desktop/mobile。
- 使用代理或 Playwright network emulation 覆盖正常网络、低于/超过显式超时的高延迟、单次/连续丢包、断网恢复和坏缓存，不对生产施压。
- 使用 fake clock 或浏览器可控时钟验证 5 分钟策略宽限和完整退避序列，E2E 不实际等待数分钟。
- 用两套 API/Web binary 或等价容器运行兼容矩阵；仅 mock 404 不能替代至少一次真实旧 binary 测试。
- 用滚动升级顺序执行一次 mixed fleet 测试，记录策略 mode、索引请求、404 错误码、Cache-Control 和切换/回滚时间。
- 在本地或预发布环境改变 `CHARACTER_SEARCH_MODE` 与 policy revision，记录页面切换时间、网络请求、fallback reason、熔断状态和恢复时间。
- 最终 diff 审计确认没有删除旧路径、答案泄露、生成物手改或未记录配置。

## 依赖与完成记录

依赖 HSO-006 完成所有入口。只有本 Issue 可以将生产建议从 remote 改为 local-primary；任一回退、范围、安全或兼容项失败都阻断切换。

完成时追加 `实施与验收记录（YYYY-MM-DD）`，列出精确命令与结果、性能表、部署顺序、实际回退耗时、瞬时故障恢复/结构性故障稳定性/缓存修复证据、同页离线边界、幂等重试证据、观测指标截图或查询、偏离原计划的内容和仍保留的限制；同时把 README 状态表更新为真实状态，不改写各 Issue 的原始范围。

## 实施与验收记录（2026-08-29）

- 已补齐跨 Issue 集成收口：混合路由现在会在 last-known-good 超过 5 分钟后回到远程，并用 fake clock 覆盖 5 秒/30 秒/2 分钟/5 分钟瞬时退避、并发单探针、相同 revision 的结构性熔断和已打开页面的 remote 接管。索引结构化错误区分真实缺失版本与旧 binary 路由缺失；fallback engine error、固定低基数 metrics 和路由模板日志脱敏均有回归测试。
- 3 秒策略和 5 秒索引超时现以 1ms below/equal/above 矩阵锁定，用户取消不写入熔断；索引键变化、policy revision、页面重载和显式 retry 的单探针恢复均有确定性回归。API HTTP 测试分别注入 snapshot 投影失败和共享 CatalogSnapshot source 失败：前者索引返回 503 但 Go 远程与 `/readyz` 继续成功，后者索引 503、远程最终 500、`/readyz` 503，并在 source/snapshot/remote 低基数指标中暴露；失败不缓存，每个显式请求只重试一次。
- React StrictMode 下 `CharacterSearchProvider` 的 effect probe 不再永久 dispose 共享路由；`SingleGamePage` 的 resolve 意图跨 probe 复用，同一 random/daily 页面只发起一次 resolve，不会创建重复 session。真实卸载仍会使未完成请求失效，迟到响应不会写入 localStorage 或统计。目标 Playwright 同时断言索引就绪后的输入不访问 `/api/characters/search`，并在本地 disposable 数据库中 forfeit 清理创建的 session。
- 契约与生成验证通过：`pnpm lint:openapi`、`pnpm check:openapi-refs`、`task gen` 和 `task check:generated`。Go 验证通过：`task test:go`，覆盖 game/handler/server 和 `0023_puzzle_resolve_idempotency` 迁移。Web 验证通过：`pnpm --filter @touhouflandre/web typecheck`、`pnpm --filter @touhouflandre/web exec vitest run --no-file-parallelism --maxWorkers=1`（63 files，336 tests）和 `pnpm --filter @touhouflandre/web build`。默认并行 Vitest 在当前 7.6 GiB WSL 环境中出现 19 个无关的 5 秒资源竞争超时，单 worker 全量重跑全部通过。
- local-primary 目标 E2E 命令为 `HSO007_API_BASE_URL=http://127.0.0.1:4400 HSO007_ALLOW_WRITES=1 pnpm --filter @touhouflandre/web exec playwright test e2e/hso-007-integration.spec.ts --project=desktop-chromium --project=mobile-chromium`，结果为 18 passed、2 个 legacy-only skipped。测试从真实 catalog、random session、race match 和 relay match 装配版本/范围，以两组排序/分页输入比较本地内核与 Go 远程的 ID 顺序和 total；并覆盖 immutable/ETag/304、角色目录、random/daily、每页一次 resolve、本地输入零远程搜索和本地数据清理。
- 真实旧 API binary 兼容使用一个以 `API_PROXY_TARGET=http://127.0.0.1:4000` 启动在 5174 的新 Web，并执行 `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5174 PLAYWRIGHT_USE_WEB_SERVER=0 HSO007_API_BASE_URL=http://127.0.0.1:4000 HSO007_EXPECT_LEGACY_API=1 pnpm --filter @touhouflandre/web exec playwright test e2e/hso-007-integration.spec.ts --project=desktop-chromium --project=mobile-chromium --grep "legacy API binary"`，结果为 2 passed。新 Web 在策略端点 404 时使用旧 Go 搜索，并省略 fallback header；临时 5174 服务在验证后已关闭。
- 当前题库 `2352fabd` 含 170 个角色；真实索引为 94,739 bytes identity、18,588 bytes gzip，低于 HSO-001 的 90,900 bytes gzip 预算。使用 `pnpm exec tsx -e` 调用真实索引和同一 `searchCharacters` 内核，100 次 warmup 后采集 1,000 次同步查询：P95 0.243ms、P99 0.422ms；`engine.test.ts` 另以固定生产规模数据持续断言 P95 小于 16ms。
- Chromium 性能采样记录：桌面/移动冷索引 16.00/11.20ms、transfer 18,888 bytes，热浏览器缓存 1.10/1.60ms、transfer 0 bytes；各 30 次远程热连接 P95 为 9.61/11.22ms。random/daily ready 为 1002.61/1188.81ms（桌面）和 1040.00/1022.66ms（移动），均为 6 个 API 请求；相对 HSO-001 的 random 5435.87ms/8 和 daily 4875.50ms/7 均改善。阻塞索引预取时题局与输入先渲染，释放索引后的 PerformanceObserver 未记录 longtask。
- Playwright 通过浏览器可控 `Date.now` 注入连续两次索引丢包：首次冷失败只远程一次，含 ±20% 抖动的最大 6 秒/累计 42 秒边界各只有一个半开探针，第三次恢复本地且不再远程。同页已验证索引在策略断网且 5 分钟内继续本地；300001ms 后、刷新页面或无内存索引时远程失败显示“重新加载”，联网后显式 retry 恢复。本地候选已可见但提交猜测断网时保留题局并显示网络错误。`GuessInputBar.test.tsx` 另验证路由来源变化不会清除 guessedIds 或允许重复提交。
- 本地回退演练将 API 4400 以 `CHARACTER_SEARCH_MODE=remote`、`CHARACTER_SEARCH_POLICY_REVISION=hso007-rollback` 启动；策略立即返回 remote，原 Go 搜索继续成功，未修改 Web、数据库或不可变索引缓存。已打开页面在 60 秒重验时接管由确定性路由测试覆盖。发布顺序保持：应用 additive 0023 迁移，整个 API fleet 以 remote 升级并抽查，再部署 Web，最后才允许 local-primary；回滚先切 remote、等待传播，再回滚 binary，生产不执行 down migration。
- `docs/architecture.md`、`docs/features.md`、`docs/deployment.md` 已同步本地优先、远程权威回退、策略 revision、缓存和单人 resolve 边界。未修改远程接口、旧 create/session 路径、WebSocket 协议或搜索语义。
- 使用 detached `e41cbd9` 构建真实旧 API、旧 Web 镜像，并与当前 `44231d6` + HSO-007 工作树镜像完成旧 Web/旧 API、旧 Web/新 API、新 Web/旧 API、新 Web/新 API 的桌面和移动兼容矩阵。每个 legacy 组合均验证真实页面搜索；新增 binary E2E 还验证旧 Web 不调用 resolve、新 Web 收到旧 API resolve 404 后只执行一次旧 catalog/create 流程并清理 session。首次临时 Web 容器仅注入构建期 proxy target，production route handler 因缺少运行期 `API_PROXY_TARGET` 返回 502；按正式 Compose 同时注入构建期和运行期变量后全部通过，未改兼容逻辑来掩盖装配错误。
- 在本机 `task prod:up` 的 production Compose 等价环境执行完整发布序列：新 API/Web 首先以 `remote` 部署；真实旧 API 与两个新 API 容器组成 mixed fleet，旧实例策略/索引为真实 404 而旧搜索 200，新实例保持相同 remote revision，逐实例验证结构化 404、CORS 和索引后才排空旧实例并切 `local-primary`。两个 local-primary 新实例返回相同 revision。该仓库生产拓扑未配置独立 CDN，故 CDN 专属检查不适用；最终 Next 代理与 Go 直连已分别验证。
- production Go 直连索引为 94,739 bytes identity，Next 最终代理为 gzip 18,588 bytes；两层 ETag 均为 `930c5e7e...33e9`，条件请求均为 304，解压后 SHA-256 均为 `5c8cd391...771d4`，缺失版本经代理仍为 `CATALOG_VERSION_NOT_FOUND` + `no-store`。
- 保持 Playwright CLI 页面不刷新，从 local-primary 输入“灵梦”时无远程搜索请求；API 以 `hso007-live-rollback` 重建为 remote 后，页面重新获得焦点并读取新策略，输入“魔理沙”出现真实 `/api/characters/search` 200。随后在同一 `:4000` 前门回滚到 `e41cbd9` 旧 API，策略真实 404 而同一页面继续远程显示“十六夜咲夜”；再在同一 `:3000` 前门回滚旧 Web，搜索和单人桌面/移动冒烟继续通过。未发布额外 Web、未清缓存、未回滚迁移、未结束现有页面。
- 新增 Prometheus 告警 `CharacterSearchFallbackSpike`、`CharacterSearchProviderFailure` 和 `CharacterSearchRemoteError`。`promtool check rules` 验证 9 条规则；受控注入后 `index_transient=12`、5 分钟 increase 约 8.19，fallback 告警实际进入 firing。最终 local-primary 发布后完整 production Compose E2E 为 18 passed/4 legacy-only skipped；四入口 parity 与弱网样本均通过。约 72 秒多轮 scrape/evaluation 观察中，受控 `index_transient=4`、正常 `none=86` 均保持不变，provider/remote error 与搜索告警为空。
