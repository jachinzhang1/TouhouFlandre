# MPX-003：将容量、入座与队伍分配接入房间生命周期

**类型**：功能/API Issue  
**优先级**：P0  
**依赖**：MPX-002  
**建议标签**：`type:feature` `area:api` `area:multi` `area:contracts`

## 要解决的问题

参与者和队伍有了数据结构后，如果创建、加入、准备、离开、重连和再来一局仍用 `len(members)==2` 或“找 slot 1/2”的判断，底层模型仍不可扩展。本 Issue 负责把这些房间命令改成读取房间配置和参与者能力。

## 目标行为

- 加入事务在房间行锁下分配下一个可用 seat；达到 `playerLimit` 后按房间状态/策略进入 spectator，不因“已有两人”硬编码拒绝。
- 只允许符合模式能力矩阵的玩家入座；spectator 永远不占玩家容量，也不能因为断线影响比赛。
- 创建房间时生成所需 team，并按模式策略分配：当前 race 两名玩家各自独立队伍；当前 relay 保持两名玩家的既有规则，但也写入明确 team 归属。
- lobby 的 ready/start 条件、host close、对局中的 leave/disconnect 判负和 finished rematch 都使用活动玩家集合/队伍，而不是固定两个成员。
- `room.updated`、room info、snapshot 返回参与者角色、seat、team 和容量，让前端不再猜测身份。

## 属于本 Issue

- `POST /rooms`、预检、join、ready、leave、close、rematch 的 OpenAPI/WS 契约和 Go handler/service/query 修改。
- seat 分配、team 分配、容量校验、重连 token 绑定、房主权限和错误码。
- 房间状态机及 sweeper 对 spectator/玩家的生命周期测试。
- 对当前两人模式的兼容适配和迁移后的回归测试。

## 不属于本 Issue

- 不实现 N 人 race 的竞猜/计分/投影；MPX-004 负责。
- 不提供房主人数设置入口；MPX-005 负责竞速人数配置 API，MPX-006 负责对应 Web 控件。
- 不实现队友聊天或消息；消息范围由 MPX-007/008 负责。

## 验收标准

- 在同一个事务并发加入时不会重复分配 seat；超过容量的加入者得到明确的 spectator `joinRole`。
- lobby 只有满足当前模式所需玩家条件才开始；spectator 的 ready/forfeit/guess/pass/rematch/close 均返回稳定只读错误。
- 玩家离开/断线的判负语义与现有规则一致，spectator 离开不会改变比分、比赛状态或胜负。
- room info、snapshot、`room.updated` 对所有观察者都给出一致的 team/seat 数量，不泄漏令牌。
- 覆盖并发 join、重连、满员转观战、房主离开、finished 保留期和 room close 的 API/集成测试。

## 可能涉及的代码

`apps/api/internal/handler/rooms.go`、`apps/api/internal/handler/service.go`、`apps/api/internal/multi/member.go`、`apps/api/internal/multi/sweeper.go`、`apps/api/sql/queries/multi.sql`、`contracts/openapi/paths/room-*.yaml`、`contracts/ws/protocol.yaml`、`apps/web/src/hooks/useRoom.ts`（仅契约适配）。
