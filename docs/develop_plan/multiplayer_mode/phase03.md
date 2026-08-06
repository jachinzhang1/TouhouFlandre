# Phase 3 开发计划 — 对局引擎

> 依据：[`08_multiplayer_mode_design.md`](../08_multiplayer_mode_design.md) §13 M3、§4.2（赛制与胜场）、§4.3（单局流程）、§4.4（单局结束判定）、§4.6（对局中离开/断线/重启）、§6.1（playing/finished 段）、§6.3（单局状态）、§9.2（猜测事务与锁序纪律）
> 状态：📋 待执行（执行记录见 §10）
> 影响范围：`apps/api/internal/multi/`（对局/猜测/结算纯逻辑）、`apps/api/internal/handler/`（ready 双就绪、guess、rematch、对局中 leave）、`apps/api/internal/server/`、`internal/game/`（如需扩展答案池选取）、集成测试
> 原则：**对局正确性优先于实时性**。本阶段所有对局推进都是事务+事件入库，不依赖 WS 推送；Phase 4 才把事件广播出去。

---

## 1. 目标与边界

### 目标

1. `ready` 双方就绪 → 对局开始：锁房间行，绑 `catalog_version`（场级），抽题（排除本场已用），建 round 1（countdown，`startsAt = now + ROUND_COUNTDOWN`）。
2. 猜测事务完整落地（08 §9.2 修复后版本）：行锁 局→场→房间、deadline 校验、`ROUND_ENDED`/`ROUND_NOT_ACTIVE` 分流、幂等键、`DUPLICATE_GUESS`、`GUESS_LIMIT_REACHED`、双方用尽平局、比分与 `match.ended`。
3. sweeper 全职责：countdown→playing、局超时平局（与猜测事务共用结算纯函数）、间歇后开下一局（`startsAt = 上局 ended_at + INTERMISSION`）、`round_count < 3×N` 上限、宽限期逾期、`FINISHED_RETENTION`。
4. 对局中 leave（弃赛/forfeit，锁序 局→场→房间）、断线宽限逾期判负、服务重启明确终止（含 countdown 态局）。
5. `rematch`：`finished` 后双方确认 → 新场行（`match_index+1`、重绑版本、比分清零）。
6. 单局判定与局间推进为纯函数（固定时钟单测）；集成测试覆盖竞速、平局、超时、重启、rematch。

### 非目标（本阶段明确不做）

- 不做 WS 推送（事件照常入库，Phase 4 广播）。
- 不做前端（Phase 5）。
- 不做配置收尾/指标（Phase 6）。
- 不做房间号/大厅路径（Phase 2 已交付）。

---

## 2. 前置条件（开工前必须完成）

- [ ] Phase 2 交付：7 个大厅端点可用、令牌鉴权闭环、事件入库链路、sweeper goroutine 骨架、集成测试基线。
- [ ] 单人 `internal/game` 黄金用例通过（`CompareCharacter`/`GetDailyAnswer` 为对局抽题/反馈复用）。

---

## 3. 交付物

| 交付物 | 位置 | 说明 |
|---|---|---|
| 对局纯逻辑 | `apps/api/internal/multi/match.go`、`round.go`、`guess.go`、`settlement.go` | 状态转移/结算/抽题纯函数 |
| 猜测事务 | `apps/api/internal/multi/guess_txn.go`（或 handler 编排 + 纯逻辑） | 08 §9.2 事务步骤 |
| sweeper 全职责 | `apps/api/internal/multi/sweeper.go` | 扩展 Phase 2 骨架 |
| handler | `apps/api/internal/handler/` | guess/rematch/对局中 leave 端点 |
| 重启终止 | `apps/api/internal/server/` 启动钩子 | 启动扫描终止进行中对局 |
| 测试 | `internal/multi/*_test.go`、`internal/server/` 集成测试 | 单元 + 真实 Postgres + 并发 |

---

## 4. 关键设计要点（摘自 08，修复后版本）

### 4.1 对局开始（ready 双就绪，08 §6.1/§4.3）

- 事务（锁房间行）：`room.status: lobby→playing` → `CreateMatch`（`match_index=0`，绑当前 `CatalogState.currentVersion` 为 `catalog_version`，`target_wins` 按 format）→ 抽题 → `CreateRound`（`round_index=1`，`status=countdown`，`starts_at = now + ROUND_COUNTDOWN`，`deadline = starts_at + ROUND_SECONDS`）→ 取号写事件（`match.started` + `round.started`）。
- 抽题：从绑定版本快照 `enabled_as_answer` 池排除本场已用答案，`rng` 选取；池空防御性兜底允许复用（08 §6.1）。
- 局间时间线（08 §4.3 修复后）：round 1 `startsAt = 就绪 + ROUND_COUNTDOWN`（3s）；后续局 `startsAt = 上局 ended_at + INTERMISSION`（5s，间歇兼作倒计时，**不叠加** `ROUND_COUNTDOWN`）。

