# MPX-002A：建立 member、seat 与 player_limit 数据底座

**类型**：功能 / 数据模型 Issue

**优先级**：P0

**依赖**：MPX-001

**建议标签**：`type:feature` `area:db` `area:contracts` `area:shared`

**决策依据**：[术语与生命周期](./decisions.md#术语与生命周期)、[模式能力边界](./decisions.md#模式能力边界)

## 要解决的问题

`apps/api/migrations/0007_spectators.sql` 已将观战者从玩家席位中分离，但玩家仍被约束为 slot `1/2`，公开成员视图也没有稳定 `memberId`。如果不先稳定“谁是谁、坐哪儿、最多几人”，后续 N 人竞速、聊天授权和本地统计都会继续依赖数组顺序或 slot 猜测。

## 目标

在不改变现有两人 race/relay 规则的前提下，建立可以承载 N 个玩家的 member/seat 数据模型和公开集合形态。

推荐模型：

- `multi_member`：保留 `role`，将 `slot` 概念收敛为房间内唯一的正整数 `seat`；player 必须有 seat，spectator seat 为空。
- `multi_room`：增加 `player_limit`，默认 2；它表示允许入座的最大玩家数，不表示开局必须凑满。MPX-005 开放设置前，创建接口仍固定写 2。
- 公开成员、棋盘、比分和结果集合统一为包含公开 `memberId` 的数组，并按 seat 稳定排序；客户端按 memberId 建索引，wire 不使用动态 JSON key。
- seat 负责排序并保留“seat 1 为房主”的本轮规则，但不作为身份键。
- 本任务可先把现有 `score_slot1/2`、`winner_slot`、双棋盘数据库行适配成两元素集合；MPX-004 再迁移底层比赛存储并扩到 N 人。
- 不创建 `multi_team` 或 `team_id`。独立竞速直接以 match roster/member 为计分主体，团队玩法另行设计。

## 属于本 Issue

- goose migration、SQLC 查询和可丢弃测试库的 Down 演练；既有房间回填 `player_limit=2`。
- Go `multi` 的 member/seat helper、公开 `memberId`、默认配置和数据库约束。
- OpenAPI/共享类型中的参与者集合、公开 memberId、seat、playerLimit 字段。
- 约束和索引测试，包括重复 seat、spectator 占 seat、非法 player_limit、旧数据迁移和重复令牌。
- 当前两人 race/relay 的公开视图适配为 memberId + seat 集合，但业务规则保持两人不变。

## 不属于本 Issue

- 不实现 WebSocket v2 握手、cursor envelope、`sync.complete` 或 snapshot 缺口补齐；这些属于 MPX-002B。
- 不改变竞速胜负算法、比分底层存储、N 人循环或接力轮次推进；这些属于 MPX-004 或未来 relay Issue。
- 不开放房主 UI 设置，不改变加入/准备/重连流程；行为接入属于 MPX-003/005。
- 不实现聊天表或消息事件；聊天依赖本任务的 memberId/role/seat，但属于 MPX-007/008。

## 验收标准

- 现有迁移数据升级后，两个玩家的 seat 和显示内容保持不变，房间玩家上限为 2；已有观战者仍可读。
- 数据库不再以 `slot BETWEEN 1 AND 2` 作为通用玩家席位约束，但仍保证同房间 seat 唯一、player/spectator role 与 seat 组合合法。
- `player_limit` 有稳定默认值、服务端硬上限和数据库约束；spectator 不占玩家容量。
- 所有新增集合字段对空数组有稳定 JSON 形态；生成的 Go/TS 类型和契约检查通过。
- 两人 race/relay 在新的 memberId + seat 集合视图下完成现有流程；业务结果不变。
- `go test ./...`、`pnpm typecheck`、`task gen` 和契约检查通过；Go/Web 生成目录无未预期漂移。

## 可能涉及的代码

`apps/api/migrations/`、`apps/api/sql/queries/multi.sql`、`apps/api/internal/multi/{types.go,member.go,projection.go}`、`apps/api/internal/handler/{convert.go,snapshot.go}`、`contracts/openapi/schemas/multi-*.yaml`、`packages/shared/src/multi.ts` 及其测试/生成物。
