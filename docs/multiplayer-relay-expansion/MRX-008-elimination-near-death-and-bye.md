# MRX-008：实现多人接力淘汰、濒死、轮空与存留排名

**类型**：功能/规则 Issue  
**优先级**：P0  
**依赖**：MRX-006  
**建议标签**：`type:feature` `area:api` `area:multi` `area:test`

**决策依据**：[淘汰计分与濒死](./decisions.md#9-淘汰计分与濒死)、[配对与轮空](./decisions.md#5-配对与轮空)、[淘汰排名](./decisions.md#10-淘汰排名)

## 要解决的问题

淘汰赛不是现有 race placement 的变体：它从 10 分开始、负分触发一次濒死保护、扣分随 stage 增长，并可能在一次结算后留下奇数玩家或同时淘汰所有人。需要独立 scoring policy，不能把状态转换散落到 encounter 或 Web。

## 要做到什么程度

- 实现 `EliminationPolicy` 纯函数，输入 stage index、旧积分/生命状态和 outcome，输出积分、状态、淘汰 stage 与 match 终止。
- 初始 10 分、上限 10；胜 +1、负 `-n`、平各 `-floor(n/2)`、bye 0。
- 精确实现首次 `<0` 钳制为 0 并把 relay `lifeState` 改为 `near_death`；公共参与状态仍为 active。near-death 不再加分，下一次真实负分后淘汰。
- 批量结算允许 0..N 人同时淘汰；结算后 active `<=1` 即结束，不创建空 stage。
- 新 stage active 为奇数时使用 MRX-005 bye 计划，bye 分数/状态不变且不能连续。
- 最终只按 `survivedStages` 排名，唯一 survivor 优先；积分不破同分。
- 不套用 BO 或任意安全轮数上限；正常终止只由 stage 结算后的存留人数决定。
- 所有变化以结构化 `scoreDelta/lifeTransition/eliminatedMemberIds/byeMemberId` 投影。

## 属于本 Issue

- 计分、濒死状态机、淘汰与终止纯函数。
- match/stage player 持久化、约束调整、stage settlement 与排名。
- round/stage event、snapshot standings 和服务端规则/并发测试。
- 多人降为 2 人后继续淘汰 policy 的测试。

## 不属于本 Issue

- 不改变 2 人 relay 的 BO 规则。
- 不按积分或 seat 打破存留轮数并列。
- 不增加多次复活、回血道具、轮空加分或房主可调常量。
- 不处理主动离场/断线宽限；MRX-009 负责把异常转为统一 status/outcome。
- 不实现 UI 样式。

## 验收标准

- 普通玩家从正分扣到恰好 0 时仍为 active；首次扣到负数时变为 near-death 且公开分为 0。
- near-death 获胜时仍为 0；平局在 `floor(n/2)=0` 时不淘汰；下一次负分后保留负分并淘汰。
- 胜者在 10 分时不会超过上限；同一 stage 多人状态在一个事务中一致可见。
- 3/5/7 名 active 时恰有一名 bye，连续至少 20 个确定性计划中无人连续 bye；bye 的积分和状态完全不变。
- 一轮淘汰多人、仅剩一人、全部淘汰和并列 survival ranking 均有表驱动测试。
- 最终唯一 survivor 为 rank 1；全部同时淘汰时允许并列第一且 `winnerMemberId=null`。
- settlement 重试不会重复濒死、重复扣分或修改已经冻结的 bye/pairing。

## 可能涉及的代码

`apps/api/internal/multi/{relay_elimination.go,stage_coordinator.go,pairing.go}`（可新建/调整）、`apps/api/sql/queries/multi.sql`、相关 migration、`contracts/openapi/schemas/multi-match.yaml`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts`、server/domain tests。
