# Phase 1 开发计划 — 多人契约与数据层

> 依据：[`08_multiplayer_mode_design.md`](../08_multiplayer_mode_design.md) §13 M1、§7（API 设计）、§8（WS 协议）、§9（数据模型）；[`07_productization_plan.md`](../07_productization_plan.md) §7.3（`contracts/ws/protocol.yaml`）
> 状态：✅ 已完成（执行记录见 §10）
> 影响范围：`contracts/`（新增 `ws/`）、`apps/api/migrations/`（新增 `0002_multiplayer.sql`）、`apps/api/sql/queries/`（新增 `multi.sql`）、`apps/api/internal/generated/`、`packages/shared/src/`、Taskfile、CI
> 原则：**契约与数据先行**。本阶段只建立 OpenAPI/WS 契约、数据库迁移与 sqlc 查询，不实现任何房间/对局业务逻辑。

---

## 1. 目标与边界

### 目标

1. OpenAPI 新增全部多人端点（08 §7.1 共 10 个）与 schema，走既有 `task gen` 生成链路，生成物零 diff 入库。
2. 新增 `contracts/ws/protocol.yaml`：事件表（08 §8.3）、信封（§8.2）、客户端消息（`hello`/`ack`）、时序、权限与有效/无效示例；CI 校验 schema 与示例。
3. `0002_multiplayer.sql` 建 6 张表（`multi_room`/`multi_match`/`multi_member`/`multi_round`/`multi_guess`/`room_event`）与索引、CHECK 约束。
4. `sql/queries/multi.sql` 提供 08 §9.3 清单全部查询，sqlc 生成入库。
5. WS 事件 Go/TS 类型：Go 侧进 `apps/api/internal/generated/`（或 `internal/multi/types.go`），TS 侧进 `packages/shared/src/`，手写维护，与 protocol.yaml 一致性由 CI 校验。

### 非目标（本阶段明确不做）

- 不实现 REST 业务逻辑（创建/加入/就绪等留到 Phase 2），只声明契约。
- 不实现 WS hub、连接管理、投影（Phase 4）。
- 不实现对局引擎、sweeper、猜测事务（Phase 3）。
- 不改动单人路径的任何契约与行为（回归零 diff）。

---

## 2. 前置条件（开工前必须完成）

- [ ] 单人链路基线通过：`pnpm test`、`pnpm typecheck`、`cd apps/api && go test ./...`、`task gen` 后 `git diff --exit-code -- apps/api/internal/generated` 干净。
- [ ] 已通读 08 全文，熟悉 §7 端点表、§7.2 错误码、§8 事件表、§9.1 表结构（含修复后的规则：deadline 校验 §9.2 步骤 4、锁序纪律、`room.closed reason=member_left`、`MULTI_EVENT_RETENTION` 删除策略）。

---

## 3. 交付物

| 交付物 | 位置 | 说明 |
|---|---|---|
| OpenAPI 多人端点与 schema | `contracts/openapi/paths/rooms*.yaml`、`schemas/multi*.yaml`（或按资源拆分） | 10 端点、错误码、快照形状（08 §7.3） |
| WS 协议规范 | `contracts/ws/protocol.yaml`（新建目录） | 事件信封、事件表、客户端消息、有效/无效示例 |
| 多人迁移 | `apps/api/migrations/0002_multiplayer.sql` | 6 表 + 索引 + CHECK（08 §9.1） |
| sqlc 查询 | `apps/api/sql/queries/multi.sql` | 08 §9.3 清单 |
| 生成物 | `apps/api/internal/generated/`（openapi + repo）、`apps/web/src/generated/` | `task gen` 产出，提交入库 |
| WS 类型 | Go：`apps/api/internal/generated/ws/` 或 `internal/multi/types.go`；TS：`packages/shared/src/` | 手写维护，CI 校验与 protocol.yaml 一致 |
| CI 校验 | `.github/workflows/ci.yml` + Taskfile | OpenAPI lint/refs、protocol.yaml 校验、gen diff |

---

## 4. 关键设计要点（摘自 08，本阶段需落实的契约事实）

### 4.1 端点一览（08 §7.1）

