# Phase 2 开发计划 — 房间与大厅（无实时）

> 依据：[`08_multiplayer_mode_design.md`](../08_multiplayer_mode_design.md) §13 M2、§4.1（创建与加入）、§4.6（大厅离开/TTL）、§5（游客令牌）、§6.1（房间状态机 lobby 段）、§6.2（成员状态机）；[`07_productization_plan.md`](../07_productization_plan.md) §7.1（REST 命令）
> 状态：✅ 已完成（执行记录见 §10）
> 影响范围：`apps/api/internal/handler/`（rooms 相关）、`apps/api/internal/multi/`（新包：房间/成员领域逻辑）、`apps/api/internal/config/`、`apps/api/cmd/server/`、`apps/api/internal/server/`（路由注册）、集成测试
> 原则：**先有可玩的房间生命周期，再接实时**。本阶段只做 REST 命令 + 快照端点 + 游客令牌 + 大厅 TTL 的 sweeper 骨架，不建 WS、不开始对局。

---

## 1. 目标与边界

### 目标

1. `POST /api/rooms`（创建，赛制 + 昵称）、`GET /api/rooms/{roomCode}`（公开预检）、`POST /api/rooms/{roomCode}/join`（加入）落地。
2. 游客令牌签发/鉴权：`crypto/rand` 32 字节 → base64url，`sha256` 存库，`Authorization: Bearer guest:{token}`，`guest:` 前缀类型检查（08 §5.1）。
3. `POST /api/rooms/{roomId}/ready`、`POST /api/rooms/{roomId}/leave`、`DELETE /api/rooms/{roomId}`（房主=slot 1）落地，大厅状态机（`lobby` 段）完整。
4. `GET /api/rooms/{roomId}/snapshot` 落地：成员列表投影（`room.updated` 事件经事件表持久化，供 Phase 4 广播复用；本阶段事件仅入库）。
5. sweeper 骨架：大厅 TTL 过期、closed 保留期到期删除（08 §9.1 删除策略）；`event_seq` 取号机制落地。
6. 集成测试覆盖大厅全生命周期。

### 非目标（本阶段明确不做）

- 不建 WS 连接/事件广播（Phase 4）——`room_event` 行照写，hub 未接。
- 不对局（`ready` 双方就绪 → 对局开始留到 Phase 3；本阶段双方 ready 只置位并广播 `room.updated`）。
- 不做猜测、比分、rematch、断线宽限（对局相关，Phase 3）。
- 不做前端页面（Phase 5）。

---

## 2. 前置条件（开工前必须完成）

- [ ] Phase 1 交付物齐备：OpenAPI 10 端点 schema、`0002_multiplayer.sql` 已迁移、`multi.sql` 查询已生成、WS 类型入库。
- [ ] 单人路径集成测试基线通过（`internal/server/server_test.go` 全绿）。

---

## 3. 交付物

| 交付物 | 位置 | 说明 |
|---|---|---|
| 领域包 | `apps/api/internal/multi/` | 房间/成员状态机纯逻辑（便于固定时钟单测） |
| handler | `apps/api/internal/handler/rooms.go`（或拆分文件） | strict server 实现 + 错误映射 |
| 错误码 | `apps/api/internal/handler/errors.go` | 新增 10 个多人错误码常量 |
| 路由 | `apps/api/internal/server/server.go` | 注册 `/api/rooms*` 路由 |
| 配置 | `apps/api/internal/config/` | `MULTI_LOBBY_TTL` 等本阶段用到的项 |
| sweeper 骨架 | `apps/api/internal/multi/sweeper.go`（或 handler 层） | 大厅 TTL / closed 清理 |
| 测试 | `apps/api/internal/multi/*_test.go`、`apps/api/internal/server/` 集成测试 | 单元 + 真实 Postgres |

---

## 4. 关键设计要点（摘自 08，修复后版本）

### 4.1 创建与加入（08 §4.1/§5.1）

- 房间号：字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（32 字符），6 位；生成冲突重试（`code` UNIQUE）。
- 房间 id：25 位小写字母数字（复用 `newSessionID` 模式，08 §9.1）。
- 加入校验：存在且 `lobby`、未满 2 人 → 否则 `ROOM_NOT_FOUND`/`ROOM_FULL`/`ROOM_CLOSED`；房间号输入归一化（去空格/连字符、转大写）。
- 昵称：trim + 去控制字符 + ≤16 字符；空 → `匿名玩家`（08 §5.2）。
- 公开预检 `GET /rooms/{roomCode}`：200 `{roomCode, format, status, memberCount}`；不存在/已关闭 → 404 `ROOM_NOT_FOUND`；不含成员名/token；与 join 共用按 IP 限流（默认每分钟 10 次，进程内计数，08 §8.5）。