### 4.2 猜测事务（08 §9.2，修复后全流程）

```text
1. 锁局行（FOR UPDATE）──同局所有猜测/结算在此串行
2. 读场行（catalog_version/target_wins/score）
3. 角色校验 + 反馈计算：guess_id 与 answer_id 须在场版本快照且 EnabledAsGuess
   （缺任一 → INVALID_GUESS）；CompareCharacter → statuses（真实列序）；is_correct
4. 局态分流（不可猜时**不写入**）：
   a. playing 且 starts_at <= now < deadline → 正常路径
   b. now >= deadline → 共用超时结算纯函数判平（winner_slot=NULL, ended_at=now），
      本次猜测不写入，响应 ROUND_NOT_ACTIVE；场级推进由 sweeper（≤1s）完成
   c. ended → is_correct ? ROUND_ENDED（携带局结果，不写入）: ROUND_NOT_ACTIVE
   d. countdown 或 now < starts_at → ROUND_NOT_ACTIVE
5. 幂等：INSERT … ON CONFLICT (round_id, member_id, idempotency_key) DO NOTHING
   （0 行 → 重读首次结果返回；guess_id 冲突 → DUPLICATE_GUESS）
6. is_correct → UPDATE round ended, winner_slot（条件更新兜底）
7. 双方均 8 猜 → UPDATE round ended, winner_slot=NULL（平局）
8. 比分：UPDATE match score_slot{win}+1（平局不加分）；达 target_wins →
   match.status=finished + room.status=finished（expires_at = now + FINISHED_RETENTION）
9. 取号：UPDATE room SET event_seq += 1 RETURNING event_seq
10. 写 room_event（round.guess / round.ended / match.ended，规范形态）
COMMIT → 提交后 hub 才广播（本阶段仅入库）
```

### 4.3 锁序纪律（08 §9.2 修复后，三条路径一致）

- 猜测事务：局 → 场 → 房间。
- 对局中 leave（forfeit）：**先锁局行**（判对方胜、结束当前局）→ 锁场行（match finished）→ 取房间事件号（room finished）。绝不先锁房间。
- sweeper 超时结算/局间推进：先锁局行 → 需要时锁场行（开新局校验 `round_count < 3×N`、`status='playing'`；达上限判 `match.ended reason=round_cap`）→ 取房间事件号。
- 大厅命令只锁房间行（Phase 2 已落地，不动）。

### 4.4 单局结束判定（08 §4.4，优先级）

1. 猜中 → 该成员胜，局立即结束。
2. 双方用尽（各 8 猜且无人猜中）→ 平局。
3. 整局超时（`deadline` 到点）→ 平局（sweeper 判定；猜测事务在 deadline 后拒绝并同步结算，见 §4.2 步骤 4b）。

### 4.5 对局生命周期（08 §4.6/§6.1）

| 场景 | 规则 |
|---|---|
| 对局中 leave | 弃赛：先锁局判对方胜 → match/room finished（`reason=forfeit`）；成员行置 `left` 保留 |
| 对局中断线逾期 | 当前局判对方胜 + `match.ended reason=disconnect`；判对方胜**不要求对方在线**（双方离线先逾期者判负） |
| 服务重启 | 启动时对进行中对局（**含 countdown 态局**）终止：`round.ended`(平局) + `match.ended reason=server_restart, result=draw`；大厅房间保留 |
| rematch | `finished` 后任意成员 `POST /rematch` 置 `rematch_ready`（幂等）；双方就绪且 `connected` 时同一事务（锁房间行）`INSERT` 新 `multi_match`（`match_index = MAX+1`、重绑版本）→ 重置 `rematch_ready=false` → 建 round 1 → `match.started` + `round.started` |
| 平局重开 | 不计胜场，`INTERMISSION` 后自动下一局 |
| 安全上限 | `round_count < 3×N` 才开新局；第 `3×N` 局结束仍无胜者 → `match.ended reason=round_cap, result=draw` |

---

## 5. 设计细节

### 5.1 纯函数边界（08 §6.3，固定时钟单测）

- `SettleRound(round, guesses聚合, now) → {roundEnd, winnerSlot}`：猜中/双方用尽/超时三分支。
- `AdvanceMatch(match, roundCount, targetWins, now) → {nextAction: nextRound|matchEnd, reason}`：下一局 or `match.ended`（normal/round_cap）。
- `DrawAnswer(pool, used, rng)`：排除 + 选取。
- 全部不触 DB/HTTP；事务层只做编排与写库。

