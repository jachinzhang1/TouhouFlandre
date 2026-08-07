# Phase 4 开发计划 — 实时通道（hub 与事件广播）

> 依据：[`08_multiplayer_mode_design.md`](../08_multiplayer_mode_design.md) §13 M4、§8（WebSocket 协议全节）、§4.5（逐观察者投影与列置换）、§4.6（断线/重连/服务重启）、§11.2（优雅排空）
> 状态：✅ 已完成（执行记录见 §10）
> 影响范围：`apps/api/internal/hub/`（新包：连接管理、投影、扇出）、`apps/api/internal/server/`（WS 升级路由）、`apps/api/cmd/server/`（排空顺序）、`apps/api/internal/multi/`（投影纯函数）、集成测试
> 原则：**事件先入库后广播**（07 §7.2）；Go 内存只保存活动连接与热点投影，不是房间状态真实来源（07 §7.1）。

---

## 1. 目标与边界

### 目标

1. `GET /api/rooms/{roomId}/ws` 升级：Origin ∈ `WEB_ORIGINS` + `Sec-WebSocket-Protocol: touhouflandre-multi.v1` 校验；建连后首帧必须是 `hello{token, lastSequence}`（07 §7.4），鉴权前不收发房间事件。
2. hub 连接注册：每成员单活跃连接（新连接替换旧连接，旧连接以 `replaced` 关闭）。
3. 事件扇出：REST/事务提交后从 `room_event` 读取 → 按观察者投影 → 推送；`round.opponent.guess` 唯一逐观察者事件（列置换）。
4. 重放与补齐：`hello` 携带 `lastSequence` → 重放缺口事件；客户端发现缺口 → `GET /snapshot?after=` 对齐（08 §8.4）。
5. 限制与慢消费者：读限 4KB、发送队列 64、写超时 10s、读超时 60s（心跳）、队列写满断连（1013）（08 §8.5）。
6. 优雅排空：SIGTERM → 终止进行中对局（含 countdown，Phase 3 钩子）→ 关 WS（1012）→ 停 sweeper → `e.Shutdown`（08 §11.2）。
7. 集成测试：连接/鉴权/重放/慢消费者/重启/事件先入库后广播全覆盖。

### 非目标（本阶段明确不做）

- 不做对局/猜测/结算逻辑（Phase 3 已交付，本阶段只推送其事件）。
- 不做前端（Phase 5）。
- 不做跨实例广播/`LISTEN/NOTIFY`/`FOR UPDATE SKIP LOCKED`（08 §9.4 延后项，由压测触发）。

---

## 2. 前置条件（开工前必须完成）

- [ ] Phase 3 交付：事件规范形态入库（含 `round.opponent.guess` 真实列序）、`GetRoomSnapshotState` 快照数据源、sweeper 全职责、启动终止钩子。
- [ ] `contracts/ws/protocol.yaml`（Phase 1）已定稿并 CI 校验。
- [ ] coder/websocket 已作为依赖（05 §9 选型，go.mod 引入）。

---

## 3. 交付物

| 交付物 | 位置 | 说明 |
|---|---|---|
| hub 包 | `apps/api/internal/hub/` | `hub.go`（注册/扇出/重放）、`conn.go`（读写循环/心跳/队列）、`project.go`（逐观察者投影） |
| 投影纯函数 | `apps/api/internal/multi/projection.go`（或 hub 内） | 列置换（Fisher–Yates，`(roundId, observerMemberId)` 种子）+ 匿名矩阵组装 |
| WS 升级路由 | `apps/api/internal/server/server.go` | 升级校验、协议协商 |
| 排空 | `apps/api/cmd/server/main.go` | 顺序：终止对局 → 关 WS(1012) → 停 sweeper → shutdown |
| 测试 | `apps/api/internal/hub/*_test.go`、`internal/server/` 集成测试 | coder/websocket 客户端 + 真实 Postgres |

---

## 4. 关键设计要点（摘自 08）

### 4.1 连接与鉴权（08 §8.1）

- 升级校验：Origin ∈ `WEB_ORIGINS`；`Sec-WebSocket-Protocol` 必须为 `touhouflandre-multi.v1`，不符拒绝升级。
- `hello{type:"hello", token, lastSequence}`：鉴权成功 → `hello-ok {roomId, nextSequence}` → 从 `lastSequence+1` 重放事件 → 进入实时流。
- 同成员新连接替换旧连接（旧连接 `replaced` 关闭）；每成员单活跃连接。
- Token 只出现在首帧，不进 URL/日志（07 §5.3）。

### 4.2 扇出与投影（08 §7.1/§8.3/§4.5）