| 方法 | 路径 | 鉴权 | 备注 |
|---|---|---|---|
| `POST` | `/api/rooms` | 无 | 创建 → 201 `{roomId, roomCode, guestToken, member}` |
| `GET` | `/api/rooms/{roomCode}` | 无 | 公开预检（加入前可见赛制）：`{roomCode, format, status, memberCount}`；不存在/已关闭 → 404 |
| `POST` | `/api/rooms/{roomCode}/join` | 无 | 加入 → `{roomId, guestToken, member}` |
| `GET` | `/api/rooms/{roomId}/snapshot?after=<seq>` | 成员令牌 | 快照 + 事件补齐 |
| `POST` | `/api/rooms/{roomId}/ready` | 成员令牌 | 幂等 |
| `POST` | `/api/rooms/{roomId}/rematch` | 成员令牌 | 幂等，仅 `finished` |
| `POST` | `/api/rooms/{roomId}/rounds/{roundIndex}/guess` | 成员令牌 | body: `guessId`, `idempotencyKey` |
| `POST` | `/api/rooms/{roomId}/leave` | 成员令牌 | 大厅释放 slot / 对局判负 |
| `DELETE` | `/api/rooms/{roomId}` | 房主令牌（slot 1） | 关闭大厅房间 |
| `GET` | `/api/rooms/{roomId}/ws` | 升级校验 + hello | WS 事件通道 |

鉴权约定：REST 一律 `Authorization: Bearer guest:{token}`；创建/加入无鉴权；令牌带 `guest:` 前缀，类型不匹配 → `GUEST_UNAUTHORIZED`。

### 4.2 错误码（08 §7.2）

`ROOM_NOT_FOUND`(404)、`ROOM_FULL`(409)、`ROOM_CLOSED`(409)、`GUEST_UNAUTHORIZED`(401)、`INVALID_FORMAT`(400)、`MATCH_ALREADY_STARTED`(409)、`REMATCH_NOT_AVAILABLE`(409)、`ROUND_NOT_ACTIVE`(409，含 countdown/已结束/已超时)、`ROUND_ENDED`(409，正确猜测迟到，携带局结果)、`GUESS_LIMIT_REACHED`(409)、复用 `DUPLICATE_GUESS`(409)。

### 4.3 WS 事件表（08 §8.3，protocol.yaml 必须覆盖）

`room.updated`、`match.started`、`match.rematch`、`round.started`、`round.playing`、`round.opponent.guess`（唯一逐观察者事件）、`round.ended`、`match.ended`（reason: normal/forfeit/disconnect/server_restart/round_cap）、`room.closed`（reason: host_left/member_left/ttl/retention）。

客户端消息仅 `hello {token, lastSequence}`（首帧）与 `ack {lastSequence}`。

### 4.4 表结构要点（08 §9.1）

- `multi_room`：`code` UNIQUE（6 位 32 字符集）、`event_seq`（事务内 `UPDATE … RETURNING` 取号）、`expires_at`（lobby TTL / finished 展示期 / closed 事件保留期）、`(status, expires_at)` 索引。
- `multi_match`：`UNIQUE(room_id, match_index)`、`catalog_version REFERENCES catalog_snapshot(version) ON DELETE RESTRICT`（场级题库绑定）、`target_wins`/`score_slot1/2`/`round_count` 自包含。
- `multi_member`：`UNIQUE(room_id, slot)`、`UNIQUE(room_id, token_hash)`；slot 1 = 房主；`token_hash` 独立索引（鉴权查询不带 room_id）。
- `multi_round`：`UNIQUE(match_id, round_index)`、CHECK `(status='ended') = (ended_at IS NOT NULL)`、`(status, deadline)` 索引。
- `multi_guess`：三个 UNIQUE（`(round_id, member_id, guess_id)` / `(round_id, member_id, sequence)` / `(round_id, member_id, idempotency_key)`）、`statuses` jsonb CHECK 长度为 6（真实列序，匿名投影的权威源）。
- `room_event`：`UNIQUE(room_id, sequence)`、`(room_id, sequence)` 索引。
- 删除策略：`closed` 时 `expires_at = now() + MULTI_EVENT_RETENTION`，sweeper 单条 `DELETE FROM multi_room` CASCADE 清整树（Phase 3 sweeper 落地，Phase 1 仅建表）。

### 4.5 快照形状（08 §7.3）

逐观察者投影：`self`（完整棋盘）、`opponent`（匿名矩阵 + 列置换）、`events[after..]`。SQL 不承担展示组装（`jsonb_agg` 单查询取原始数据，Go 投影层水合）。

