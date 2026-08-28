# HSO-007：完成一致性、性能、兼容与紧急回退发布验收

**类型**：集成/质量/发布 Issue  
**优先级**：P0，生产 local-primary 前阻断  
**依赖**：HSO-006  
**状态**：未开始  
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

- [ ] `release-gate.md` 每一项有命令、环境或人工检查证据，无无证据勾选。
- [ ] 本地搜索全部黄金样例和四个真实入口与 Go 结果有序一致。
- [ ] 本地索引就绪后的输入搜索 API 请求数为零，P95 小于 16ms。
- [ ] 搜索快照压缩体积不超过 HSO-001 冻结预算，热缓存不重新传输主体。
- [ ] 随机新局和每日恢复/创建主流程各只有一次主请求，统计/计时行为无回归。
- [ ] 弱网下冷索引失败可远程搜索；同一页面已有已校验内存索引且仍在 5 分钟宽限内时断网可本地搜索；刷新页面、超出宽限或无内存索引时不宣称离线，远程失败显示可重试错误，提交猜测仍明确报告网络错误。
- [ ] 已加载索引时单次策略超时/5xx 不切走本地；单次索引瞬时失败会远程一次并在规定退避后通过单探针恢复，本页不需要刷新。
- [ ] 同一结构性错误在相同 policy revision 下不会按 60 秒周期重复索引请求或反复显示 loading；revision 变化或显式 retry 后只探测一次。
- [ ] 坏 HTTP 缓存的强制 reload 成功后恢复本地；修复仍坏时稳定远程，均不要求玩家清浏览器数据。
- [ ] snapshot 层故障不影响 source 层远程搜索；共享底层数据故障产生准确的最终错误、readiness/指标信号且无循环重试。
- [ ] strict/full scope 配置下游戏入口的本地/远程范围与旧远程语义一致，未出现全量泄漏。
- [ ] 四种 Web/API 版本组合和 remote/local-primary 组合均通过既定冒烟用例。
- [ ] 带 fallback reason 的跨源预检、无 header 重试和旧 API 省略 header 均通过。
- [ ] 服务端切回 remote 的实际演练不要求发布 Web、清除浏览器缓存、改数据库或结束当前题局。
- [ ] resolve 幂等重试、不同指纹冲突和并发创建的结果符合契约，幂等记录迁移可回滚且不改变旧 create-only API。
- [ ] 低基数生产指标可区分策略不可用、索引瞬时/结构性故障和 engine error，并能发现 fallback 异常升高；可控测试 trace 可计算熔断持续时间与恢复成功率；敏感值和高基数值扫描为零。
- [ ] 全量 Go、Web、OpenAPI、生成漂移、build 和目标 E2E 全部通过。
- [ ] 稳定文档准确描述本地优先、远程权威回退和单人 resolve 边界。

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
