# MPX-005：开放房主设置竞速房间玩家人数上限

**类型**：功能/API Issue  
**优先级**：P1  
**依赖**：MPX-004（并依赖 MPX-003 的容量/队伍分配）  
**建议标签**：`type:feature` `area:api` `area:contracts`

## 要解决的问题

房间底座有容量字段并不等于用户能设置。房主需要在开局前选择竞速玩家上限；该设置必须经过服务端校验、对非房主只读展示，并在对局开始后冻结，避免中途改变参与者集合和比赛规则。

## 目标行为

- 创建 race 房间时可提交 `playerLimit`；lobby 中房主可通过受权的房间设置命令修改。
- 默认值为 2，允许范围为 `2..serverMaxRacePlayers`（首版推荐 8）；relay 仍固定现有两名玩家并拒绝 race 专属设置。
- room info/`room.updated` 显示 `playerLimit`、当前玩家数、可用席位和 spectator 数。
- 达到上限后新加入者进入 spectator；已经入座的玩家不因后来观战者加入而被替换。
- 房主修改上限时不能低于当前玩家数；ready 或 match 创建后返回配置锁定错误。

## 属于本 Issue

- `POST /rooms` 请求字段和一个房主授权的 lobby settings 更新接口（若采用 PATCH，固定路径和错误码）。
- Go 校验、事务更新、事件广播和 OpenAPI/WS/TS 生成物。
- API、权限、边界值、并发修改、刷新/重连和契约/集成测试。

## 不属于本 Issue

- 不修改 race 的并发竞猜和计分算法；依赖 MPX-004 的能力。
- 不改变 relay 的人数或接力规则。
- 不实现人数设置控件、N 人棋盘或聊天 UI；Web 展示属于 MPX-006/009。
- 不实现聊天、观战消息或队内交流。

## 验收标准

- 房主调用设置命令后，race 房间可在 lobby 使用 2、3、4…首版上限；非法值、relay 设置和开局后修改均有稳定错误。
- 设置变化通过 `room.updated` 同步给玩家和观战者，刷新/重连后从服务端恢复。
- 在容量边界并发 join 下，最多产生 `playerLimit` 个玩家，其余均为 spectator。
- `room.info`、`room.updated` 和 snapshot 显示当前玩家/上限和观战人数，不依赖 `members.length === 2`；现有两人流程无回归。

## 可能涉及的代码

`contracts/openapi/paths/rooms.yaml`、`contracts/openapi/paths/room-info.yaml`、`contracts/openapi/schemas/multi-room.yaml`、`contracts/ws/protocol.yaml`、`apps/api/internal/handler/rooms.go`、`apps/api/sql/queries/multi.sql`。