### 5.2 事件类型（本阶段新增入库，Payload 形状见 protocol.yaml）

- `match.started`、`round.started`、`round.playing`、`round.opponent.guess`（**规范形态**：真实列序状态数组，逐观察者投影 Phase 4）、`round.ended`、`match.rematch`；带 reason 的事件按 08 §8.3 各自独立枚举：`match.ended`（reason: normal/forfeit/disconnect/server_restart/round_cap）、`room.closed`（reason: host_left/member_left/ttl/retention）。

### 5.3 重启终止实现

- `cmd/server` 启动、sweeper 启动前：`GetActiveMatchForUpdate`（status='playing'）→ 逐场锁局/场/房间 → `round.ended`(draw) + `match.ended reason=server_restart` 入库。幂等：重启后再重启不再重复终止（match 已 finished）。

### 5.4 猜测端点路由

- `POST /api/rooms/{roomId}/rounds/{roundIndex}/guess`：body `{guessId, idempotencyKey}`；响应 200（自视角完整反馈）或 409（错误码表）；`roundIndex` 不匹配当前局 → `ROUND_NOT_ACTIVE`/`ROUND_ENDED` 按局态。

---

## 6. 任务分解

任务有依赖序；每个任务完成即标记，验收不通过不进入下一任务。

### T1 — 纯函数与单测

**输入**：08 §4.2/§4.4/§6.3；`internal/game` 黄金用例范式。
**动作**：

1. `internal/multi/settlement.go`：`SettleRound`/`AdvanceMatch`/`DrawAnswer` + 固定时钟表驱动单测。
2. targetWins 数学（`(N+1)/2`）、`3×N` 上限边界（bo1 连平 3 局判平、bo7 21 局上限）黄金用例。
3. 抽题排除：池 113、排除已用、空池兜底复用。

**验收**：

- [ ] `go test ./internal/multi/...` 全绿；边界用例（3N 局、双满猜、deadline 整点）覆盖。

### T2 — 对局开始事务（ready 双就绪）

**输入**：08 §6.1；Phase 2 的 `SetMemberReady` 与事件入库。
**动作**：

1. ready 事务扩展：双方 `ready && connected` → 锁房间行 → 状态校验（`lobby`）→ `CreateMatch`（绑 `CatalogState.currentVersion`）+ 抽题 + `CreateRound`（round 1, countdown）→ 事件 `match.started`+`round.started` → `room.status='playing'`。
2. 后到 ready 在 `playing`/`finished` → `MATCH_ALREADY_STARTED`。
3. 抽题失败（版本快照缺失/空池且无法兜底）→ `CATALOG_NOT_READY`/`INTERNAL`。

**验收**：

- [ ] 集成测试：双 ready → 对局开始（round 1 countdown，`startsAt≈now+3s`，版本绑定正确）；单方 ready 不开始；重复 ready 语义。

### T3 — 猜测事务（08 §9.2 全流程）

**输入**：08 §9.2 修复后步骤；单人 `INVALID_GUESS` 语义。
**动作**：

1. 实现 §4.2 的 10 步事务（锁序 局→场→房间；`GetActiveRoundForUpdate` 取当前局）。
2. 反馈计算复用 `game.CompareCharacter`；`statuses` 存真实列序（投影权威源）。
3. 幂等键/重复角色/猜尽/迟到猜测分流全部分支。
4. 事件入库：`round.guess`（规范形态，**不含**名称/标签/值，08 §4.5 数据最小化）。

**验收**：

- [ ] 集成测试：正常猜测 200（自视角反馈）；竞速（两 goroutine 同时正确猜测 → 恰一胜者，败者 409 `ROUND_ENDED` 带局结果）；`DUPLICATE_GUESS`；幂等重试返回首次结果；8 猜用尽 `GUESS_LIMIT_REACHED`；双方用尽平局；**deadline 竞态**（超时后猜测被拒且不判胜）；**ended 局分流**（正确→`ROUND_ENDED`/错误→`ROUND_NOT_ACTIVE`）。

### T4 — 比分与 match.ended + 平局重开

**输入**：08 §4.2/§4.4；T3 事务第 8 步。
**动作**：

1. 比分更新、`target_wins` 判定、`match/room → finished`（`expires_at = now + FINISHED_RETENTION`）。
2. sweeper 扩展：局结束（非 match 结束）→ `INTERMISSION` 后 `CreateRound`（`round_count+1`、`3×N` 检查、`startsAt = ended_at + INTERMISSION`）→ `round.started`；达上限 → `match.ended reason=round_cap`。
3. 单测：`AdvanceMatch` 覆盖 normal/round_cap/平局推进。