### 4.2 游客令牌（08 §5.1）

- 创建/加入时签发：`crypto/rand` 32 字节 → base64url（无填充）；库中只存 `sha256(token)`（`multi_member.token_hash`）。
- 传输：REST `Authorization: Bearer guest:{token}`；类型不匹配/无效/不属于该房间 → `GUEST_UNAUTHORIZED`。
- 令牌房间级有效，无独立过期（随房间 TTL）。

### 4.3 大厅状态机（08 §6.1 lobby 段 + §6.2）

- `lobby → lobby`：加入者入座 slot2 / 加入者离开（删行释放 slot，房主 ready 保留）/ 房主 ready（置位，双方就绪时**本阶段只发事件**，对局开始 Phase 3）。
- `lobby → closed`：房主离开 / lobby TTL 过期。
- 离开（大厅）：房主 → 房间关闭（`room.closed reason=host_left`）；加入者 → 删除成员行（`reason` 不产生事件或 `room.updated` 全量刷新，按 §14 决策「大厅事件粒度」用 `room.updated` 承载成员变化）。
- 幂等：`ready` 幂等（重复 ready 不报错，状态未变）；重复 ready 后对局已开始 → `MATCH_ALREADY_STARTED`（Phase 3 语义，本阶段无对局不触发）。
- 房间状态 `closed` 为终态：`expires_at = now() + MULTI_EVENT_RETENTION`，sweeper 单条 `DELETE FROM multi_room` CASCADE 清整树（08 §9.1）。

### 4.4 快照端点（08 §7.1/§7.3）

- `GET /api/rooms/{roomId}/snapshot?after=<seq>`：成员令牌；返回 `roomId/roomCode/format/status/members[]` + `events[after..]`（事件重放）。
- 本阶段 `events` 来自 `room_event` 表（`room.updated` 入库）；快照无 `match`/`round` 字段（无对局）。
- `event_seq` 取号：事务内 `UPDATE multi_room SET event_seq = event_seq + 1 WHERE id=$room RETURNING event_seq`（08 §9.2 步骤 9），写 `room_event`。

### 4.5 锁序纪律（本阶段生效的部分）

- 大厅命令（join/leave/ready/close）**只锁房间行**，事务内完成「校验状态 + 变更 + 取号」（08 §9.2 锁序纪律——大厅路径）；Phase 3 对局路径加入 局→场→房间 顺序，本阶段为其铺路。

---

## 5. 设计细节

### 5.1 handler 结构（沿用单人模式）

- `handler.Server` 注入不变（`pool/q/now/rng`）；新增房间相关方法按 oapi-codegen strict interface 拆分实现。
- 错误映射：`ApiError{Status, Code, Message}`；`internalError(err)` 兜底（08 §7.2 错误码表）。
- 鉴权中间件（房间级命令）：解析 `Authorization: Bearer guest:{token}` → `sha256` → `GetMemberByTokenHash`（不带 room_id 的索引查询）→ 校验 `member.room_id == 路径 roomId` 且令牌未撤销（行存在且 status != `left`）。

### 5.2 sweeper 骨架（08 §6.3，仅大厅职责）

```text
goroutine（1s tick，context 控制，跟随 server 生命周期）：
  1. ListExpiredLobbyRooms（status='lobby' AND expires_at < now）→ 逐房间锁房间行 → CloseRoom（room.closed reason=ttl，事件入库）
  2. ListExpiredClosedRooms（status='closed' AND expires_at < now）→ DELETE FROM multi_room（CASCADE）
```

- 重启安全：启动即扫描一次（补处理停机期间过期项）。
- 宽限期/局超时/间歇等对局职责 Phase 3 追加到同一 goroutine（**唯一后台调度器**，08 §6.3）。

### 5.3 事件入库（Phase 4 前奏）

- 本阶段所有大厅变更（join/leave/ready/close/ttl）在事务内写 `room_event`（type=`room.updated`/`room.closed`，规范形态 payload：成员列表全量、状态、赛制）。
- 无 hub，事件只入库不广播；快照端点按 `after` 游标重放。