---

## 5. 设计细节

### 5.1 OpenAPI 拆分

沿用 `contracts/openapi/` 多文件结构：

```text
contracts/openapi/
├── openapi.yaml            # 入口聚合（新增 paths/components 引用）
├── paths/
│   ├── rooms.yaml          # POST /rooms、GET /rooms/{roomCode}、POST /rooms/{roomCode}/join
│   ├── room.yaml           # GET snapshot、POST ready/rematch/leave、DELETE、GET ws
│   └── room-rounds.yaml    # POST /rooms/{roomId}/rounds/{roundIndex}/guess
└── schemas/
    ├── multi-room.yaml     # RoomSnapshot、MemberView、RoomInfo（公开预检）
    ├── multi-match.yaml    # MatchView（matchIndex/targetWins/score/roundIndex/maxRounds/rematchReady）
    ├── multi-round.yaml    # RoundView（status/startsAt/deadline/maxGuesses/self/opponent）
    └── multi-common.yaml   # GuestToken 前缀约定注释、RoomFormat 枚举、错误码枚举扩展
```

注意：快照响应中 `opponent.rows[].statuses` 与 `self.guesses[]` 的投影语义写在 schema description；`statuses` 为 `enum: exact|partial|miss|higher|lower|unknown` 长度 6 数组。

### 5.2 protocol.yaml 结构（08 §7.3 要求）

```yaml
# contracts/ws/protocol.yaml
info: { version: "1.0", description: "touhouflandre-multi.v1 子协议" }
envelope:                      # 08 §8.2
  required: [type, eventId, roomId, sequence, occurredAt, payload]
events:                        # 08 §8.3 全表，逐事件给 payload schema + 权限（全体/仅对手）
  - { type: round.opponent.guess, observer: opponent, ... }
clientMessages:                # hello / ack
examples:                      # 每个事件 1 个有效示例；hello/ack 各 1 有效 + 若干无效示例
  valid: [...]
  invalid: [ {hello 缺 token}, {hello 非首帧}, {未知 type}, {sequence 非整数} ... ]
```

CI 校验：schema 可解析（redocly 或等价）、示例逐一通过 JSON Schema 校验、无效示例必须失败（正反例双测）。

### 5.3 sqlc 查询清单（08 §9.3 全量）

`CreateRoom`、`GetRoomByCode`、`GetRoom`、`GetRoomSnapshotState`（jsonb_agg 单查询）、`UpdateRoomStatus`、`CloseRoom`、`CreateMember`、`GetMemberByTokenHash`、`UpdateMemberStatus`、`SetMemberReady`、`SetMemberRematchReady`、`ListMembersForRematch`、`CreateMatch`（`match_index = MAX+1`）、`GetMatchForUpdate`、`GetActiveMatchForUpdate`（重启终止取进行中 match，按 `status='playing'` 过滤）、`EndMatch`、`CreateRound`（`round_count+1` + `3×N` 上限检查）、`GetRoundForUpdate`、`GetActiveRoundForUpdate`（`status='playing'|'countdown'` 过滤）、`ListRoundsForMatch`、`ListUsedAnswersForMatch`、`InsertGuess`、`CountGuessesForRoundMember`、`EndRound`、`UpdateMatchScore`、`ListGuessesForRound`、`InsertRoomEvent`、`ListEventsAfterSeq`、`ListExpiredLobbyRooms`、`ListExpiredRounds`、`ListTimedOutMembers`、`ListFinishedMatches`、`ListExpiredClosedRooms`。

> 生成后保持 `task check:generated` 零 diff；查询仅建骨架（占位注释），Phase 2/3 实现业务时按需微调签名。

### 5.4 WS 类型（Go/TS）

- Go：`apps/api/internal/generated/ws/`（或 `internal/multi/types.go`）手写 `Envelope`、各事件 payload struct、`EventType` 常量、`ClientMessage`（hello/ack）；与 protocol.yaml 字段名一一对应。
- TS：`packages/shared/src/multi.ts`（或 `ws.ts`）导出同构类型；`packages/shared` 无测试（`--passWithNoTests`），一致性由 CI 校验脚本兜底（见 §6 T4）。
- 字段命名：信封沿用 07 §7.3（`eventId`/`roomId`/`sequence`/`occurredAt`/`payload`）；payload 内 snake 不出现（Go/TS 均为 camelCase）。

