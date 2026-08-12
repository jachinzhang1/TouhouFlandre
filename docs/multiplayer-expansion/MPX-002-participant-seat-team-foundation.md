# MPX-002：建立 member、玩家席位与 WS v2 数据底座

**类型**：功能/数据模型 Issue

**优先级**：P0

**依赖**：MPX-001

**建议标签**：`type:feature` `area:db` `area:contracts` `area:shared`

## 要解决的问题

`apps/api/migrations/0007_spectators.sql` 已将观战者从玩家席位中分离，但玩家仍被约束为 slot `1/2`，公开成员视图也没有 `memberId`。当前投影还会跳过猜测者自己的 room event，客户端却不能区分“授权/投影跳过”和真正丢帧。比分、胜者和棋盘的数据库列可留到 MPX-004 迁移，但 v2 wire shape、身份、席位和序列语义必须先稳定。

## 目标

在不改变现有两人 race/relay 规则的前提下，建立可以承载 N 个玩家的 member/seat 模型、集合契约和可严格补齐的 v2 事件流。

推荐模型：

- `multi_member`：保留 `role`，将 `slot` 改为房间内唯一的正整数；player 必须有 seat，spectator seat 为空。
- `multi_room`：增加 `player_limit`，默认 2；它表示允许入座的最大玩家数，不表示开局必须凑满。MPX-005 开放设置前，创建接口仍固定写 2。
- OpenAPI/WS v2 的 member、棋盘、比分和结果集合统一为包含公开 `memberId` 的数组，并按 seat 稳定排序；客户端按 memberId 建索引，wire 不使用动态 JSON key。seat 负责排序并保留“seat 1 为房主”的本轮规则，但不作为身份键。MPX-002 可先把现有 `score_slot1/2`、`winner_slot`、双棋盘数据库行适配成两元素集合，MPX-004 再迁移底层存储并扩到 N 人。
- `touhouflandre-multi.v2` 中，hello 将游戏水位命名为 `lastGameSequence`；投影无业务内容时发送同 sequence 的 cursor envelope，客户端只有在游戏 sequence 不连续时才请求 snapshot。`hello-ok` 声明捕获的目标水位，重放/缓冲帧之后的 `sync.complete` 才确认可持久化的完成水位。MPX-007 再为同一握手增加独立的可选 `lastChatCursor`，不得复用游戏水位。
- 游戏事件连接建立采用“注册缓冲 → 捕获 high watermark → 重放至水位 → 排空较新缓冲帧 → 实时”的屏障，保证重放与实时切换无缺口且按 sequence 交付；MPX-007/008 在同一机制上增加聊天水位。
- 不创建 `multi_team` 或 `team_id`。独立竞速直接以 match roster/member 为计分主体，团队玩法另行设计。

## 属于本 Issue

- goose migration、SQLC 查询和可丢弃测试库的 Down 演练；既有房间回填 `player_limit=2`。
- Go `multi` 的 member/seat helper，以及 OpenAPI/WS v2 的参与者集合、公开 `memberId` 和 cursor envelope。
- 默认配置和数据库约束：`player_limit >= 2` 且不超过服务端硬上限；spectator 不占玩家容量。
- 约束和索引测试，包括重复 seat、spectator 占 seat、非法 player_limit、旧数据迁移和重复令牌。
- hub 实时推送、重放、snapshot 事件投影和 Web reducer 的连续 sequence 测试。
- 更新 `docs/multiplayer.md` 中只描述“当前仍为两人玩法”的说明，链接本计划。

## 不属于本 Issue

- 不改竞速胜负算法、比分底层存储、N 人循环或接力轮次推进；这些属于 MPX-004 或未来 relay Issue。
- 不开放房主 UI 设置，不改变加入/准备/重连流程；行为接入属于 MPX-003/005。
- 不实现聊天表或消息事件；聊天依赖本 Issue 的 memberId/role 和 v2 frame 分类，但属于 MPX-007/008。

## 验收标准

- 现有迁移数据升级后，两个玩家的 seat 和显示内容保持不变，房间玩家上限为 2；已有观战者仍可读。
- 数据库不再以 `slot BETWEEN 1 AND 2` 作为通用玩家席位约束，但仍保证同房间 seat 唯一、player/spectator role 与 seat 组合合法。
- 所有新增集合字段对空数组有稳定 JSON 形态；生成的 Go/TS 类型和契约检查通过。
- v2 观察者对每个 `room_event.sequence` 都收到业务事件或 cursor；客户端发现真正缺口时只触发一次 snapshot 对齐。
- 在注册、捕获游戏高水位、重放和切实时各阶段并发写入 room event，客户端都按 sequence 收齐且重复事件只应用一次。
- hello 的游戏水位小于 0、超过服务端当前水位或无法从保留事件连续补齐时不会被静默接受；协议返回稳定的 resync-required 路径，客户端以 snapshot 对齐后再恢复实时。
- `go test ./...`、`pnpm typecheck`、`task gen` 和协议检查通过；Go/Web 生成目录无漂移，迁移 Down 可在一次性测试数据库执行。
- 两人 race/relay 在最终 v2 集合/cursor 契约下完成现有流程；v1 不再继续扩展。MPX-004 只替换内部双人存储并让相同集合承载 N 人，不再次改变 wire shape。

## 可能涉及的代码

`apps/api/migrations/`、`apps/api/sql/queries/multi.sql`、`apps/api/internal/multi/{types.go,projection.go}`、`apps/api/internal/hub/`、`apps/api/internal/handler/{convert.go,snapshot.go}`、`contracts/openapi/schemas/multi-*.yaml`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts`、`apps/web/src/hooks/useRoom.ts` 及其测试/生成物。
