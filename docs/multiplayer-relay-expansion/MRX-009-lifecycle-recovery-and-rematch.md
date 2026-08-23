# MRX-009：收口并行接力的离场、恢复与再来一局

**类型**：可靠性/生命周期 Issue  
**优先级**：P0  
**依赖**：MRX-007、MRX-008  
**建议标签**：`type:feature` `area:api` `area:multi` `area:reliability`

**决策依据**：[离场、断线与异常终态](./decisions.md#11-离场断线与异常终态)、[再来一局](./decisions.md#12-再来一局)、[事务与锁序](./decisions.md#14-事务与锁序)

## 要解决的问题

多个 encounter 并行后，离场、断线超时、服务重启和 rematch 都可能同时影响一张棋盘、stage 屏障和最终排名。沿用“对手就是另一个 room slot”的处理会误结算其他 pair，遍历 sweeper 结果还可能制造非确定胜者。

## 要做到什么程度

- 短暂断线只更新 member connection state，计时器继续；宽限期内恢复相同 encounter/turn。
- 主动 leave 或宽限逾期在锁定所属 encounter 后处理：未结束则该玩家负、对手胜；双方同时永久离场则 draw。
- `left` 从后续配对移除。points 模式继续到 planned stages；奇数 active 使用 bye，不足 2 人提前结束。elimination 模式按当前 stage 记录存留终止但不触发濒死保护。
- 批量处理同一 `now` 到期成员，结果不能依赖数据库遍历顺序。
- 服务启动恢复/优雅排空扫描活动 encounter 和未完成 settlement；能恢复则继续，不能恢复则发布明确 `server_restart` 终态。
- rematch 仍要求原 roster 完整、connected 且全员确认；淘汰者可确认，left 成员阻止；新 match 全量重置积分、生命状态、pairing 和答案。
- finished retention、closed cleanup、chat role 和 spectator capability 沿用现有生命周期。

## 属于本 Issue

- leave/disconnect grace/sweeper/restart/rematch 的领域与事务实现。
- 异常 match end reason、事件、snapshot 和错误码。
- 同时离场、离场与猜中、离场与 turn timeout、重启 settlement 的并发/恢复测试。
- 2 人 relay 和 race 现有离场语义的兼容回归。

## 不属于本 Issue

- 不设计断线暂停全房间或投票暂停。
- 不允许替补、重入 roster 或 finished 后重新认领 seat。
- 不因异常离场改变正常计分常量。
- 不实现 Web 提示和历史加载。

## 验收标准

- 某 pair 的玩家离场只终止该 encounter，其他 encounter 继续；最后完成时 stage 仍恰好结算一次。
- 同一 pair 双方同时过期得到 draw，不因 sweeper 顺序给任一方胜利。
- points 模式离场后可用 3/5/7 active roster 完成余下 stages，bye 不加分；只剩一人时明确提前结束。
- elimination 模式离场者的 `survivedStages` 与当前 stage 一致，且不消耗/授予 near-death。
- 重启后 pairing、answer、turn、积分和事件 sequence 不重建、不重复；无法恢复时客户端收到明确终态。
- 淘汰玩家可以 rematch，left 玩家使 rematch 稳定返回 `REMATCH_NOT_AVAILABLE`；新 match 状态完全重置。
- race 与双人 relay 的 leave/disconnect/rematch 基线无回归。

## 可能涉及的代码

`apps/api/internal/multi/{member.go,sweeper.go,restart.go,forfeit.go,stage_coordinator.go}`、`apps/api/internal/handler/{rooms.go,matches.go}`、`apps/api/sql/queries/multi.sql`、`contracts/openapi/schemas/multi-*.yaml`、`contracts/ws/protocol.yaml`、server recovery/concurrency tests。
