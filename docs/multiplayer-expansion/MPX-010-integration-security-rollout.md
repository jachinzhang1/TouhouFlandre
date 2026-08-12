# MPX-010：完成跨模式验收、安全审计与分阶段发布

**类型**：质量/发布 Issue  
**优先级**：P0（发布闸门）  
**依赖**：MPX-006、MPX-009  
**建议标签**：`type:quality` `area:test` `area:security` `area:ops`

## 要解决的问题

多人扩展同时触碰迁移、实时协议、并发规则和前端状态。单个 PR 的单测通过并不能证明不存在越权、序列缺口、容量竞态或移动端不可用。需要一个独立的发布闸门，避免未完成的能力被默认暴露。

## 属于本 Issue

- 从旧两人房间迁移到新模型的升级/回滚演练，以及已有房间在部署期间的兼容测试。
- race 2/3/4/8 人、relay 两人、spectator、断线重连、finished retention、聊天可见性和闭麦的完整 e2e 矩阵。
- 并发 join/guess/send、限流、慢消费者、事件重放/snapshot 补齐和服务重启终态测试。
- 隐私审计：玩家对手匿名字段、spectator 消息不向 player 投影、日志/错误/前端 DOM 不泄漏 token、答案或未授权消息。
- 指标、告警、feature flag、灰度策略、回滚说明和 `docs/multiplayer.md`/README 发布状态更新。

## 不属于本 Issue

- 不在测试阶段顺便改变游戏规则或聊天 scope。
- 不实现图片消息、管理员审核、账号化身份或 relay N 人。
- 不以“手工点过一次页面”替代自动化验收；发现功能缺陷应回到对应 Issue。

## 验收标准

- `pnpm typecheck`、`pnpm test`、`cd apps/api && go test ./...`、`task gen`、`task check:generated` 和多人 Playwright e2e 全部通过。
- 记录至少一次真实 Postgres 升级/回滚和一次并发压力结果；定义可接受的错误率、延迟和消息丢弃行为。
- 默认 feature flag 保持现有双人行为；灰度期间可按房间/模式关闭 N 人和聊天，关闭后已有房间仍可安全结束或只读回看。
- 安全审计无 P0/P1 越权问题，所有 P2 风险有负责人和后续 Issue；发布文档包含监控指标和回滚步骤。

## 可能涉及的代码与工具

`.github/workflows/`、`Taskfile.yml`、`scripts/`、`apps/api/internal/server/*_test.go`、`apps/api/internal/multi/*_test.go`、`apps/web/e2e/multiplayer.spec.ts`、部署环境变量和 `docs/` 发布说明。
