# MPX-002：建立可扩展的参与者、玩家席位与队伍数据底座

**类型**：功能/数据模型 Issue  
**优先级**：P0  
**依赖**：MPX-001  
**建议标签**：`type:feature` `area:db` `area:contracts` `area:shared`

## 要解决的问题

`apps/api/migrations/0007_spectators.sql` 已将观战者从玩家席位中分离，但玩家仍被约束为 slot `1/2`。比分、胜者和棋盘的双人字段暂时可以保留；参与者底座不能继续把“slot 只能是 1/2”当作长期模型，否则后续人数设置和组队都会反复迁移。

## 目标

在不改变现有两人 race/relay 玩法的前提下，建立可以承载 N 个玩家、多个队伍和非玩家角色的数据模型与共享类型。

推荐模型：

- `multi_team`：`id`、`room_id`、稳定的 `team_key/order`、显示名和创建时间；同一房间内唯一。
- `multi_member`：保留 `role`，将 `slot` 改为房间内唯一的正整数；玩家必须有 seat 和 `team_id`，观战者 seat/team 均为空。
- `multi_room`：保存冻结的 `player_limit`（默认 2）和队伍分配策略/配置；配置结构应能扩展，但不能允许客户端任意注入未审核的 JSON。
- 共享/契约类型使用 `players[]`、`teams[]` 或按稳定 id 的 map 表达集合；必要时为旧双人字段提供兼容投影。

## 属于本 Issue

- goose migration、SQLC 查询和回滚脚本；迁移旧数据时为两名玩家创建两个稳定队伍并填充关联。
- Go `multi` 领域类型、角色/席位/队伍 helper，以及 OpenAPI/WS 中的参与者和队伍视图。
- 默认配置和数据库约束：玩家人数至少 2、上限由服务端常量/配置限制；观战者不占玩家容量。
- 约束和索引测试，包括重复 seat、跨房间 team、spectator 占 seat、旧数据迁移和重复令牌。
- 更新 `docs/multiplayer.md` 中只描述“当前仍为两人玩法”的说明，链接本计划。

## 不属于本 Issue

- 不改竞速胜负算法、比分存储、棋盘投影或接力轮次推进；这些属于 MPX-004 或未来 relay Issue。
- 不开放房主 UI 设置，不改变加入/准备/重连流程；行为接入属于 MPX-003/005。
- 不实现聊天表或消息事件；聊天依赖本 Issue 的 participant/team 身份，但属于 MPX-007/008。

## 验收标准

- 现有迁移数据升级后，两个玩家的 seat、team 和显示内容保持不变；已有观战者仍可读。
- 数据库不再以 `slot BETWEEN 1 AND 2` 作为通用玩家席位约束，但仍保证同房间 seat 唯一、玩家/观战者 role 与 seat/team 组合合法。
- 所有新增集合字段对空数组有稳定 JSON 形态；生成的 Go/TS 类型和契约检查通过。
- `go test ./...`、`pnpm typecheck`、`task gen`、`task check:generated` 通过，迁移 Down 可在测试数据库执行。
- 旧双人客户端在 `playerLimit=2` 房间中仍能进入并完成现有流程；若不能兼容，必须在契约中提升版本并写出迁移窗口。

## 可能涉及的代码

`apps/api/migrations/`、`apps/api/sql/queries/multi.sql`、`apps/api/internal/multi/types.go`、`apps/api/internal/handler/convert.go`、`contracts/openapi/schemas/multi-*.yaml`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts` 及其测试/生成物。
