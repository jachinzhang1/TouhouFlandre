# MPX-005：开放房主设置竞速房间玩家人数上限

**类型**：功能/API Issue

**优先级**：P1

**依赖**：MPX-004（并依赖 MPX-003 的容量/入座状态机）

**建议标签**：`type:feature` `area:api` `area:contracts`

## 要解决的问题

房间底座有 `player_limit` 并不等于用户能设置。房主需要选择竞速房间允许入座的最大玩家数；它是容量上限，不是必须凑满的目标人数。当前玩家达到服务端固定的 `minPlayers=2` 且全员准备后，可以按当时阵容开局。该设置必须经过服务端校验、对非房主只读展示，并且只允许在当前无人 ready 时修改，避免准备期间改变容量。

## 目标行为

- 创建 race 房间时可提交 `playerLimit`；lobby 中房主可通过受权的房间设置命令修改。
- 默认值为 2，允许范围为 `2..serverMaxRacePlayers`（[决策记录](./decisions.md#术语与生命周期)冻结首版为 8）；relay 仍固定现有两名玩家并拒绝 race 专属设置。
- room info/`room.updated` 显示 `playerLimit`、固定的 `minPlayers`、当前玩家数、可用席位和 spectator 数。
- 达到上限后新加入者进入 spectator；已经入座的玩家不因后来观战者加入而被替换。
- 提高上限只产生可认领的空席位，不自动把既有 spectator 变成 player；spectator 使用 MPX-003 的 claim-seat 明确接受玩家权限与开局责任。
- 房主修改上限时不能低于当前玩家数；当前任一玩家处于 ready 或 match 已创建后返回配置锁定错误。所有玩家取消准备后可再次修改。修改配置本身不隐式开局。
- 若 lobby 因成员离开形成 seat 空洞，降低上限时在同一事务按旧 seat、memberId 稳定排序，将非房主玩家压紧到 `2..currentPlayers` 后再应用新上限；seat 1/房主和 memberId 不变，历史聊天的发送时 seat 快照也不改写。不得出现 `seat > playerLimit` 的活动 lobby player。
- 上限修改与 join、ready/start 共用房间行锁：修改先提交时后续 join 按新上限判定，join 先入座时不得把上限降到新的当前玩家数以下；不能出现超额入座或配置已锁定却仍被改写。
- `playerLimit=8` 不要求 8 人到齐：3 名当前玩家全部 connected + ready 时即可冻结三人 roster 并开局。房主可保持未准备以继续等待更多玩家，也可在 lobby 取消准备。

## 属于本 Issue

- `POST /rooms` 请求字段和一个房主授权的 lobby settings 更新接口（若采用 PATCH，固定路径和错误码）。
- Go 校验、事务更新、事件广播和 OpenAPI/WS/TS 生成物。
- API、权限、边界值、并发修改、刷新/重连和契约/集成测试。

## 不属于本 Issue

- 不修改 race 的并发竞猜和计分算法；依赖 MPX-004 的能力。
- 不改变 relay 的人数或接力规则。
- 不实现玩家上限控件、N 人棋盘或聊天 UI；Web 展示属于 MPX-006/009。
- 不实现聊天、观战消息或队内交流。

## 验收标准

- 房主调用设置命令后，race 房间可在 lobby 使用 2、3、4…首版上限；非法值、relay 设置、非房主修改和当前有人 ready 时修改均有稳定错误；所有人取消准备后恢复可修改。
- 设置变化通过 `room.updated` 同步给玩家和观战者，刷新/重连后从服务端恢复。
- 提高上限后 spectator 可显式认领空席位；降低上限或空席位再次被占用时，前端能从权威事件得到稳定结果，不发生自动晋升。
- 在容量边界并发 join 下，最多产生 `playerLimit` 个玩家，其余在 spectator cap 未满时进入观战。
- 并发修改上限、join、ready 时结果符合房间行锁的提交顺序，事件中的 `playerLimit`、当前玩家数和冻结 roster 与数据库终态一致。
- 对 seat 有空洞的 lobby 降容后，活动玩家 seat 连续落在 `1..currentPlayers`，memberId/令牌/房主不变；客户端不会把 seat 变化当成身份变化。
- `playerLimit=8` 的 2、3、5、8 人阵容都能在全员 connected + ready 后开局；少于 `minPlayers`、存在未准备/断线玩家时不开始。
- `room.info`、`room.updated` 和 snapshot 显示当前玩家/上限/最少开局人数和观战人数，不依赖 `members.length === 2`；现有两人流程无回归。

## 可能涉及的代码

`contracts/openapi/paths/rooms.yaml`、`contracts/openapi/paths/room-info.yaml`、`contracts/openapi/schemas/multi-room.yaml`、`contracts/ws/protocol.yaml`、`apps/api/internal/handler/rooms.go`、`apps/api/sql/queries/multi.sql`。
