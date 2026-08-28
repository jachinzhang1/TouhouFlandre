# HSO-001：冻结混合搜索契约、性能基线与一致性样例

**类型**：契约/基线 Issue  
**优先级**：P0  
**依赖**：无  
**状态**：未开始  
**建议标签**：`type:architecture` `area:api` `area:web` `area:test` `area:performance`

## 要解决的问题

当前搜索语义只由 Go 测试表达，公网耗时来自人工采样，新的索引 payload、策略开关和回退条件尚无可执行基线。若服务端和 Web 并行实现时各自解释名称归一化、字段边界、范围和排序，最终即使都“能搜索”也可能返回不同结果；没有固定采样方法也无法证明优化是否有效。

## 要做到什么程度

建立语言无关的搜索黄金样例和可重复性能基线，冻结 HSO 后续 Issue 使用的 wire shape、兼容矩阵、缓存键、失败分类和测量口径。本 Issue 不增加生产端点，也不切换任何用户流量。

黄金样例至少覆盖：简繁日英/罗马字、别名、全半角、大小写、空白与中点/连字符、作品 ID/标题/拼音首字母、`THxx`、字段边界反例、共享别名、多过滤器、空允许范围、排序 tie-break、升降序和分页。

基线脚本固定记录（生产只读；涉及创建题局的场景只在 disposable local/pre-release 数据库执行）：

- 当前 `/api/characters/search` 的热连接与独立连接延迟；
- 当前 `/api/catalog/characters`、`/api/catalog/full` 的未压缩和压缩体积；
- 使用预先创建 session 测量生产/共享环境的每日和随机恢复请求瀑布；随机 fresh、daily fresh/expired 只在 disposable local/pre-release 数据库测量，并在每轮后清理；
- 当前题库角色数、可猜数和测试环境信息；
- 浏览器桌面与移动视口下搜索输入到建议可见的时间。

每个场景先执行 warmup，再收集至少 30 个有效样本（建议 50），报告 p50/p95/p99、请求数量、失败/重试数量、环境和网络条件；一次采样只用于比较，不构成 SLA。

## 属于本 Issue

- 在本目录新增未包含答案的 `fixtures/search-parity-v1.json`，定义输入角色、查询参数、允许 ID、期望有序 ID 和 total。
- 新增只读采样脚本或 Playwright 基线用例；生产脚本不得修改数据库、题库或生产数据；可写的 fresh 场景必须显式指向 disposable 数据库并执行 cleanup/rollback。
- 在 `baseline.md` 记录日期、提交、环境、网络条件、命令、响应体积和结果，不把一次采样写成永久 SLA。
- 校对并冻结 `decisions.md` 中的端点、schema version、策略模式、请求超时、last-known-good 宽限、瞬时/结构性故障分类、半开退避、缓存强制修复、上下文和回退语义。
- 建立语言无关的故障矩阵 fixture，逐项列出策略/索引响应、既有状态、期望结果来源、熔断分类、下一次允许探测时间和 fallback reason；后续 Web 路由测试直接消费，不在测试中重新解释规则。
- 列出新旧 Web/API 四种版本组合的预期行为，作为后续兼容测试输入。

## 不属于本 Issue

- 不新增或修改生产 OpenAPI 路径、handler、Next 代理或环境变量。
- 不实现 TypeScript 搜索算法、服务端 Provider、缓存或混合 Hook。
- 不修改单人题局加载流程。
- 不根据基线结果提前宣称优化完成或勾选发布闸门。

## 可能涉及的代码与文档

- `docs/hybrid-search-optimization/{decisions.md,baseline.md,fixtures/}`
- `apps/api/internal/game/search_test.go`（只允许补充当前语义缺失的基线断言）
- `apps/web/e2e/` 或 `scripts/` 下的只读性能采样入口
- 测试命令说明和输出格式

## 验收标准

- [ ] 黄金样例可由 Go 和 TypeScript 测试直接读取，不包含语言专属字段或执行逻辑。
- [ ] 每一种当前搜索字段、归一化规则、过滤顺序、排序和分页规则至少有一个正例或反例。
- [ ] 空 `selectedCharacterIds` 的期望结果明确为零，不能回退整表。
- [ ] 基线可由一条文档化命令重复执行，输出包含环境和题库版本，失败时不会写生产状态。
- [ ] `baseline.md` 同时记录请求数量、端到端时间和 payload 体积，而非只记录 handler 计算时间。
- [ ] 决策记录不存在影响 HSO-002/003/004/005 实现的“待定”项。
- [ ] 兼容矩阵覆盖新旧 Web/API、remote/local-primary、索引失败和策略失败。
- [ ] 故障矩阵覆盖策略冷启动/重验、3 秒策略超时、5 秒索引超时、5 分钟 last-known-good 边界、各级退避、单探针半开、强制缓存修复成功/失败和 policy revision 变化。
- [ ] 性能基线记录正常网络与模拟瞬时超时/5xx 的误回退次数和额外等待，证明超时边界不会把已采样的正常 P95 当作故障。
- [ ] 生产采样只读且使用预先创建 session；fresh 场景仅在 disposable 数据库运行并清理，所有场景至少有 30 个有效样本和 p50/p95/p99。

## 测试计划

- 对搜索与故障 fixture 做 JSON/schema 校验，确认 ID/用例名唯一、引用存在、期望结果无重复且所有 fallback reason 属于固定枚举。
- 用当前 Go 搜索实现跑 fixture，任何不一致都必须在开始新实现前解释并修正 fixture 或决策。
- 在本地热连接、冷连接和浏览器模拟弱网各完成 warmup 后至少 30 次有效采样，记录 p50/p95/p99、请求数和误回退/额外等待；公网只读采样不得创建题局或施加负载。
- 运行现有 Go 搜索测试和相关 Web 搜索用例，保留基线结果。

## 依赖与后续

本 Issue 完成后，HSO-002 与 HSO-003 可以基于同一契约并行；HSO-005 在 HSO-002 生成物稳定后实现新增 resolve 端点。任何后续语义调整必须先更新黄金样例并说明兼容影响。