---

## 6. 任务分解

任务有依赖序；每个任务完成即标记，验收不通过不进入下一任务。

### T1 — 领域包：房间号生成、成员/房间状态机纯逻辑

**输入**：08 §4.1/§6.1/§6.2；`internal/game` 单测范式（固定时钟/表驱动）。
**动作**：

1. `internal/multi/`：`roomcode.go`（32 字符集、6 位、冲突重试）、`room.go`（`lobby` 状态转移纯函数：join/leave/ready/close 的合法转移表）、`member.go`（slot 分配、昵称规范化）。
2. 单元测试：房间号字符集/长度/归一化；状态转移非法路径（对 closed 房 join、对已满房 join 等）返回对应错误码。

**验收**：

- [ ] `go test ./internal/multi/...` 全绿（固定时钟、表驱动）。

### T2 — 游客令牌签发与鉴权中间件

**输入**：08 §5.1；`handler/errors.go` 现有模式。
**动作**：

1. 令牌生成：`crypto/rand` 32 字节 → base64url 无填充；`sha256` 摘要存 `multi_member.token_hash`（响应只回明文 token 一次）。
2. 鉴权中间件：解析 `Bearer guest:{token}` → `GetMemberByTokenHash` → 校验房间归属与成员状态；失败 `GUEST_UNAUTHORIZED`。
3. 扩展性：令牌类型前缀 `guest:`/`jwt:` 分派（未来 Stage 2），类型不匹配 `GUEST_UNAUTHORIZED`。

**验收**：

- [ ] 中间件单测：缺失/格式错/哈希不符/跨房间令牌/`left` 成员各返回 401。
- [ ] 集成测试：创建返回 token 可用，伪造 token 被拒。

### T3 — 创建/预检/加入端点

**输入**：08 §7.1；Phase 1 生成契约。
**动作**：

1. `POST /api/rooms`：校验 format（`INVALID_FORMAT`）→ 生成房间号（冲突重试）→ 事务：`CreateRoom` + `CreateMember`（slot 1，房主）+ 取号 + 写 `room.updated` 事件（初始成员列表）→ 201。
2. `GET /api/rooms/{roomCode}`：`GetRoomByCode`；不存在/已关闭 → 404；返回 `{roomCode, format, status, memberCount}`。
3. `POST /api/rooms/{roomCode}/join`：归一化房间号 → 锁房间行 → 校验（`ROOM_NOT_FOUND`/`ROOM_FULL`/`ROOM_CLOSED`）→ `CreateMember`（slot 2）+ 事件入库 → 201 语义响应（契约定义的状态码）。
4. 加入/预检共用按 IP 速率限制（进程内计数，默认 10 次/分，08 §8.5）。

**验收**：

- [ ] 集成测试：创建→预检→加入全链路；满房 409；房间号归一化（小写/空格/连字符）；非法 format 400；限流触发后 429/403（按契约定义）。
- [ ] 单测：房间号冲突重试路径（mock rng）。

### T4 — ready/leave/close + 快照端点

**输入**：08 §7.1/§6.1/§4.4。
**动作**：

1. `POST /ready`：幂等置位；成员列表变化 → `room.updated` 事件入库（Phase 3 在此接入对局开始）。
2. `POST /leave`：大厅路径——锁房间行：房主 → `CloseRoom`（`room.closed reason=host_left`）；加入者 → 删成员行 + `room.updated`。
3. `DELETE /api/rooms/{roomId}`：仅房主（slot 1）令牌；仅 `lobby`；关闭（`room.closed reason=host_left`）。
4. `GET /snapshot?after=<seq>`：组装 room/members + `ListEventsAfterSeq` 重放；`after` 缺省为 0。

**验收**：

- [ ] 集成测试：ready 幂等；加入者 leave 释放 slot（房间可再加入、房主 ready 保留）；房主 leave/close 关房间（后续命令 404/`ROOM_CLOSED`）；快照重放游标正确（乱序/缺口语义 Phase 4 校验）。
- [ ] 非房主 DELETE → 403/`GUEST_UNAUTHORIZED`。

### T5 — sweeper 骨架 + 配置

**输入**：08 §6.3/§9.1/§11.1。
**动作**：

