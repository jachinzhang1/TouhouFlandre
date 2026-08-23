# MRX-003：建立 relay-owned stage/encounter 数据与 WS v3 契约

**类型**：架构/数据/契约 Issue  
**优先级**：P0  
**依赖**：MRX-002  
**建议标签**：`type:feature` `area:db` `area:api` `area:contracts` `area:websocket`

**决策依据**：[持久化模型](./decisions.md#13-持久化模型)、[契约与 WS v3](./decisions.md#15-契约与-ws-v3)、[事务与锁序](./decisions.md#14-事务与锁序)、[多人模式模块边界](./architecture.md)

## 要解决的问题

当前一条 `multi_round` 同时承担单局、答案和双人接力当前手，无法表达一个同步结算边界内的 2..4 张独立棋盘。直接把它改成通用 stage 又会迫使 race 接受可空答案、接力 turn 和新锁序。需要建立 relay-owned 数据模型，并在共享信封之上增加不绑定具体 relay 计分规则的 v3 payload。

## 要做到什么程度

- 从迁移 `0015` 开始新增 `multi_relay_stage`、`multi_relay_encounter`、`multi_relay_encounter_member`、`multi_relay_turn`、relay match player state 与 stage settlement 表；不新增无第二消费者的 `multi_stage_unit`。
- 保留现有 `multi_round`、`multi_turn` 及其约束供 race 与 legacy relay adapter 使用；新 relay 答案和 turn 只存在 relay-owned 表。
- `multi_match` expand `rule_set_key/rule_set_version` 和冻结配置快照；按 `(room.mode,key,version)` 解析。现有 `scoring_mode` 保留供 race v2/旧数据/stats v5 兼容，不单独调度新玩法。
- 旧数据按确定映射回填：race `wins|points|placement` 保持同 key/version 1，旧 relay 回填 `legacy_wins` version 1；未知或矛盾数据阻止迁移。
- relay 专属 player state 保存有符号 score、`healthy/near_death`、淘汰 stage；不放宽 race score 约束，不扩张 race round/player status 枚举。
- v3 relay fragment 定义允许负分的 `RelayStandingView`；现有 race `MemberScoreView.score >= 0` 和 stats v5 形状保持不变。
- 定义带 `stageId/stageIndex/encounterId/memberId` 的 OpenAPI 与 WS v3 typed union；数组按 encounter index、side/seat 稳定排序。
- v3 从当前含 race `raceEliminationEnabled`、`points/placement` 的 v2 扩展，并沿用游戏 sequence、cursor、snapshot 缺口修复、`sync.complete` 和 chat cursor，不重新设计已验证的同步屏障。
- v3 使用 `ruleSetRef` 和 namespaced `relay.stage.*`/`relay.encounter.*`；race payload 和匿名矩阵保持现状。
- 增加 relay encounter action 和 history 的契约骨架；handler 可先返回 feature-disabled，不提前实现玩法。
- 数据库迁移可在包含旧 race/relay 数据的副本上执行，旧列保留供应用回滚。

## 属于本 Issue

- `0015+` goose migration、sqlc query 源及生成物。
- OpenAPI schemas/paths、WS protocol 源、Go/TS 手写协议类型和一致性检查。
- v2 -> v3 握手拒绝/刷新提示所需的服务端控制帧契约。
- 数据约束、索引、迁移回归、序列化 round-trip 与 contract tests。
- relay repository/domain 映射与 legacy storage adapter，不含真实配对和计分。

## 不属于本 Issue

- 不生成随机配对、答案或 turn。
- 不开放 relay 多人房间创建。
- 不实现积分、濒死、轮空选择、Web 棋盘或历史加载体验。
- 不删除或放宽 `multi_round.answer_id/turn_slot`、`multi_turn.round_id`、旧 winner/score/scoring_mode 列。
- 不让 race repository 查询 relay stage/encounter，也不让共享 core 解释 relay 表。
- 不长期维护 v2/v3 双协议；排空和切换由 MRX-013 执行。

## 验收标准

- migration `0015+` Up 后旧 race 与双人 relay 数据仍可由旧 adapter 读取；一次性测试库可验证迁移过程，生产回滚不依赖删除新表。
- backfill 行数与 mode/scoring_mode 分组完全对应，重复执行验证不改变既有 RuleSetRef；构造的未知旧值会让迁移明确失败。
- 数据库约束保证一个 encounter 属于一个 relay stage、恰有两名不同 roster player、同一 stage 玩家最多加入一个 encounter；near-death 与 active/eliminated/left 是正交维度。
- 同一 stage 的不同 encounter 可以提交同一 `guess_id`，同一 encounter 内仍禁止重复角色和幂等冲突。
- v3 schema 能表达 `RuleSetRef`、1..4 个 encounter、bye、stage settlement 和紧凑历史摘要；进行中结构没有 answer 字段。
- relay 淘汰后的负分可以 round-trip，race schema 仍拒绝负分；两种 standings 不通过宽松 union 混为一体。
- v3 客户端仍能严格检查 game sequence，投影跳过使用 cursor，不因 encounter 并发产生假缺口。
- race-only registry 不查询 relay 新表，race v2 fixture 归一化到 v3 后语义不变；未知 relay rule set version 明确拒绝。
- OpenAPI lint/ref、代码生成、WS protocol 检查、migration/sqlc 测试通过且工作树无生成物漂移。

## 可能涉及的代码

`apps/api/migrations/0015_*.sql` 及后续、`apps/api/sql/queries/multi.sql`、`apps/api/internal/generated/`、relay storage/domain adapter、`contracts/openapi/{paths,schemas}/`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts`、`apps/web/src/generated/api.ts`。
