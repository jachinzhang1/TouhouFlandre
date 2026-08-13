# MPX-004：将竞速模式扩展为 N 人独立计分

**类型**：功能/核心规则 Issue  
**优先级**：P0  
**依赖**：MPX-003  
**建议标签**：`type:feature` `area:api` `area:multi` `area:contracts`

## 要解决的问题

当前 race 的胜者、比分和投影仍是两个 slot：`score_slot1/score_slot2`、`winner_slot`、`BoardsView{slot1,slot2}`，放弃/断线还依赖 `OtherSlot`。增加人数设置之前，服务端必须先能冻结 N 人 roster、可靠处理多人同时竞猜，并明确一名玩家放弃或离开时其余玩家如何继续。

## 目标

只扩展 `race`，支持一个房间内 2..N 名玩家按 member 独立计分。N 是开局事务冻结的实际 match roster 人数，满足 `2 <= N <= playerLimit`；`playerLimit` 另受服务端硬上限保护（推荐首版上限 8，最终值由 MPX-001 决策记录冻结）。

建议将 roster/计分/结果主体改为稳定 memberId 的集合，而不是继续增加 `slot3`、`slot4` 字段：

- `multi_match_player(match_id, member_id, seat, wins, status)` 冻结本场名单并承载比分/离场状态；
- `multi_round_player(round_id, member_id, status)` 记录本局 active/forfeited，避免用“有没有猜测”推断放弃；
- 局/场胜者使用 `winnerMemberId`，平局为 null；比分和棋盘使用带 `memberId/seat` 的集合；
- 数据库事务在正确答案竞争下锁定局/场，确保并发请求恰有一个胜者。

N 人退出语义固定如下：该小局主动放弃只将该玩家标记为本局 forfeited，下一局仍可参与；当仅剩一名未放弃玩家时，该玩家赢得本局。达到猜测上限不等于放弃，只有所有未放弃玩家都耗尽次数才平局。并发主动放弃在局锁下按事务提交顺序串行化，先提交的状态决定后续命令看到的局终态。对局中主动离开或断线宽限超时会将玩家从 match roster 标记为 left，并等价于该局放弃；剩余玩家继续，若本场只剩一名 active 玩家则该玩家直接赢得整场。sweeper 必须在同一事务按同一个 `now` 批量处理同时过期的成员：剩一名有效 active 玩家才判其胜，全部过期则整场无胜者结束，不能让遍历顺序决定赢家。因离场导致 roster 不完整时不允许 rematch，房间在 finished 保留期后关闭。两人房间因此保持现有“离开者判负、另一人获胜”结果。

## 属于本 Issue

- race 的数据库迁移、match/round roster、计分查询、round/match completion 和 sweeper 恢复路径。
- `multi_match_player`、winnerMemberId 和集合比分作为两种模式共用的持久化/投影视图；relay 也迁移到该共享表示，但玩家数、轮流和胜负规则仍保持两人不变，避免长期维护两套比分 schema。
- Go 规则层、投影层和 v2 事件 payload；玩家只能看到自己的完整棋盘及其他玩家按 memberId 分组的匿名矩阵，spectator 可看到全部完整棋盘。
- 多玩家最大猜测次数、超时、放弃、断线判负和场结束条件。
- 移除内部 `score_slot1/2`、`winner_slot` 和 `OtherSlot` 依赖，让 MPX-002A/MPX-002B 已冻结的 memberId/seat/v2 集合承载 N 人；spectator 的 `viewerResult` 缺省，不伪装成 loss。
- 多对手匿名列置换以 `(roundId, observerMemberId, subjectMemberId)` 为种子，避免不同对手棋盘共享同一映射。
- race 核心单元测试、并发集成测试、投影隐私测试和 snapshot/replay 测试。

## 不属于本 Issue

- 不把 relay 改成 N 人或重新定义队伍轮流规则。
- 不实现 `playerLimit` 配置 API；MPX-005 负责房主配置命令和契约。
- 不实现 N 人布局、聊天或表情；分别由 MPX-006、MPX-008/009 负责。

## 验收标准

- 2 人配置的 race 业务结果不变；既有 `score_slot1/2` 数据迁入 roster score 后可读。生产回滚保留 expand schema，不依赖 Down 删除新数据。
- 通过内部/集成测试 fixture 设置的 3、4、8 人 race 可以开局；公开创建/修改入口留给 MPX-005。并发正确竞猜只产生一个 `round.ended` 胜者和一次计分。
- 任意玩家的事件投影不会包含对手角色名、标签/字段值、可逆列映射或未授权消息；已发生猜测的数量、行序和事件到达时间按公开元数据处理。spectator 仍能获得完整棋盘。
- 主动小局放弃、并发放弃、主动离场、断线超时、部分/全部玩家达到最大猜测次数及局时限都符合上述 N 人终态表，服务重启恢复后结果一致。
- API、WS、snapshot、Go 和 TS 生成类型全部通过契约检查；迁移 Down 在一次性测试数据库可执行，生产回滚不删除 expand schema。

## 可能涉及的代码

`apps/api/migrations/`、`apps/api/sql/queries/multi.sql`、`apps/api/internal/multi/{match.go,round_completion.go,projection.go,sweeper.go,forfeit.go,restart.go}`、`apps/api/internal/handler/{matches.go,round_actions.go,snapshot.go,ws.go}`、`contracts/openapi/schemas/multi-*.yaml`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts`。