- **先入库后广播**：REST 命令事务提交后，hub 才向房间成员扇出（07 §7.2）。
- 广播数据源 = `room_event` 行（规范形态），统一经投影函数后下发：
  - `round.opponent.guess`：**仅对手**可见；`statuses` 按观察者列置换（种子 `(roundId, observerMemberId)`，每局重打乱，Fisher–Yates）。
  - 其余事件全体成员，原样（规范形态不含名称/标签/值，08 §4.5 数据最小化）。
- 快照（`GetRoomSnapshotState`）+ 重放（`ListEventsAfterSeq`）+ 实时推送**三处共用同一投影函数**（08 §4.5 列置换约束）。
- 客户端消息：`hello`（首帧）、`ack {lastSequence}`（水位推进）。

### 4.3 重连与同步（08 §8.4）

1. 客户端指数退避重连（1s→2s→4s→8s→16s→30s 封顶 + 抖动），携带 `lastAppliedSeq`。
2. 重连成功 `hello{token, lastSequence}` → 服务端重放缺口。
3. 客户端校验连续性；任何缺口/异常 → `GET /snapshot?after=` 全量对齐。
4. 断线期间 `disconnected`，宽限 60s；逾期按 §4.6 处理（Phase 3 已实现判负，本阶段接 WS 断连事件）。

### 4.4 限制与慢消费者（08 §8.5）

- 读限 4KB；发送队列 64 条；写超时 10s；读超时 60s（心跳 ping/pong）。
- 发送队列写满 → 关闭该连接（1013），按断线处理（宽限期内可重连补同步），不阻塞房间广播。
- 每成员单连接（替换语义）；加入/预检限流已在 Phase 2。

### 4.5 优雅排空（08 §11.2）

```text
SIGTERM →
  1. 终止进行中对局（含 countdown 态局，Phase 3 终止钩子）
  2. 关所有 WS（1012 Service Restart）
  3. 停 sweeper
  4. e.Shutdown（现有 10s 窗口）
```

---

## 5. 设计细节

### 5.1 hub 数据流

```text
REST 事务（handler） ──提交──> room_event 行（规范形态）
                                   │
   ┌─────────────── 读取（ListEventsAfterSeq，按 sequence）┐
   ▼                                                        │
hub.Publish(roomID, event) ──► 逐连接投影（project.go）──► 写队列（64）──► WS
                                   ▲
   hello{lastSequence} ──► 重放：ListEventsAfterSeq(room, lastSequence+1)
```

- 投影函数签名建议：`ProjectEvent(event, observerMemberID, deps) → payload`；`ProjectSnapshot(snapshot, observerMemberID) → view`；两者共用 `columnPermutation(roundID, observerMemberID, 6)`。
- 快照端点（Phase 2/3 已有）在本阶段改为经同一投影函数输出，保证三路径一致。

### 5.2 连接生命周期

- 连接状态与 `multi_member.status` 联动：WS 断开 → `disconnected` + `grace_until`；重连成功 → `connected`（Phase 2/3 的 `UpdateMemberStatus` 复用）。
- 替换语义：同 `member_id` 新连接注册时，旧连接入队 `replaced` 关闭帧后断开；注册表 `map[roomID]map[memberID]*conn`（单实例，进程内）。
- 心跳：服务端定期 ping，读超时 60s 判定死连接。

### 5.3 测试矩阵（08 §12）

- 双客户端全生命周期（创建→加入→就绪→对局→结束→rematch）经 WS 收到全部事件。
- 乱序/重复/缺口：客户端按 sequence 去重排序；缺口拉快照。
- 慢消费者：发送队列写满 → 1013 → 重连补同步。
- 事件先入库后广播：断言推送发生在 REST 提交后（时序测试）。
- 重启：终止事件在重连后可见；1012 关闭。

---

## 6. 任务分解

任务有依赖序；每个任务完成即标记，验收不通过不进入下一任务。

### T1 — 投影纯函数（列置换 + 匿名矩阵）

**输入**：08 §4.5；Phase 3 事件规范形态。
**动作**：

1. `projection.go`：`columnPermutation(roundID, observerID, n=6)`（确定性种子、Fisher–Yates）；`ProjectOpponentRows(guesses, observerID)`（行=时间序、列=置换后状态）；`ProjectEvent`/`ProjectSnapshot` 统一入口。
2. 黄金用例：固定种子输出固定置换（跨语言与 TS 校验脚本对照可选）；下发给 A/B 的置换互相独立；每局种子不同。

**验收**：

- [ ] `go test` 全绿：确定性、A/B 独立性、每局重打乱、不泄漏名称/标签/值（payload 字段断言）。

### T2 — WS 升级与 hello 鉴权

**输入**：08 §8.1；Phase 2 令牌中间件复用。
**动作**：