---

## 6. 任务分解

任务有依赖序；每个任务完成即标记，验收不通过不进入下一任务。

### T1 — OpenAPI 多人 schema 与端点

**输入**：08 §7.1/§7.2/§7.3；现有 `contracts/openapi/` 结构。
**动作**：

1. `schemas/multi-*.yaml`：RoomSnapshot、MemberView、MatchView、RoundView（含 `self.guesses` 复用单人 `GuessResult`、`opponent.rows.statuses` 枚举数组）、RoomInfo（公开预检）、RoomFormat 枚举、错误码枚举追加 10 个新码。
2. `paths/rooms*.yaml`：10 个 operation，`operationId` 遵循 `<resource>_<action>`；`POST /rooms/{roomId}/rounds/{roundIndex}/guess` 的 409 分支列出 `ROUND_ENDED`/`ROUND_NOT_ACTIVE`/`GUESS_LIMIT_REACHED`/`DUPLICATE_GUESS`/`ROOM_CLOSED`/`GUEST_UNAUTHORIZED`。
3. `openapi.yaml` 聚合引用。

**验收**：

- [ ] `pnpm lint:openapi` 通过；`$ref`/孤儿检查通过。
- [ ] `task gen` 后生成物（Go openapi.gen.go + web api.ts）更新且 `git diff --exit-code` 干净。
- [ ] 10 个端点 operationId 全局唯一；错误码与 §7.2 表一致。

### T2 — `contracts/ws/protocol.yaml`

**输入**：08 §8.1–§8.3；§4.3 事件表。
**动作**：

1. 新建 `contracts/ws/` 目录与 `protocol.yaml`：信封 schema（§8.2）、9 个服务端事件（§8.3，逐事件 payload + 权限）、2 个客户端消息（`hello`/`ack`）、握手流程（升级校验 → hello → hello-ok → 重放 → 实时流，§8.1）。
2. 有效示例：每个事件 1 个；`hello-ok`、`replaced`（旧连接关闭）示例。
3. 无效示例：缺失 token、非首帧、未知 type、sequence 非整数、ack 在 hello 前等，至少 6 个。

**验收**：

- [ ] 本地校验脚本（§6 T4）跑通：正例全过、反例全拒。
- [ ] 事件字段与 08 §8.3 表逐一对应（评审对照清单）。

### T3 — `0002_multiplayer.sql` + `multi.sql` + 生成

**输入**：08 §9.1 表结构、§9.3 查询清单。
**动作**：

1. 编写 `0002_multiplayer.sql`：6 表 + 索引 + CHECK；字段与注释严格对齐 08 §9.1（含 `multi_member.id` 注释注明 slot 1 = 房主）。
2. 编写 `sql/queries/multi.sql`：§5.3 全量查询；`GetRoomSnapshotState` 用 `jsonb_agg` 一次取 room/match/round/members + 双方 guesses。
3. `task db:migrate`（新库/测试库验证迁移可执行）+ `task gen:repo` 生成。

**验收**：

- [ ] 全新数据库上 `task db:migrate` 成功（goose 记录 `0002`）。
- [ ] `go vet ./...`、`go build ./...` 通过；生成物零 diff。
- [ ] 表名/列名/约束与 08 §9.1 一致（可对照 SQL 评审）。

### T4 — WS 类型 + CI 校验

**输入**：T2 的 protocol.yaml；`packages/shared`、`apps/api/internal` 现状。
**动作**：

1. Go 侧 WS 类型（`internal/generated/ws/` 或 `internal/multi/types.go`）+ TS 侧 `packages/shared/src/` 类型，字段名与 protocol.yaml 对齐。
2. CI 校验脚本（Node）：解析 protocol.yaml → JSON Schema 校验正反例；抽查 TS 类型与 schema 字段一致性（简单字段名集合比对即可，不强求全量类型推导）。
3. Taskfile 新增 `check:ws-protocol`（或并入 `check:generated` 依赖链）；CI `check` job 加入。

**验收**：

- [ ] `task check:ws-protocol` 通过；故意改坏一个示例或类型字段，CI 必须红。
- [ ] `pnpm typecheck` 通过（TS 类型入库）。

### T5 — 回归与收尾

**动作**：

