# MPX-004：将竞速模式扩展为 N 人独立队伍竞速

**类型**：功能/核心规则 Issue  
**优先级**：P0  
**依赖**：MPX-003  
**建议标签**：`type:feature` `area:api` `area:multi` `area:contracts`

## 要解决的问题

当前 race 的胜者、比分和投影仍是两个 slot：`score_slot1/score_slot2`、`winner_slot`、`BoardsView{slot1,slot2}`。增加人数设置之前，服务端必须先能可靠处理 N 个玩家同时竞猜，并确保只有一个胜者、其他玩家看不到不应看到的答案信息。

## 目标

只扩展 `race`，支持一个房间内 2..N 名玩家各自属于独立队伍。N 由房间冻结配置决定，服务端另有硬上限保护（推荐首版上限 8，最终值由 MPX-001 决策记录冻结）。

建议将计分/结果主体改为稳定 team/member id 的集合，而不是继续增加 `slot3`、`slot4` 字段：

- 比分使用 `teamScores[]` 或 `match_score(match_id, team_id, wins)`；
- 局/场胜者使用 `winnerMemberId` 与可选 `winnerTeamId`，平局为 null；
- 棋盘使用带 `memberId/seat` 的数组或 map；
- 数据库事务在正确答案竞争下锁定局/场，确保并发请求恰有一个胜者。

## 属于本 Issue

- race 的数据库迁移、计分查询、round/match completion 和 sweeper 恢复路径。
- Go 规则层、投影层和事件 payload；玩家只能看到自己的完整棋盘及其他玩家匿名矩阵，spectator 可看到完整棋盘。
- 多玩家最大猜测次数、超时、放弃、断线判负和场结束条件。
- 契约版本/兼容策略：优先新增集合字段；若无法兼容旧双人客户端，明确新 WS 子协议并保留迁移窗口。
- race 核心单元测试、并发集成测试、投影隐私测试和 snapshot/replay 测试。

## 不属于本 Issue

- 不把 relay 改成 N 人或重新定义队伍轮流规则。
- 不实现 `playerLimit` 配置 API；MPX-005 负责房主配置命令和契约。
- 不实现 N 人布局、聊天或表情；分别由 MPX-006、MPX-008/009 负责。

## 验收标准

- 2 人配置的 race 回归结果、事件顺序和旧数据读取不变。
- 3、4、8 人 race 可以创建/开局；并发正确竞猜只产生一个 `round.ended` 胜者和一次计分。
- 任意玩家的事件投影不会包含对手角色名、标签值、真实猜测顺序或未授权消息；spectator 仍能获得完整棋盘。
- 任一玩家离开、断线超时、达到最大猜测次数或局时限时，结果和比分对所有观察者一致。
- API、WS、snapshot、Go 和 TS 生成类型全部通过契约检查，数据库迁移可回滚。

## 可能涉及的代码

`apps/api/migrations/`、`apps/api/sql/queries/multi.sql`、`apps/api/internal/multi/{match.go,round_completion.go,projection.go,sweeper.go,forfeit.go}`、`apps/api/internal/handler/{matches.go,round_actions.go,snapshot.go,ws.go}`、`contracts/openapi/schemas/multi-*.yaml`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts`。