1. `GET /api/rooms/{roomId}/ws`：Origin + 子协议校验 → coder/websocket 升级。
2. 首帧 `hello` 解析（读限 4KB）→ 令牌鉴权（`GetMemberByTokenHash` + 房间归属）→ `hello-ok {roomId, nextSequence}`；非首帧/失败 → 拒绝并关闭。
3. 同成员新连接替换旧连接（`replaced` 帧）。

**验收**：

- [ ] 集成测试：升级校验（错误 Origin/协议被拒）；hello 成功/失败路径；首帧非 hello 被关；替换旧连接。

### T3 — 事件扇出与逐观察者投影

**输入**：08 §8.3/§4.5；Phase 3 事件。
**动作**：

1. `hub.Publish(roomID, event)`：读 `room_event` 行 → 逐连接投影 → 写队列（非阻塞，满则断 1013）。
2. `round.opponent.guess` 仅推对手；其余全体；`room.closed` 推送后关闭连接。
3. 与快照/重放共用投影函数（T1）。

**验收**：

- [ ] 集成测试：双客户端收到对称广播；`round.opponent.guess` 只达对手且列置换正确（与 T1 黄金用例一致）；慢消费者断连不阻塞他人。

### T4 — 重放与补齐（hello.lastSequence）

**输入**：08 §8.4。
**动作**：

1. `hello{lastSequence}` → `ListEventsAfterSeq(room, lastSequence+1)` 重放（经投影）→ 实时流。
2. 快照端点接入同一投影（三路径一致）；客户端缺口走 snapshot 的契约已定（§8.4 步骤 3）。

**验收**：

- [ ] 集成测试：断线期间产生事件 → 重连后重放缺口、无重复；客户端乱序/重复应用幂等；拉快照后状态与事件流一致。

### T5 — 心跳/限制/优雅排空

**输入**：08 §8.5/§11.2。
**动作**：

1. 心跳 ping/pong + 读超时 60s；写超时 10s；队列 64；1013 断连路径。
2. 排空顺序落地（§4.5）：终止对局 → 1012 关连接 → 停 sweeper → `e.Shutdown`。
3. `ws_connections`/`events_total{type}` 计数器（Prometheus 语义，先挂基础计数；正式指标清单与暴露端点见 Phase 6 §4.2）。

**验收**：

- [ ] 集成测试：心跳维持长连接；发送队列满 → 1013 → 重连补同步；SIGTERM → 对局终止事件入库 + 连接收 1012 + 进程优雅退出。

### T6 — 回归与收尾

**动作**：

1. 全量回归：`go test ./...`、`task gen` 零 diff、protocol.yaml 校验仍绿。
2. 更新 §10 执行记录；明确 Phase 5 输入（WS 地址、事件类型、投影语义已稳定）。

**验收**：

- [ ] §7 总验收全绿；Phase 2/3 功能无回归（经 WS 推送后行为不变）。

---

## 7. 总验收标准（阶段退出条件）

1. WS 升级/鉴权/单连接替换/心跳/慢消费者/1013/1012 全链路可测、集成测试覆盖。
2. 事件先入库后广播成立；`round.opponent.guess` 逐观察者列置换与快照/重放三路径一致（黄金用例）。
3. 重放与补齐：断线重连无缺口无重复；快照对齐正确。
4. 优雅排空顺序正确，重启后对局终止事件可见（与 Phase 3 重启钩子联动）。
5. 单人路径与 Phase 2/3 行为无回归。

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 广播与事务时序（先入库后广播） | 事务提交后才读 `room_event` 扇出；时序集成测试 |
| 慢消费者阻塞房间广播 | 每连接独立队列 + 写满断连（1013），不阻塞 hub |
| 投影不一致（推送/快照/重放） | 三路径共用同一投影函数 + 黄金用例 |
| 连接泄漏/僵尸连接 | 心跳 + 读超时 60s + 替换语义 + 排空兜底 |
| 升级校验被绕过 | Origin/子协议/首帧 hello 三重校验；token 只走首帧 |

## 9. 与后续阶段的衔接

- **Phase 5（前端）**：`useRoom` 消费本阶段事件流与重放语义；匿名矩阵渲染对接 `round.opponent.guess`/快照投影结果。
- **Phase 6（收尾）**：正式指标（`ws_connections`、`reconnects_total`、`guess_latency`）与排空审计在本阶段基础上收口。

---

## 10. 执行记录（2026-08-06，分支 feature/multipalyer_mode_backend）

### 完成情况

- T1-T6 全部完成；总验收 5 条全部满足：WS 升级/鉴权/单连接替换/心跳/慢消费者/1013/1012 全链路可测（集成测试 8 用例）；事件先入库后广播成立、`round.opponent.guess` 逐观察者列置换与快照/重放三路径一致（同一 `multi.ProjectEvent`）；重放与补齐（断线重连无缺口、缺口拉快照契约已定）；优雅排空顺序落地（终止对局 → 1012 → 停 sweeper → shutdown）；单人路径与 Phase 2/3 行为无回归。
- 全量回归：`cd apps/api && go vet/build/test ./...` ✅（hub 集成 8 用例 + 前阶段全部）、`pnpm test` ✅、`pnpm typecheck` ✅、`task gen` 零 diff ✅、`lint:openapi`/`check:ws-protocol` ✅。
- coder/websocket 由 `// indirect` 转为直接依赖（go mod tidy）。