1. 全量回归：`pnpm test`、`pnpm typecheck`、`cd apps/api && go test ./...`、`task gen` + `check:generated`。
2. 更新本文件 §10 执行记录，标记完成状态。
3. 明确 Phase 2 输入：REST 契约（schema 已就绪）、迁移与查询（可复用）、WS 协议与类型（Phase 4 使用）。

**验收**：

- [ ] Phase 0 基线全部指标无回归（单人路径零改动）。
- [ ] §7 总验收清单全绿。

---

## 7. 总验收标准（阶段退出条件）

1. OpenAPI 10 端点 + 全部多人 schema 入库，`task gen` 零 diff，CI lint/refs 通过。
2. `contracts/ws/protocol.yaml` 存在，正反例校验进 CI。
3. `0002_multiplayer.sql` 可在干净库迁移成功；sqlc 全量查询生成；`go vet/build` 通过。
4. WS Go/TS 类型与 protocol.yaml 一致，typecheck 通过。
5. 单人路径契约与生成物零改动（`git diff` 校验）。

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| OpenAPI 与 WS 协议双份规范漂移 | protocol.yaml 独立 CI 校验 + TS 字段名比对脚本；Go/TS 类型手写但字段集合被 CI 锁住 |
| `jsonb_agg` 快照查询形状与投影需求不匹配 | Phase 1 只建骨架，Phase 2/3 用集成测试驱动微调；SQL 不承担展示组装（08 §9.4） |
| 迁移 0002 与既有 0001 冲突 | 独立 goose 文件，不改 0001；干净库全量迁移验证 |
| 生成物污染（gen 顺序问题） | 沿用 `task check:generated` 纪律，CI 强制 diff |

## 9. 与后续阶段的衔接

- **Phase 2（房间与大厅）**：消费 REST 契约与 `CreateRoom`/`GetRoomByCode`/`CreateMember`/`GetMemberByTokenHash`/`SetMemberReady` 等查询；`GetRoomSnapshotState` 在快照端点落地。
- **Phase 3（对局引擎）**：消费 `CreateMatch`/`CreateRound`/`GetRoundForUpdate`/`InsertGuess`/`EndRound`/`UpdateMatchScore`/`InsertRoomEvent` 等；`ListExpiredClosedRooms` 配合删除策略。
- **Phase 4（实时通道）**：消费 WS 协议类型与 `ListEventsAfterSeq`；事件广播的 payload 形状由 protocol.yaml 锁住。
- **Phase 6（收尾）**：指标/日志字段命名与协议事件类型对齐。

---

## 10. 执行记录（2026-08-06，分支 feature/multipalyer_mode_backend）

### 完成情况

- T1-T5 全部完成；总验收 5 条全部满足：OpenAPI 10 端点 + 多人 schema 入库且 `task gen` 零 diff、`contracts/ws/protocol.yaml` 正反例校验进 CI、`0002_multiplayer.sql` 干净库迁移成功 + sqlc 全量查询生成、WS Go/TS 类型与协议一致且 typecheck 通过、单人路径契约零改动。
- 全量回归：`pnpm test` ✅、`pnpm typecheck` ✅、`pnpm lint:openapi`（2 warning 可接受）✅、`check:openapi-refs` ✅、`task check:ws-protocol` ✅（含故意改坏 TS 字段验证必红）、`cd apps/api && go vet/build/test ./...` ✅、`task gen` 后生成物零 diff ✅。
- 迁移：开发库 goose 到 version 2（`0002_multiplayer.sql`）；集成测试库在 TestMain 自动迁移到 version 2 后全绿。

### 执行中发现的真实问题与修复

