# MRX-013：完成跨模式集成、安全审计与灰度发布

**类型**：质量/发布 Issue  
**优先级**：P0（发布闸门）  
**依赖**：MRX-012（传递依赖 MRX-001 至 MRX-011）  
**建议标签**：`type:quality` `area:test` `area:security` `area:ops`

**决策依据**：[决策记录](./decisions.md)全部章节  
**执行清单**：[发布闸门](./release-gate.md)  
**覆盖矩阵**：[测试矩阵](./test-matrix.md)

## 要解决的问题

并行接力同时改变底层模式调度、数据库、实时协议、并发结算、历史和 Web 状态。单个规则或组件测试无法证明旧玩法无回归，也无法覆盖答案泄漏、stage 重复结算、v2/v3 切换和最大 fan-out。需要独立发布 Issue 只做集成修复与上线验证。

## 要做到什么程度

- 在真实 PostgreSQL/API/WS 环境完成 2/4/6/8 relay 三种 rule set、race wins/points/placement、spectator、chat、断线和 rematch 全矩阵。
- 演练 expand-only migration、旧数据读取、新 binary 回滚、v2 房间排空和 v3 客户端刷新。
- 审计鉴权、capability、答案投影、跨房间 ID、幂等、Origin、限流、XSS/纯文本、日志脱敏和慢消费者。
- 压测 8 player + spectatorCap、4 个并发 encounter、长 stage/history、同时 turn timeout 和结算；记录 p95/p99 与 WS payload。
- 分别验证两个服务端与两个 Web rollout flag 的组合、关闭/回滚策略和已开始 match 的 grandfather 行为。
- 验证 full、race-only、relay test module 三种 registry 装配及 core/race/relay 静态依赖规则；证明 relay 可关闭且 race 不需要 relay repository/projector。
- 完成桌面/移动可访问性、视觉回归、用户文档与公告。

## 属于本 Issue

- 集成发现的小范围修复、e2e/load/security tests、监控面板/告警、发布脚本和文档更新。
- v2 停止新建、短期房间排空/关闭、v3 切换与旧页面刷新演练。
- `0015+` migration、RuleSetRef 兼容映射和 stats v1-v6 升级演练。
- `docs/multiplayer.md`、`docs/gameplay.md`、`docs/architecture.md` 和部署配置同步。

## 不属于本 Issue

- 不在发布阶段重新设计计分、配对、濒死或历史协议；语义问题退回拥有它的 MRX Issue。
- 不顺手修复无关题库、聊天产品需求或 race 玩法。
- 不在发布阶段把 mode-owned 逻辑重新上提到 core 来临时绕过集成问题。
- 不在负载不达标时静默降低规则正确性或可见性；应优化查询/投影或保持 flag 关闭。

## 验收标准

- [发布闸门](./release-gate.md)全部 P0 项完成并记录命令、环境、提交和结果。
- [测试矩阵](./test-matrix.md)中所有 required case 自动化通过，无未解释 flaky/skip。
- 现有 2 人 relay 与 race 2/3/4/8 的 REST、WS、snapshot、UI、chat 和 stats 无行为回归。
- race-only 装配和 relay flag-off 路径不读取 relay 表、不注册 relay projector，依赖检查无跨模式 import。
- 最大房间下普通 turn 不因全局 stage 锁被长时间串行；并发完成只结算一次，数据库无死锁。
- 玩家不能通过其他 encounter API、WS、snapshot、history、错误或日志获取进行中答案；完整标签的有意可见性已单独验收。
- v3 灰度关闭后新建 N 人 relay 被服务端拒绝，双人 relay/race 正常；回滚不丢新表数据。
- 用户公告、稳定玩法文档、架构图、配置说明与实际默认开关一致后才允许默认开放。

## 可能涉及的代码

全仓测试与配置；重点为 `apps/api/internal/server/`、`apps/web/e2e/`、`scripts/`、`compose*.yaml`、`.env.example`、`docs/{multiplayer.md,gameplay.md,architecture.md,deployment.md}`、监控与发布配置。
