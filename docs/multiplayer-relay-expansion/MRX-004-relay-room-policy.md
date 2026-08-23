# MRX-004：开放接力容量、淘汰设置与偶数阵容开局

**类型**：功能/API Issue  
**优先级**：P0  
**依赖**：MRX-003  
**建议标签**：`type:feature` `area:api` `area:multi` `area:contracts`

**决策依据**：[房间配置与开局](./decisions.md#3-房间配置与开局)、[配置模型与兼容边界](./architecture.md#配置模型与兼容边界)、[规则集标识](./architecture.md#规则集标识)

## 要解决的问题

接力当前固定 `playerLimit=2`，创建和 settings handler 会拒绝 relay 上限。共享 `ReadyRoster` 也无法表达 relay 的偶数开局条件。需要把容量与开局判定下沉到 `RoomPolicy`，并原子保存房主的淘汰偏好。

## 要做到什么程度

- relay 创建请求接受 `playerLimit=2/4/6/8` 和 `relayEliminationEnabled`；缺省分别为 2 和 false，不能读取或覆盖 `raceEliminationEnabled`。
- room settings 支持原子更新 relay 上限/淘汰设置，继续要求房主、lobby、无人 ready、无 match。
- relay policy 只在当前 player 数为 2/4/6/8、全员 connected + ready 且包含房主时允许开局。
- 奇数 roster 的 ready 命令保持幂等成功但不开始，`room.updated`/snapshot 投影稳定的阻塞原因。
- 开局事务按实际人数冻结 `(relay, legacy_wins, 1)`、`(relay, fixed_points, 1)` 或 `(relay, elimination, 1)` 及规则配置快照，房间开关之后不能改写当前 match。
- transport adapter 将公开字段归一化为 `RelayRoomConfig`；relay policy/storage 独占设置语义，共享 room core 只负责原子保存和返回 typed mode config。
- 继续复用 spectatorCap、claim-seat、seat 压紧和 room 行锁串行化。
- 用独立后端 rollout flag 阻止新建/调高 N 人 relay 或把新房间设置为淘汰制；已经保存该配置的 lobby、playing match 和 rematch 由当前 binary 继续完成，不能在 ready 时被开关变化卡死。

## 属于本 Issue

- relay room policy、创建/settings/ready/start handler、`multi_relay_room_config`/relay storage adapter 和权威 room projection。
- OpenAPI/WS room settings 字段、错误码、生成物和 API/并发测试。
- playerLimit 与 join/claim-seat/settings/final-ready 的竞争测试。
- 实际人数为 2 时忽略淘汰偏好并冻结 relay legacy rule set 的测试。

## 不属于本 Issue

- 不创建配对或棋盘；开局可在功能 flag 后返回未实现保护，真正 stage 创建由 MRX-005/006 接管。
- 不实现滑杆和淘汰按钮；Web 属于 MRX-010。
- 不改变 race 允许连续 2..8 上限的规则。
- 不重命名、复用或改变现有 `raceEliminationEnabled`，不让 race handler 读取 relay 配置。
- 不允许只冻结 ready 子集；未准备/断线的当前 player 继续阻止开局。

## 验收标准

- relay 上限只接受 2/4/6/8；0、1、3、5、7、9 和大于 8 均返回稳定 `INVALID_PLAYER_LIMIT`。
- 上限 6 的房间可由实际 2/4/6 人全员准备开局；3/5 人全员准备不启动并公开阻塞原因。
- 任一未准备或 disconnected player 阻止开始；不存在从 4 人中挑 2 名 ready 玩家静默开局的路径。
- settings 与 join/claim-seat/ready 并发时结果符合 room 锁提交顺序，不超额入座、不冻结奇数 roster、不在已锁配置后修改。
- relay 2 人在开关 true/false 下均产生 `(relay, legacy_wins, 1)`，现有 BO 目标和 turn 行为无回归。
- race 创建/settings、观战认领与聊天权限完整回归。
- 同一 transport 请求不能同时提交两个模式的淘汰字段；切换 mode 不携带另一模式草稿，数据库中两个设置互不覆盖。

## 可能涉及的代码

`apps/api/internal/multi/{member.go,modes.go,types.go}`、`apps/api/internal/handler/rooms.go`、`apps/api/migrations/`、`apps/api/sql/queries/multi.sql`、`contracts/openapi/{paths/rooms.yaml,paths/room-settings.yaml,schemas/multi-room.yaml}`、`contracts/ws/protocol.yaml`、server integration tests。