| 问题 | 修复 |
|---|---|
| OpenAPI 路径模板冲突：`GET /api/rooms/{roomCode}`（公开预检）与 `DELETE /api/rooms/{roomId}`（房主关闭）同路径模板、仅参数名不同，redocly `no-identical-paths` 报错 | 设计（08 §7.1）按方法分派属有意为之；`redocly.yaml` 关闭该启发式规则并注释理由（沿用既有 `operation-4xx-response: off` 模式），另以 `ignore` 豁免 ws 端点的 `operation-2xx-response`（101 升级） |
| 单人回归测试 `TestCatalog` 断言 29 角色，而题库已随 TH20 扩展至 113（08 §4.2 亦以 113 为基线）；旧 Go 构建缓存掩盖了该漂移 | 测试断言更新为 113（仅测试代码，单人契约与行为零改动）——该问题先于本阶段存在（`feat(data): expand character catalog through TH20` 未同步测试） |
| oapi-codegen strict interface 要求 Server 实现全部 10 个房间方法，Phase 1 不实现业务逻辑导致 `go build` 失败 | `internal/handler/rooms.go` 提供 10 个 501 占位（`UNSUPPORTED_CONTENT_TYPE`，明确注释 Phase 2 逐个替换）；这是阶段内契约先行与「go test 必须过」两条验收的交点，非交付替身 |
| 计划建议的 `paths/rooms.yaml`/`room.yaml` 多路径文件与仓库「一路径一文件」惯例冲突（多 operation 文件也是非法 YAML——重复顶层 `post:` 键） | 拆分为 10 个单路径文件（`rooms`/`room-info`/`room-join`/`room-snapshot`/`room-ready`/`room-rematch`/`room-leave`/`room-close`/`room-ws`/`room-rounds`），`openapi.yaml` 整文件 `$ref`，与既有 sessions 系列一致 |
| 加入/预检按 IP 限流需要契约状态码（Phase 2 T3 验收「限流触发后 429/403（按契约定义）」），08 §7.2 错误码表无限流码 | 错误码枚举新增 `RATE_LIMITED`(429)，加入与预检端点声明 429 分支；`common.yaml` 错误码枚举直接扩展（保持 ErrorResponse 单一来源，而非计划建议的拆到 multi-common） |
| js-yaml 不在根依赖（仅 pnpm store 传递存在），`check-ws-protocol.mjs` 无法解析 | `pnpm add -D js-yaml -w`（v4 ESM，脚本用 `import { load }` 具名导出） |
| 手写迷你 JSON Schema 校验器初版缺 `enum` 校验、`oneOf` 分支测试会清空同级错误，导致两个反例漏检 | 补 `enum` 校验；`oneOf` 改用错误快照隔离（`errors.splice(before)`） |
| 控制帧（hello-ok/replaced）与客户端消息的 schema 形态不一致（type 字段归属） | 统一为平铺消息 schema 含 `type`（`const` 限定），TS 一致性比对规则统一 |

### 与计划的偏差

- **路径文件拆分**：计划 §5.1 建议 3 个 paths 文件；按仓库既有惯例拆为 10 个单路径文件（见上表）。
- **错误码位置**：`RATE_LIMITED` 与全部多人错误码直接扩展 `schemas/common.yaml#/ErrorResponse` 枚举（计划建议 multi-common.yaml 承载错误码枚举）。
- **查询清单补充**：`multi.sql` 在 08 §9.3 清单之外补充 `ListMembers`（大厅全量成员视图）、`DeleteMember`（大厅加入者离开删行）、`GetGuessByIdempotencyKey`（幂等重读首次结果）、`ListActiveMatches`（重启终止扫描全部进行中场）、`DeleteRoom`（sweeper CASCADE 删除）；`GetActiveMatchForUpdate` 定义为按房间取当前进行中场（forfeit 路径），重启终止走 `ListActiveMatches`。
- **`CreateRound` 实现**：round_count+1 与 `round_count < target_wins * factor` 上限检查合一（数据修改 CTE：UPDATE 0 行 → 无 INSERT → `ErrNoRows`），满足「上限检查在开局事务内」的锁序纪律。
- **handler 占位**：10 个 501 占位方法（见上表），Phase 2 逐个替换为真实实现。
- 本阶段未触碰 `Taskfile gen`/CI 的既有 check job 结构，仅新增 `check:ws-protocol` 独立任务与 CI 步骤。

### Phase 2 输入（明确交接）

- REST 契约：OpenAPI 10 端点 schema 已就绪（含 `RATE_LIMITED`），`openapi.gen.go` strict interface 已含 10 个房间方法（当前 501 占位）。
- 迁移与查询：`0002_multiplayer.sql` 已迁移；`multi.sql` 38 个查询已生成（含锁序需要的 `FOR UPDATE` 查询与快照聚合）。
- WS 协议与类型：`contracts/ws/protocol.yaml` 定稿并由 CI 校验；Go 类型 `internal/multi/types.go`、TS 类型 `packages/shared/src/multi.ts` 已入库（Phase 4 直接消费）。