1. `internal/config` 新增：`MULTI_LOBBY_TTL`（30min）、`MULTI_EVENT_RETENTION`（closed→删除保留时长）；其余 Phase 6 补齐。加入/预检限流为固定默认（每分钟 10 次、进程内计数，08 §8.5），不进配置。
2. sweeper goroutine：大厅 TTL 过期关闭 + closed 保留期到期删除（§5.2）；启动补扫一次。
3. 优雅排空：`cmd/server/main.go` 现有 10s 窗口内 stop sweeper（完整排空链 Phase 4/6）。

**验收**：

- [ ] 集成测试：短 TTL（注入配置）下大厅过期 → 房间 closed（事件 `reason=ttl`）→ 保留期后行删除（`multi_room` 及子表均空）。
- [ ] `go vet`/`go build` 通过。

### T6 — 回归与收尾

**动作**：

1. 全量回归：`go test ./...`（含单人 `server_test.go` 六端点回归）、`task gen` 零 diff、`pnpm typecheck`（契约未变）。
2. 更新 §10 执行记录；明确 Phase 3 输入（ready 双就绪钩子、事件入库链路、sweeper goroutine）。

**验收**：

- [ ] §7 总验收全绿；单人路径无回归。

---

## 7. 总验收标准（阶段退出条件）

1. 创建/预检/加入/就绪/离开/关闭/快照 7 个端点（不含对局与 WS 端点）全部可用，错误码与 08 §7.2 一致。
2. 游客令牌签发/鉴权闭环，`GUEST_UNAUTHORIZED` 覆盖缺失/伪造/跨房/撤销。
3. 大厅状态机（`lobby` 段）与 §6.2 成员状态一致；房间号生成/冲突重试/归一化正确。
4. sweeper 骨架（TTL + closed 清理）经集成测试验证；事件入库链路（`event_seq` 取号）正确。
5. 单人六端点集成测试无回归；生成物零 diff。

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 事件入库但未广播，快照与事件语义不一致 | 本阶段事件只作为快照重放数据源，形状由 protocol.yaml 锁住；Phase 4 hub 直接复用 |
| 令牌泄漏（明文只在响应出现一次） | 库中仅存 sha256；日志/错误信息不含 token（07 §5.3）；测试断言响应外不出现 |
| 大厅 TTL 误关活跃房间 | TTL 从最后活动时间起算（expires_at 语义明确定义）；短 TTL 集成测试验证边界 |
| 加入限流误伤正常玩家 | 默认 10 次/分 + 房间号 32^6 空间；可配置 |

## 9. 与后续阶段的衔接

- **Phase 3（对局引擎）**：`ready` 双就绪事务接管（绑 catalog_version、抽题、建 round 1）；sweeper 扩到局超时/宽限/间歇/展示期；`room.updated` 之外的事件类型开始产生。
- **Phase 4（实时通道）**：hub 订阅 `room_event`（事件先入库后广播，07 §7.2）；快照端点成为重连补齐入口。
- **Phase 5（前端）**：`/multi` 创建/加入表单调用本阶段端点与公开预检。

---

## 10. 执行记录（2026-08-06，分支 feature/multipalyer_mode_backend）

### 完成情况

- T1-T6 全部完成；总验收 5 条全部满足：创建/预检/加入/就绪/离开/关闭/快照 7 端点可用且错误码与 08 §7.2 一致；游客令牌签发/鉴权闭环（缺失/伪造/跨房/left/类型不匹配各路径）；大厅状态机（lobby 段）与成员状态一致；sweeper 骨架（TTL + closed 清理）集成测试验证、`event_seq` 取号正确；单人六端点集成测试无回归、生成物零 diff。
- 全量回归：`cd apps/api && go vet/build/test ./...` ✅（多人单元 + 集成 13 用例 + 单人回归）、`pnpm test` ✅、`pnpm typecheck` ✅、`task gen` 零 diff ✅、`lint:openapi`/`check:openapi-refs`/`check:ws-protocol` ✅。
- 冒烟等价：集成测试覆盖创建→预检→加入→就绪→离开→关闭→TTL→清理全链路（httptest 真实 server + 真实 Postgres）。

### 执行中发现的真实问题与修复

