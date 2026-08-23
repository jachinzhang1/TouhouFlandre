# MRX-006：实现独立题目与独立 turn 的接力 encounter 引擎

**类型**：功能/核心规则 Issue  
**优先级**：P0  
**依赖**：MRX-005  
**建议标签**：`type:feature` `area:api` `area:multi` `area:contracts`

**决策依据**：[题目隔离](./decisions.md#6-题目隔离)、[Encounter 规则](./decisions.md#7-encounter-规则)

## 要解决的问题

当前 relay turn 直接读取 round 的单一 answer/turn slot，并使用 `[2]int` 和 room seat 1/2。多人 stage 需要每对玩家拥有完全独立的答案、轮次计数、空过额度、deadline 和胜负，同时仍保持现有双人接力的规则体验。

## 要做到什么程度

- 为每个 stage plan 的 encounter 从题库范围独立抽题，同 stage 无放回；答案池不足时原子失败，不留下半个 stage。
- encounter 使用 `memberId`/side 做权威行动者，seat 只作展示；初始先手与后续换手由纯函数决定。
- guess/pass/forfeit 端点显式定位 `stageIndex + encounterId`，校验成员属于该 encounter 且当前有 capability。
- turn、重复猜测、幂等、每人最大轮次、每人 2 次空过、turn timeout 和 encounter deadline 都在 encounter 范围结算。
- 正确、违规空过、forfeit、双方耗尽和整局超时只产出 `EncounterOutcome`；由 MRX-005 屏障决定何时结算 stage。
- 所有 relay 人数共用此 encounter 引擎；N=2 配合 `legacy_wins` policy 后，胜负、先手、空过、超时和 BO 结果与现有实现一致。
- 每个增量事件只携带一张棋盘的变化，不广播整个 stage；进行中 payload 不包含 answer。

## 属于本 Issue

- relay encounter domain、handler/action routing、repository queries、sweeper timeout 和事件源契约。
- 答案选择、题库版本/范围绑定、完整反馈水合与服务端 capability 校验。
- `encounter.started/turn.guess/turn.pass/turn.timeout/ended` 事件与 snapshot 当前 encounter 数据。
- 双人 relay adapter 切到新 encounter engine 所需的兼容测试。
- 1..4 张棋盘同时提交、同角色跨棋盘猜测和幂等竞争测试。

## 不属于本 Issue

- 不给多人 outcome 加减积分或生成最终排名。
- 不实现轮空选择、离场恢复或历史分页。
- 不修改 race 猜测端点、race answer 或匿名矩阵。
- 不实现 Web 棋盘；测试可使用 API/WS client fixture。

## 验收标准

- 同一 stage 2..4 个 encounter 的 `answerId` 两两不同；不同 encounter 可独立猜同一角色且不会触发唯一键冲突。
- 一张棋盘猜中后只结束该 encounter，其他棋盘仍接受合法动作，stage 尚未结算。
- 成员对其他 encounter 提交 guess/pass/forfeit 返回 `NOT_ENCOUNTER_PLAYER`；非当前行动者返回 `NOT_YOUR_TURN`。
- 已结束 encounter 的任何动作返回 `ENCOUNTER_ENDED` 且不新增 turn/event。
- 并发正确猜测、guess 与 timeout、pass 与 disconnect sweeper 的提交顺序产生唯一终态和连续事件。
- N=2 的 BO1/3/5/7、交替先手、猜测耗尽、2 次空过、forfeit 和 deadline 与 MRX-001 fixture 一致。
- REST、snapshot、WS、日志和错误响应都不泄露进行中 encounter 的答案。

## 可能涉及的代码

`apps/api/internal/multi/{relay_turns.go,relay_projection.go,match.go,characters.go,sweeper.go}`、`apps/api/internal/handler/{matches.go,round_actions.go,mode_guess.go,snapshot.go}`、`apps/api/sql/queries/multi.sql`、`contracts/openapi/paths/`、`contracts/ws/protocol.yaml`、server integration tests。