**验收**：

- [ ] 集成测试：bo3 完整对局（2-0/2-1 含平局重开）；局间 `startsAt = 上局 ended_at + 5s`（注入短间歇验证）；比分在 `round.ended`/`match.ended` 事件中正确。

### T5 — forfeit / 断线判负 / 重启终止

**输入**：08 §4.6/§6.1/§6.2；Phase 2 sweeper 骨架。
**动作**：

1. 对局中 leave：`GetActiveRoundForUpdate` → 锁局判对方胜 → 锁场/房间 → `match.ended reason=forfeit`；成员行 `left`。
2. sweeper 宽限：`ListTimedOutMembers` → 对局中逾期 → 判对方胜（`reason=disconnect`）+ `match.ended`；大厅逾期复用 Phase 2 逻辑。
3. 启动终止钩子：`GetActiveMatchForUpdate` → 逐场 `round.ended`(draw)+`match.ended reason=server_restart`（含 countdown 局）。
4. 双方离线：各自宽限，先逾期者触发（判对方胜不要求对方在线）。

**验收**：

- [ ] 集成测试：对局中 leave → 对方胜 + `match.ended reason=forfeit`；断线宽限逾期 → `reason=disconnect`；**对局中 leave 与并发猜测** → 结果一致、无重复结算（统一锁序）；重启路径 → 重连/拉快照见 `reason=server_restart, result=draw`（含 countdown 态局）。

### T6 — rematch

**输入**：08 §6.1/§4.6。
**动作**：

1. `POST /rematch`：仅 `finished`（否则 `REMATCH_NOT_AVAILABLE`）；置 `rematch_ready`（幂等）→ `match.rematch` 事件。
2. 双方就绪且 `connected` 时同一事务（锁房间行）：`INSERT` 新 `multi_match`（`match_index = MAX+1`、重绑版本）→ 重置 `rematch_ready` → 建 round 1 → `match.started` + `round.started`。
3. rematch 等待期成员离开/逾期 → 房间关闭（`room.closed reason=member_left`/`host_left`）。

**验收**：

- [ ] 集成测试：双方 rematch → 新场行（比分/round_count 为 0、`match_index` 递增、版本重绑）；单方 rematch 等待；等待期离开 → 房间关闭。

### T7 — 回归与收尾

**动作**：

1. 全量回归：`go test ./...`（单人 + 多人全部）、`task gen` 零 diff。
2. 更新 §10 执行记录；明确 Phase 4 输入（事件规范形态已入库、`GetRoomSnapshotState` 快照数据源）。

**验收**：

- [ ] §7 总验收全绿；单人路径无回归。

---

## 7. 总验收标准（阶段退出条件）

1. 双 ready 开局、猜测全分支（竞速/平局/超时/迟到分流）、比分与 `match.ended` 全部正确，集成测试覆盖。
2. 锁序纪律三条路径（猜测/forfeit/sweeper）均为 局→场→房间，无死锁、无重复结算。
3. sweeper 覆盖 countdown/超时/间歇/宽限/上限/展示期；重启终止（含 countdown）幂等。
4. rematch 新场行语义正确（`match_index` 递增、版本重绑、比分清零）。
5. 事件以规范形态入库（`round.guess` 无名称/标签/值），形状符合 protocol.yaml。

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 并发猜测/结算竞态 | 行锁串行化 + 条件更新兜底 + 集成测试（两 goroutine 竞速、leave 并发猜测、deadline 竞态） |
| 超时与猜测事务双写 round 状态 | 共用同一结算纯函数（08 §6.3），先锁局者结算，后到者走 4c/4d 分流 |
| 死锁（forfeit/sweeper 反向取锁） | 统一 局→场→房间 顺序，feofit 先锁局（08 §9.2 锁序纪律）；集成测试压并发路径 |
| 重启重复终止 | match 已 finished 过滤；终止事务幂等 |
| 抽题池空 | 防御性兜底复用 + `CATALOG_NOT_READY` 兜底 |

## 9. 与后续阶段的衔接

- **Phase 4（实时通道）**：`room_event` 已有规范形态（含逐观察者事件），hub 只做「读库 → 按观察者投影 → 扇出」；`round.opponent.guess` 的列置换投影在 hub 层实现。
- **Phase 5（前端）**：`round.started`/`round.ended`/`match.ended` 的 `startsAt`/结果字段驱动弹窗与倒计时。
- **Phase 6（收尾）**：`forfeits_total{reason}` 等指标挂接本阶段 reason 枚举。

---

## 10. 执行记录

> 状态：待执行。完成后按仓库惯例记录完成情况、真实问题与修复、与计划的偏差（参照 `migration_to_go/phase01.md` §10 格式）。
