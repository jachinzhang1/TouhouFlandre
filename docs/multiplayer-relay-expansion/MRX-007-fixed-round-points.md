# MRX-007：实现多人接力非淘汰固定轮数积分赛

**类型**：功能/规则 Issue  
**优先级**：P1  
**依赖**：MRX-006  
**建议标签**：`type:feature` `area:api` `area:multi` `area:test`

**决策依据**：[非淘汰计分](./decisions.md#8-非淘汰计分)、[淘汰排名](./decisions.md#10-淘汰排名)

## 要解决的问题

N>2 且关闭淘汰时，现有 `wins/targetWins` 无法表达“每轮所有 pair 都完成后累计 2/1/0 分，并打满 BO 的总轮数”。该策略应只消费 encounter outcomes，不依赖 turn 或棋盘实现。

## 要做到什么程度

- 实现 `FixedPointsPolicy` 纯函数：win +2、loss +0、draw 双方 +1、bye +0。
- match 开始时初始积分为 0，无上限；`plannedStages=FormatNumber(format)`，不使用 `TargetWins`。
- stage barrier 一次性批量写入 `scoreBefore/delta/scoreAfter`，发布所有 player 的结算明细。
- 未达到 planned stages 时请求 coordinator 创建下一 stage；达到后结束 match。
- 最终按总积分降序生成 competition ranking（`1,1,3`），不用 seat 或任何隐藏规则破同分。
- scoring policy 对离场只接受统一 outcome/status；异常提前结束规则由 MRX-009 负责。

## 属于本 Issue

- 固定轮数计分纯函数、match 初始化、stage settlement、match completion 和 ranking。
- 数据库查询、WS/OpenAPI 结算字段、snapshot standings 和规则测试。
- BO1/3/5/7 × 4/6/8 人、全平、并列第一和幂等重试测试。

## 不属于本 Issue

- 不实现淘汰、濒死、积分上限或按存留轮数排名。
- 不修改 encounter 规则、配对随机性或题目隔离。
- 不实现离场后奇数轮空和不足 2 人提前结束；MRX-009 负责。
- 不实现 Web 排行榜和统计落盘。

## 验收标准

- 4/6/8 人在每种 BO 下恰好完成 1/3/5/7 个 stage，不能因某玩家先达到分数而提前结束。
- 每个 encounter 的两名玩家积分增量分别为 2/0 或 1/1；任何 player 每 stage 最多结算一次。
- stage 未全部完成前公开积分不变；最后 encounter 完成后一个事务更新全员比分并发布一次 `stage.ended`。
- 全部平分或部分平分生成稳定共享名次；没有隐式单一 winner。
- 重连、snapshot 和事件 replay 得到相同 `scoreBefore/delta/scoreAfter` 与最终排名。
- N=2 不会选择本 policy，仍由 `legacy_wins` 结算。

## 可能涉及的代码

`apps/api/internal/multi/{relay_points.go,stage_coordinator.go,match.go}`（可新建/调整）、`apps/api/sql/queries/multi.sql`、`contracts/openapi/schemas/multi-match.yaml`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts`、server/domain tests。