### 执行中发现的真实问题与修复

| 问题 | 修复 |
|---|---|
| **strict handler 只有 `context.Context`，无 echo.Context**：WS 升级需要 ResponseWriter/Request（hijack），ssi 方法拿不到 | RoomGuardMiddleware 对 `RoomsConnectWs` 把 echo.Context 注入请求上下文；ssi 方法取出后 `websocket.Accept` + 首帧 hello + 鉴权，随后 `conn.Serve()` 阻塞直到断开，返回 `(nil, nil)`（strict handler 对 nil 响应不写 101 头，避免 hijack 后写头报错） |
| **coder/websocket Accept 对「未请求子协议」不拒绝**：客户端不带 `Sec-WebSocket-Protocol` 时升级成功，违背「协议版本协商，不符拒绝」 | Accept 后校验 `ws.Subprotocol() == touhouflandre-multi.v1`，不符以策略违规关闭（升级请求本身成功，读侧收到 close） |
| **coder/websocket 无 per-read deadline API**：`SetReadDeadline` 不存在；「读超时 60s」需换实现 | 死亡连接检测走心跳：writeLoop 每 30s `Ping`（10s 写超时），pong 缺失 → 关闭连接；`Read` 阻塞由连接关闭解除（实现细节偏离设计字面，语义等价：死连接 ≤40s 内被清除） |
| **replaced 帧竞态**：直写 replaced 帧与 writeLoop 并发写乱序；「队列排空后关闭」的轮询方案与 in-flight 写竞态（len==0 误判 → CloseNow 截断帧） | replaced 帧入队（FIFO，保证最后）+ `afterReplaced` 原子标志；writeLoop 写出后见队列为空即自行关闭（08 §8.1「入队 replaced 关闭帧后断开」语义） |
| **事件广播三路径不一致风险**：Phase 3 快照投影（handler）与 hub 广播各写一套 | 投影收敛为 `multi.ProjectEvent`（快照/重放/实时共用；列置换种子 = `(roundID, observerMemberID)`，Phase 3 快照同源）；handler 快照层改为调用同一函数 |
| **sweeper 事件未广播**：对局推进（round.playing 等）由 sweeper 写事件，测试期发现连接收不到 | `multi.EventBroadcaster` 接口（`Publish(roomID)`，hub 实现），SweeperConfig 注入；main.go 与 fast 测试 server 共享同一 hub 实例（handler 与 sweeper 单实例） |
| **广播水位竞态**：新连接注册时若房间已推进，会漏推注册间隙事件 | Register 把水位校准到当前 `event_seq`；新连接的 hello 重放覆盖 `lastSequence+1` 起全部事件（含水位前的），实时流只推水位后的——客户端仍按 §8.4 拉快照兜底 |

### 与计划的偏差

- **无独立 hub 调度 goroutine**：`hub.Publish` 由 REST/sweeper 在事务提交后同步调用（读库 + 扇出 ≤5s 超时）；慢消费者不阻塞（非阻塞入队 + 1013），符合「先入库后广播」且省去生命周期管理。
- **`Publish(roomID string)` 签名**（接口与实现均为单参数）：无 ctx（内部 `context.WithTimeout` 兜底），避免请求 ctx 取消时广播中断。
- **读超时实现**：见上表（心跳 Ping 检测替代 per-read deadline）。
- **`hub.New(pool, grace)`**：宽限时长由调用方注入（Phase 6 接 `MULTI_DISCONNECT_GRACE`）。
- WS 升级校验的 Origin/子协议不符 → 400（OpenAPI 契约 400 分支），升级成功后的协议违规 → 连接关闭（无 REST 响应）。

### Phase 5 输入（明确交接）

- WS 地址推导：同源 `/api/rooms/{roomId}/ws`（next.config.ts `ws: true` 代理）或 `NEXT_PUBLIC_API_BASE_URL` http→ws；升级需要 Origin ∈ WEB_ORIGINS + 子协议 `touhouflandre-multi.v1`。
- 首帧 `hello{token, lastSequence}` → `hello-ok{roomId, nextSequence}` → 重放 → 实时流；客户端只发 `ack{lastSequence}`。
- 事件类型与投影语义已稳定（protocol.yaml + TS 类型在 packages/shared）；`round.opponent.guess` 只达对手且列置换；断线后成员 `disconnected`（宽限 60s），重连带 `lastSequence` 补缺口。