| 问题 | 修复 |
|---|---|
| **kin-openapi gorillamux 路由限制**：08 §7.1 的 `/api/rooms/{roomCode}`(GET) 与 `/api/rooms/{roomId}`(DELETE) 同形路径，gorillamux 按「路径形状」注册，先注册的同形路由在方法不匹配时 `ErrMethodNotAllowed` 短路，导致 GET 预检一律 405 | `/api/rooms*` 路径跳过 OpenAPI 请求校验（server.go 注释说明，与 redocly 例外同根因）；参数/body 校验由 oapi-codegen wrapper + handler 层等价完成（format 枚举、body 必填、roundIndex 解析等均有 handler 断言，集成测试覆盖） |
| **OpenAPI `security` 声明与鉴权模型冲突**：oapi validator 对带 security 的操作要求 `AuthenticationFunc`，未配置时所有请求 403（含带合法 Bearer 的请求）；且 WS 升级请求本身无 Authorization 头（hello 首帧鉴权），无法走 AuthenticationFunc | 移除全部房间操作的 `security:` 声明（`GuestBearer` securityScheme 保留作契约文档并注明由 handler 中间件执行）；鉴权统一由 `RoomGuardMiddleware`（strict middleware）负责：缺失/伪造/跨房/left/类型不匹配 → 401，非房主关闭 → 403 |
| **strict middleware 的 operationID 是 Go 方法名**（`RoomsJoin`）而非 OpenAPI operationId（`rooms_join`），导致中间件 switch 全部失配、限流与鉴权从未生效 | switch 改为 Go 方法名；限流/鉴权经调试确认生效 |
| `RoomsGetInfo` 的 closed 检查写在 `err != nil` 分支内，已存在房间（err==nil）时永不触发 → 已关闭房间预检返回 200 | 检查移到 err 处理之后（已关闭 → 404 ROOM_NOT_FOUND，集成测试覆盖） |
| 保留期清理后成员行随 CASCADE 消失，令牌查询 ErrNoRows → 401（测试原期望 404） | 修正测试期望为 401（符合 §6.2「行没了撤销令牌」语义），并直接断言 `multi_room` 行已删除 |
| 集成测试共用 server 实例时，按 IP 限流（10/min）会被正常流程用例累计打满，导致测试互相干扰 | `handler.Option`（`WithJoinRateLimit`）+ `server.NewWithOptions`：共享测试 server 放宽限流；限流专项测试用独立 server（limit=2）验证 429 |
| join 请求体 required 语义：无 body 时 oapi validator 报 400「value is required but missing」（验证器被跳过前）；handler 层等价校验 `Body == nil` → 400 | 行为一致，测试覆盖（JoinRoom 带 `{}` body） |

### 与计划的偏差

- **OpenAPI 请求校验豁免 `/api/rooms*`**：见上表（gorillamux 同形路径限制）。这不是绕过校验：wrapper 生成的参数绑定 + handler 层业务校验 + 集成测试构成等价保障。
- **operation 级 `security` 移除**：鉴权完全由 handler 中间件执行（计划 T2 本就是中间件方案）；契约 securityScheme 保留为文档。
- **`join` 状态码**：按契约定为 201（Phase 1 已定义）。
- **`event_seq` 取号**：新增 `IncrementRoomEventSeq` 查询（08 §9.2 步骤 9），sweeper 与 handler 共用 `multi.AppendEvent`。
- **handler.Server 选项**：`NewServer(pool, opts...)` + `server.NewWithOptions`（仅测试注入限流参数，生产默认 10/min 不变）。
- **成员 id**：复用 `newSessionID`（25 位）模式，非独立生成器。
- 无 WS 连接/广播（非目标，Phase 4）；`rematch`/`guess`/`ws` 三个端点保持 501 占位。

### Phase 3 输入（明确交接）

- `ready` 双就绪事务已在 handler 置位并写 `room.updated`（Phase 3 在此接入对局开始：锁房间行 → 绑 `catalog_version` → 抽题 → 建 round 1）。
- 事件入库链路（`event_seq` 取号 + `room_event` 写规范形态）就绪；sweeper goroutine 就绪（`multi.Sweeper` 注入配置，main.go 已接线）。
- 锁序纪律基础：大厅命令只锁房间行（`GetRoomForUpdate`/`GetRoomByCodeForUpdate`）已落地。
- `multi_round`/`multi_guess`/`multi_match` 相关查询（`CreateMatch`/`CreateRound`/`InsertGuess`/`GetRoundForUpdate` 等）Phase 1 已生成，可复用。

