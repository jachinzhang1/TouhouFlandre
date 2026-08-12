# MPX-003：将容量、入座与灵活开局接入房间生命周期

**类型**：功能/API Issue

**优先级**：P0

**依赖**：MPX-002

**建议标签**：`type:feature` `area:api` `area:multi` `area:contracts`

## 要解决的问题

member/seat 和 `player_limit` 有了数据结构后，如果创建、加入、准备、离开、重连和再来一局仍用 `len(members)==2`、`OtherSlot` 或“找 slot 1/2”的判断，底层模型仍不可扩展。本 Issue 负责把房间级命令改成读取容量、最少开局人数和参与者能力；竞速局内规则仍由 MPX-004 接管。

## 目标行为

- 加入事务在房间行锁下分配最小可用正整数 seat；达到 `playerLimit` 后进入 spectator，不因“已有两人”硬编码拒绝。
- 容量统计包含 connected 和仍在断线宽限期内的 disconnected 玩家；宽限期内保留原 seat，新 join 不能抢占。只有 lobby 成员明确离开或宽限到期并完成删除后才释放 seat，playing/finished 始终以冻结 roster 为准。
- lobby 出现空席位时，connected spectator 可显式 claim-seat：服务端在房间锁下复用原 memberId/token，将其转换为 `ready=false` 的 player 并分配最小可用 seat。容量增加或玩家离开都不自动提升 spectator 权限；playing/finished、满员或 disconnected spectator 的认领返回稳定错误。提交后 hub 立即使该 member 的旧 WS 身份失效并以 `member_changed` 要求重连，不能继续用连接建立时缓存的 spectator role 做投影。
- 只允许符合模式能力矩阵的玩家入座；spectator 永远不占玩家容量，也不能因为断线影响比赛。
- spectator 不占 `playerLimit`，但受服务端 `maxSpectatorsPerRoom` 硬上限约束；达到上限后 join 返回稳定的房间容量错误，不能无限创建成员行和 WS fan-out。
- race 的服务端固定 `minPlayers=2`。当前玩家数处于 `2..playerLimit`、所有当前玩家均 connected + ready 且房主保持 ready 时，以当前玩家集合冻结 match roster 并开局；不要求填满上限。例如 `playerLimit=8` 的房间允许 3、5 或 8 人开局。
- ready 命令改为显式设置 `ready: boolean`，允许开局前取消准备。房主通过保持未准备来继续等待玩家，房主 ready 表示确认可以按当前阵容开始；设置上限本身不触发开局。
- join/claim-seat 的入座、ready 状态更新、开局条件检查和 match roster 创建必须在同一房间行锁下串行化：若最终 ready 先提交，房间按当时 roster 开局，随后加入者只能观战且 claim-seat 被拒绝；若 join/claim-seat 先提交并取得玩家席位，新玩家进入未准备状态并阻止此次开局。
- relay 在本轮始终要求 `playerLimit=2`，其两人开局行为不变。
- lobby 的 ready/start 条件和 host close 使用活动玩家集合，而不是固定两个成员；seat 1 继续作为本轮房主判断，memberId 作为身份键。finished rematch 只允许本场冻结 roster 完整、无人 left 且 roster 全员 connected + rematch ready 时按原 roster 开新场，新成员或 spectator 不能补位。
- `room.updated`、room info、snapshot 返回 `playerLimit`、`minPlayers`、当前玩家数、可用席位、spectator 数和带 memberId 的成员集合，让前端不再猜测身份。

## 属于本 Issue

- `POST /rooms`、预检、join、claim-seat、ready/unready、leave、close、rematch 的 OpenAPI/WS 契约和 Go handler/service/query 修改；创建接口暂时仍固定 `playerLimit=2`，MPX-005 才开放输入。
- seat 分配、玩家上限与 spectator 硬上限校验、重连 token 绑定、角色变化后的 WS 失效/重鉴权、房主权限和错误码；公开预检能表达当前 join/claim-seat 是否可用。
- 房间状态机及 sweeper 对 spectator/玩家的生命周期测试。
- 对当前两人模式的兼容适配和迁移后的回归测试。

## 不属于本 Issue

- 不实现 N 人 race 的竞猜/计分/投影；MPX-004 负责。
- 不提供房主人数设置入口；MPX-005 负责竞速玩家上限配置 API，MPX-006 负责对应 Web 控件。
- 不实现聊天消息；消息范围由 MPX-007/008 负责。

## 验收标准

- 在同一个事务并发加入时不会重复分配 seat；达到 `playerLimit` 后的加入者在 spectator cap 未满时得到明确的 spectator `joinRole`，cap 已满时得到稳定容量错误。
- disconnected 玩家在宽限期内仍占容量并可用原 token 回到原 memberId/seat；其他加入者不能借断线窗口超过 `playerLimit` 或替换其身份。
- race lobby 在 2..playerLimit 名当前玩家全部 connected + ready 时开始，并把这些 member 冻结为 match roster；未填满上限不会阻止开局，少于 2 人或任一当前玩家未准备不会开局。
- 并发 join/claim-seat 与最终 ready 只有上述两种串行化结果，不会出现已开局后玩家被补入 roster、入座成功却未进入 roster，或绕过未准备成员开局。多个 spectator 并发认领最后席位时至多一人成功。
- claim-seat 提交后旧 WS 不再收到按 spectator 权限投影的新帧；客户端以同一 token 重连后取得 player 视图并从原水位补齐，hub 不以过期的连接内 role 继续授权。
- ready/unready 幂等；取消准备只允许在 lobby 且 match 尚未创建时发生。spectator 的 ready/forfeit/guess/pass/rematch/close 均返回稳定只读错误。
- 完整 roster 的 rematch 需原 roster 全员确认且 connected；任一 roster 成员 left 时明确拒绝，新加入者不能替代其身份或比分。
- 两人基线下玩家离开/断线的判负语义与现有规则一致（N 人语义由 MPX-004 冻结），spectator 离开不会改变比分、比赛状态或胜负。
- room info、snapshot、`room.updated` 对所有观察者都给出一致的 memberId/seat/playerLimit/minPlayers，不泄漏令牌。
- 覆盖并发 player/spectator join、claim-seat、重连、满员转观战、spectator cap、房主离开、finished 保留期和 room close 的 API/集成测试。

## 可能涉及的代码

`apps/api/internal/handler/rooms.go`、`apps/api/internal/handler/service.go`、`apps/api/internal/multi/member.go`、`apps/api/internal/multi/sweeper.go`、`apps/api/sql/queries/multi.sql`、`contracts/openapi/paths/room-*.yaml`、`contracts/openapi/schemas/multi-room.yaml`、`contracts/ws/protocol.yaml`、`apps/web/src/hooks/useRoom.ts`（仅契约适配）。
