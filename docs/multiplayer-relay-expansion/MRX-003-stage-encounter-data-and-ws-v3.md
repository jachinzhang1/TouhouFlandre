# MRX-003：建立 stage/encounter 数据模型与 WS v3 契约

**类型**：架构/数据/契约 Issue  
**优先级**：P0  
**依赖**：MRX-002  
**建议标签**：`type:feature` `area:db` `area:api` `area:contracts` `area:websocket`

**决策依据**：[持久化模型](./decisions.md#13-持久化模型)、[契约与 WS v3](./decisions.md#15-契约与-ws-v3)、[事务与锁序](./decisions.md#14-事务与锁序)

## 要解决的问题

当前一条 `multi_round` 同时承担全场局、答案和接力当前手，无法表达一个同步结算边界内的 2..4 张独立棋盘。v2 的单一 `RoundView.shared` 和 `round.shared.*` 事件也无法让客户端可靠区分并发棋盘。需要先建立不绑定具体计分规则的数据与 wire 基础。

## 要做到什么程度

- 保留 `multi_round` 作为 stage 容器，新增 `multi_stage_unit`、`multi_stage_unit_member` 和 relay 专属 `multi_relay_encounter`。
- `multi_turn` expand 为 encounter 范围，调整唯一键使同一 stage 的不同棋盘可以猜同一角色。
- 公共 `multi_match_player` 继续承载 standings/参与状态并允许负分；新增 relay 专属 match life state 与 stage settlement 表保存 `healthy/near_death`、paired/bye、outcome 和 score delta，不扩张 race 的 round status 枚举。
- 将 `multi_round.answer_id` 调整为 stage 容器可空；race/旧数据仍由 adapter 保证答案非空，relay 答案只存在 encounter。
- 定义带 `stageId/stageIndex/encounterId/memberId` 的 OpenAPI 与 WS v3 typed union；数组按 unit index、side/seat 稳定排序。
- v3 沿用游戏 sequence、cursor、snapshot 缺口修复、`sync.complete` 和 chat cursor，不重新设计已验证的同步屏障。
- 增加 relay encounter action 和 history 的契约骨架；handler 可先返回 feature-disabled，不提前实现玩法。
- 数据库迁移可在包含旧 race/relay 数据的副本上执行，旧列保留供应用回滚。

## 属于本 Issue

- goose migration、sqlc query 源及生成物。
- OpenAPI schemas/paths、WS protocol 源、Go/TS 手写协议类型和一致性检查。
- v2 -> v3 握手拒绝/刷新提示所需的服务端控制帧契约。
- 数据约束、索引、迁移回归、序列化 round-trip 与 contract tests。
- 新结构的 repository/domain 映射，不含真实配对和计分。

## 不属于本 Issue

- 不生成随机配对、答案或 turn。
- 不开放 relay 多人房间创建。
- 不实现积分、濒死、轮空选择、Web 棋盘或历史加载体验。
- 不删除 `multi_round.answer_id/turn_slot`、`multi_turn.round_id`、旧 winner/score 列。
- 不长期维护 v2/v3 双协议；排空和切换由 MRX-013 执行。

## 验收标准

- migration Up 后旧 race 与双人 relay 数据仍可由旧列读取；一次性测试库可验证迁移过程，生产回滚不依赖删除新表。
- 数据库约束保证一个 unit 属于一个 stage、一个 encounter 恰有两名不同 roster player、同一 stage 玩家最多加入一个 encounter；near-death 与 active/eliminated/left 是正交维度。
- 同一 stage 的不同 encounter 可以提交同一 `guess_id`，同一 encounter 内仍禁止重复角色和幂等冲突。
- v3 schema 能表达 1..4 个 encounter、bye、stage settlement 和紧凑历史摘要；进行中结构没有 answer 字段。
- v3 客户端仍能严格检查 game sequence，投影跳过使用 cursor，不因 encounter 并发产生假缺口。
- OpenAPI lint/ref、代码生成、WS protocol 检查、migration/sqlc 测试通过且工作树无生成物漂移。

## 可能涉及的代码

`apps/api/migrations/`、`apps/api/sql/queries/multi.sql`、`apps/api/internal/generated/`、`apps/api/internal/multi/{types.go,public_collections.go}`、`contracts/openapi/{paths,schemas}/`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts`、`apps/web/src/generated/api.ts`。
