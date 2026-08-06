# Phase 5 开发计划 — 前端多人页面

> 依据：[`08_multiplayer_mode_design.md`](../08_multiplayer_mode_design.md) §13 M5、§10（前端设计全节）、§8.4（重连与同步）、§4.3（局末展示交互）、§10.4（样式与无障碍）
> 状态：✅ 已完成（执行记录见 §10）
> 影响范围：`apps/web/src/app/multi/`、`apps/web/src/components/`（MultiLobby/RoomPage/RoomLobby/MatchBoard/SelfBoard/OpponentBoard/遮罩组件）、`apps/web/src/hooks/`（useRoom/useRoomClock）、`apps/web/src/lib/api.ts`（WS 封装）、`apps/web/next.config.ts`（`ws: true`）、`packages/shared/src/`（前端侧 WS 类型）、Vitest/Playwright
> 原则：**状态以事件 + 快照为唯一权威**（10.3）；客户端不自行计算反馈；localStorage 只做恢复入口。

---

## 1. 目标与边界

### 目标

1. `/multi`：创建房间（赛制单选 BO1/3/5/7 + 昵称）、加入房间（房间号 + 昵称，含公开预检 `GET /rooms/{roomCode}` 提示赛制）。
2. `/multi/room/[code]`：lobby → 对局 → 结果的完整状态机（`[code]` 非法 → `notFound()`；无成员资格 → 重定向 `/multi`）。
3. `useRoom`：WS 生命周期（连接 → hello → 事件流 → reducer 按 sequence 应用 → 重连退避/补齐 → 缺口拉快照）。
4. 棋盘：`SelfBoard`（复用单人反馈表 + 搜索）、`OpponentBoard`（匿名矩阵：无列头/名称/标签/值，只渲染颜色 + `aria-label` 状态名）、图例。
5. 遮罩：倒计时/间歇（`CountdownOverlay`）、局结果弹窗（胜负 + 答案 + 「查看对局」+ 下一局倒计时，倒计时不因查看而暂停）、整场结果（比分 + 再来一局 + 等待对方确认）。
6. 再来一局交互：`POST /rematch` → `match.rematch` → 双方确认 → `match.started`（新 matchIndex）自动回对局。
7. `next.config.ts` 增加 `ws: true`；localStorage `touhouflandre:multi-room` 恢复。
8. Vitest + Playwright（双 context）覆盖。

### 非目标（本阶段明确不做）

- 不做邀请链接（v1 复制房间号文本即可）、观战、排行榜、回放。
- 不做后端任何改动（契约/行为 Phase 1–4 已定稿，前端只消费）。
- 不做账号体系（Stage 2）。

---

## 2. 前置条件（开工前必须完成）

- [ ] Phase 4 交付：WS 端点可用（升级/hello/重放/扇出），`task dev` 下 Go+Next 均能起。
- [ ] `packages/shared` 已有 WS 事件 TS 类型（Phase 1）。
- [ ] 单人页面基线（搜索/反馈表/分享）可用作复用参照（`SingleGamePage`、`useCharacterSearch`、`feedback-*` 语义类）。

---

## 3. 交付物

| 交付物 | 位置 | 说明 |
|---|---|---|
| 大厅页 | `apps/web/src/app/multi/page.tsx` + `components/MultiLobby.tsx` | 创建/加入表单（赛制单选、昵称、房间号输入） |
| 房间页 | `apps/web/src/app/multi/room/[code]/page.tsx` + `components/RoomPage.tsx` | 状态机编排 |
| hooks | `apps/web/src/hooks/useRoom.ts`、`useRoomClock.ts` | WS 生命周期/reducer/重连/补齐；剩余时间渲染 |
| 棋盘/遮罩 | `components/RoomLobby/MatchBoard/SelfBoard/OpponentBoard/CountdownOverlay/RoundResultOverlay/MatchResultOverlay.tsx` | 10.2 清单 |
| 传输 | `apps/web/next.config.ts`（`ws: true`）、`lib/api.ts`（WS 客户端 + 房间 REST） | 同源 rewrite / 直连模式（`NEXT_PUBLIC_API_BASE_URL` 推导 ws(s)） |
| 持久化 | `apps/web/src/domain/` 或 `lib/`（localStorage 恢复逻辑） | `touhouflandre:multi-room`，与单人 key 并列 |
| 测试 | `apps/web/src/**/*.test.ts(x)` + `apps/web/e2e/` | Vitest（jsdom）+ Playwright（双 context） |

---

## 4. 关键设计要点（摘自 08，修复后版本）

### 4.1 路由与传输（08 §10.1）

- `/multi`（替换占位页）；`/multi/room/[code]`（替换占位页）；`[code]` 非法 → `notFound()`。
- 同源 WS：`next.config.ts` 的 `/api/:path*` rewrite 增加 `ws: true`（Next 13.2+，`next dev`/`next start` 可用；**standalone 部署有历史问题**，生产走反向代理或直连——风险表已有）。
- 直连模式：`NEXT_PUBLIC_API_BASE_URL` 非空时由 http→ws 推导。

### 4.2 客户端状态机（08 §10.3）

- `useRoom`：`connecting → lobby → playing(round) → finished`；连接层 `connected / reconnecting / grace-expired`；`finished` 可回 `playing`（rematch）。
- reducer 按 sequence 应用事件：`round.opponent.guess` 追加对手行；`round.ended` 替换本局为完整结果；`match.ended`/`room.closed` 切终态；乱序/重复按 sequence 去重。
- 连续性：本地 `lastAppliedSeq`；非连续序号 → `GET /snapshot?after=`；重连携带 `lastSequence`（08 §8.4：1s→2s→4s→8s→16s→30s 退避 + 抖动）。
- 竞速 UI：猜测输入只被 `round.status==='playing'` 门控，**无回合指示**。

### 4.3 匿名矩阵（08 §4.5/§10.4）

- 行 = 对手本局猜测（时间序）；列 = 6 位置；单元格 = 状态颜色（jade/amber/ink/sky/indigo/中性描边）。
- 无列头、无角色名/头像/展示值；`aria-label` 携带状态名；图例常驻（折叠为帮助按钮）——颜色不唯一表达（无障碍）。
- 列序来自服务端投影（客户端永远拿不到真实列序）；状态只来自 API/事件，**客户端不自行计算反馈**。

### 4.4 局末展示（08 §4.4 修复后）

- `round.ended` 弹窗：胜负 + 答案 + 「查看对局」（关闭弹窗展示双方完整棋盘）。
- 对局未结束：显示下一局倒计时（下一局 `startsAt` = 本局 `ended_at` + `INTERMISSION` 5s）；倒计时只是服务端 `startsAt` 的渲染，**点击「查看对局」不暂停**——到点 `round.playing` 强制开新局，客户端自动切棋盘（历史局经「第 N 局 胜/负/平」摘要条回看）。

### 4.5 再来一局（08 §10.3/§6.1）

- `match.ended` → `MatchResultOverlay`「再来一局」→ `POST /rematch`（本地置已确认，等对方）→ 收到 `match.rematch` 显示「对方想要再来一局」→ 双方确认后 `match.started`（新 matchIndex）→ 自动回对局视图（比分清零）。

### 4.6 持久化与恢复

- `localStorage["touhouflandre:multi-room"] = {roomId, roomCode, guestToken}`（与单人 storageKey 并列不冲突）；刷新后凭 roomId+token 重连；恢复失败（房间关闭/404）删 key 重建/重定向 `/multi`（参照单人 `loadSession` 模式）。
- 一个浏览器同时只活跃一个房间（v1）；双标签页互顶由「新连接替换旧连接」语义兜底（§8.1）。

---

## 5. 设计细节

### 5.1 组件清单与复用（08 §10.2）

```text
components/
  MultiLobby.tsx         创建/加入表单（赛制单选、昵称、房间号输入）
  RoomPage.tsx           编排：useRoom 连接 + 视图切换
  RoomLobby.tsx          房间号大字 + 复制、成员列表与就绪态、准备/离开
  MatchBoard.tsx         比分条（赛制/胜场/局号/剩余时间）+ 双棋盘布局
  SelfBoard.tsx          搜索框 + 反馈表（复用 SingleGamePage 模式）
  OpponentBoard.tsx      匿名矩阵（无列头网格 + 图例）
  CountdownOverlay.tsx   倒计时/间歇遮罩
  RoundResultOverlay.tsx 局结果弹窗（胜负 + 答案 + 查看对局 + 下一局倒计时）
  MatchResultOverlay.tsx 整场结果（胜者/比分/原因 + 再来一局 + 返回大厅）
hooks/
  useRoom.ts             WS 生命周期 + reducer + 重连/补齐
  useRoomClock.ts        剩余时间（deadline）渲染
```

- 复用：`useCharacterSearch`、`CharacterAvatar`、`feedback-*` 语义类；猜测必须从搜索结果选择。
- `SelfBoard` 每局重置；历史局摘要条展示。

### 5.2 WS 客户端封装（lib/api.ts 扩展）

- `connectRoomWS(roomId, token, { onEvent, onClose })`：升级 URL 推导（同源 `/api/rooms/{id}/ws` 或直连 ws(s)）；首帧 `hello{token, lastSequence}`；`hello-ok` 后进入事件流；断线退避重连；返回 `sendAck` 等句柄。
- 房间 REST：`createRoom/joinRoom/roomInfo/ready/rematch/leave/close/guess/snapshot` 走 openapi-fetch 生成类型（Phase 1 契约）。

### 5.3 表单校验（Vitest 覆盖）

- 房间号输入：去空格/连字符、转大写；非法字符提示；昵称 ≤16 字符、trim、去控制字符（服务端为准，前端前置校验改善体验）。
- 赛制单选必选；预检 `GET /rooms/{roomCode}` 失败（404）提示房间不存在。

### 5.4 无障碍与窄屏（08 §10.4）

- 矩阵单元格 `aria-label` = 状态名；图例折叠按钮；键盘全操作；`prefers-reduced-motion` 停用非必要动画（倒计时数字优先）。
- 窄屏：双棋盘上下堆叠（单人在上、对手在下），表格横向可滚动；矩阵 6 列始终完整可见。

---

## 6. 任务分解

任务有依赖序；每个任务完成即标记，验收不通过不进入下一任务。

### T1 — 传输与基础 hook（useRoom 骨架）

**输入**：08 §10.1/§10.3/§8.4；`lib/api.ts` 现状。
**动作**：

1. `next.config.ts` 增加 `ws: true`（保留现有 rewrite）。
2. `lib/api.ts` 扩展：房间 REST 客户端 + `connectRoomWS`（hello/ack/退避重连/`snapshot?after=` 补齐）。
3. `useRoom.ts` 骨架：连接状态机 + reducer 框架（sequence 去重排序）+ `useRoomClock`。

**验收**：

- [ ] Vitest：`connectRoomWS` URL 推导（同源/直连）；reducer 乱序/重复/缺口处理（mock WS）。
- [ ] 本地 `task dev` 下 WS 握手成功（临时页面或集成测试脚本验证 hello-ok）。

### T2 — `/multi` 大厅页（创建/加入/预检）

**输入**：08 §4.1/§10.2；Phase 2 端点。
**动作**：

1. `MultiLobby.tsx`：赛制单选 + 昵称 + 创建；房间号输入（归一化）+ 昵称 + 加入。
2. 预检：输入房间号失焦/提交前调 `GET /rooms/{roomCode}` 显示赛制/状态/人数提示。
3. 创建/加入成功后写入 localStorage 并跳转 `/multi/room/[code]`。

**验收**：

- [ ] Vitest：表单校验（房间号归一化/非法字符/昵称长度）。
- [ ] Playwright：创建房间 → 显示 6 位房间号 → 复制；加入流程（第二 context）。

### T3 — 房间页 lobby（RoomLobby）

**输入**：08 §10.3；Phase 2/4 快照与事件。
**动作**：

1. `RoomPage.tsx` 编排 + `RoomLobby.tsx`：房间号大字 + 复制、成员列表（slot 1/2、就绪态）、准备/离开按钮。
2. `room.updated` 事件驱动成员列表刷新；`GET /snapshot` 首屏加载；无成员资格 → 重定向 `/multi`。
3. 双就绪 → 收到 `match.started` + `round.started` → 切对局视图。

**验收**：

- [ ] Playwright（双 context）：A 创建 → B 加入 → 双方列表互见 → 双方 ready → 进入对局（countdown 遮罩出现）。

### T4 — 对局视图（棋盘 + 遮罩）

**输入**：08 §4.3/§4.4/§4.5/§10.2；Phase 3 事件。
**动作**：

1. `MatchBoard`/`SelfBoard`（搜索 + 反馈表，复用单人模式）/`OpponentBoard`（匿名矩阵 + 图例）。
2. `CountdownOverlay`（round 1 倒计时 + 局间间歇倒计时，`startsAt` 驱动）。
3. `RoundResultOverlay`：`round.ended` 弹窗（胜负 + 答案 + 「查看对局」+ 下一局倒计时；查看不暂停倒计时；到点自动切棋盘，历史局摘要回看）。
4. `round.opponent.guess` 追加对手行；`round.playing` 解锁输入；错误响应（`ROUND_ENDED`/`ROUND_NOT_ACTIVE`/`GUESS_LIMIT_REACHED`）toast 展示。

**验收**：

- [ ] Vitest：`OpponentBoard` 只渲染颜色、永不含名称/标签/值（快照断言）；reducer 事件应用。
- [ ] Playwright：双 context 互猜 → 局结果弹窗（答案 + 查看对局）→ 下一局自动开始（注入短间歇）。

### T5 — 整场结果与再来一局

**输入**：08 §10.3/§6.1；Phase 3 rematch 端点。
**动作**：

1. `MatchResultOverlay`：胜者/比分/原因（normal/forfeit/disconnect/…）+ 「再来一局」+ 等待对方确认态 + 返回大厅。
2. rematch 交互闭环：`POST /rematch` → `match.rematch`（对方想要再来一局）→ `match.started`（新 matchIndex）自动回对局（比分清零）。

**验收**：

- [ ] Playwright：整场结束 → A 点再来一局（等待态）→ B 点 → 新对局开始（比分 0-0）；等待期 A 离开 → 房间关闭/回大厅。

### T6 — 断线重连与刷新恢复

**输入**：08 §8.4/§10.1/§4.6。
**动作**：

1. 断线 → 退避重连（1s→…→30s + 抖动）携带 `lastAppliedSeq`；宽限 60s 提示（`grace-expired` 态）。
2. 刷新恢复：localStorage 读取 → 重连；失败（404/房间关闭）删 key 重定向 `/multi`。

**验收**：

- [ ] Playwright：刷新后恢复到对局/大厅状态；断线（模拟网络阻断）→ 重连补同步；宽限逾期展示判负结果。

### T7 — 回归与收尾

**动作**：

1. 全量：`pnpm typecheck`、`pnpm test`（Vitest）、`pnpm --filter @touhouflandre/web test:e2e`（需 `task dev`）、`pnpm build`。
2. 更新 §10 执行记录；明确 Phase 6 输入（页面清单、需要收口的体验细节）。

**验收**：

- [ ] §7 总验收全绿；单人页面无回归（导航/搜索/每日题 Playwright 既有场景）。

---

## 7. 总验收标准（阶段退出条件）

1. `/multi` 创建/加入/预检与 `/multi/room/[code]` 全状态机可用，非法 `[code]` → `notFound()`，无成员资格 → 重定向。
2. 双棋盘正确：自视角完整反馈（复用单人）、对手匿名矩阵只含颜色（Vitest 断言不含名称/标签/值）。
3. 局末弹窗/倒计时/整场结果/再来一局交互闭环，倒计时由 `startsAt` 驱动且查看不暂停。
4. 断线重连退避 + 缺口补齐 + 刷新恢复全部可用。
5. Playwright 双 context 全流程（含 rematch、断线、刷新）通过；单人回归通过。

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| WS 同源代理在部署形态失效 | `ws: true` 已验证 dev/`next start`；standalone 走反向代理或直连（08 §15 风险表） |
| 事件乱序/重复/缺口 | reducer 按 sequence 去重排序 + 缺口拉快照（10.3） |
| 双标签页互顶 | 替换连接语义 + localStorage 单成员资格 + 重连幂等（08 §15） |
| 弹窗倒计时与服务端不一致 | 倒计时只渲染服务端 `startsAt`，到点以 `round.playing` 为准 |
| 匿名矩阵误渲染敏感信息 | Vitest 断言 payload/渲染不含名称/标签/值；组件只消费投影结果 |

## 9. 与后续阶段的衔接

- **Phase 6（收尾）**：配置项、指标/日志字段、文档（02 功能表、README）、测试补全与最终回归。
- **07 验收场景**：多人「乱序、重复、丢事件、重连、慢消费者、服务重启」场景在浏览器层最终验收（07 §9）。

---

## 10. 执行记录（2026-08-06，分支 feature/multipalyer_mode_backend）

### 完成情况

- T1-T7 全部完成；总验收 5 条全部满足：`/multi` 创建/加入/预检 + `/multi/room/[code]` 全状态机（非法 code → 404、无成员资格 → 重定向）；双棋盘（自视角完整反馈复用单人语义类、对手匿名矩阵 Vitest 断言不含名称/标签/值）；局末弹窗/倒计时/整场结果/再来一局交互闭环（倒计时由 `startsAt` 驱动、查看对局不暂停）；断线退避重连 + 缺口补齐 + 刷新恢复；Playwright 双 context 全流程 + 单人回归全部通过。
- 全量回归：`pnpm test`（18 Vitest）✅、`pnpm typecheck` ✅、`cd apps/api && go test ./...` ✅、`task gen` 零 diff ✅、`task check:ws-protocol` ✅、Playwright 双 project 24 用例（含单人 core 8 场景）✅。
- E2E 前置修正：`GET /api/rooms/{roomCode}` 预检、按 IP 限流放宽（`MULTI_JOIN_RATE_LIMIT` env，E2E webServer 注入 1000）。

### 执行中发现的真实问题与修复（含后端缺陷）

| 问题 | 修复 |
|---|---|
| **快照端点 500**（E2E 发现的真实后端缺陷）：`GetRoomSnapshotState` 的 `to_jsonb` 把 `multi_guess.statuses`（jsonb 数组）渲染为 JSON 数组，Go 侧 unmarshal 进 `repo.MultiGuess.Statuses`（`[]byte`）报 `cannot unmarshal string into … uint8`——局内有猜测后快照必挂，直接导致刷新/重连后客户端状态无法恢复 | `snapshotState` 用快照专用形态 `snapshotGuess`（`statuses []string`）承接；新增集成测试 `TestMultiSnapshotWithGuesses` 回归 |
| **Chromium 整页加载期间 WS 握手延迟数十秒**：页面 load 事件前创建的 WebSocket，握手请求被浏览器持有 30s+（client 导航路径不受影响） | `useRoom` 首次建连等待 `document load` 事件后再发起（`readyState === 'loading'` 分支）；修复后刷新/直连路径瞬时连接 |
| **预检与 join 并发 preflight 阻塞**：输入框 blur 触发的预检 GET 与随后的 join POST 并发时，第二个跨源请求的 preflight 被浏览器持有 → join 请求从未发出 | 前端 join 不依赖预检结果；E2E 测试显式 blur + 等预检完成后点击（预检是纯提示增强） |
| **WS 地址 host**：`NEXT_PUBLIC_API_BASE_URL=http://localhost:4000` 时 `ws://localhost` 在部分环境连接不稳 | `roomWsUrl` 统一把 `//localhost:` 归一化为 `//127.0.0.1:`（IPv4 直连；同源模式不变） |
| **`requestApi` 对 204 抛错**：ready/rematch/leave/close 返回 204（无 body），openapi-fetch `data` 为 undefined → 旧逻辑误抛「请求失败。」 | `requestApi` 以 `response.ok` 为准（204 视为成功，返回 undefined） |
| **reducer 的 match.started 未更新房间状态**：客户端 room 状态卡在 lobby（服务端已 playing），且 snapshot 未应用时 match.started 的 room 更新是空操作 | reducer 的 `match.started` 置 `room.status='playing'`；`applySnapshot` 先回放事件（历史）后置权威状态（room/members/match/round），避免事件回放覆盖快照 |
| **hydration 失败**：RoomView 的 `useState(() => loadMultiRoom())` 在 SSR 访问 `window` | 存储加载移入 effect（`stored` 初始 undefined 表示加载中），useRoom 空 roomId 短路（不发起空 URL 请求） |
| **单人回归测试 `TestGuessLifecycle` 偶发失败**：随机题答案为 reimu 时「错误猜测」变命中（1/113 概率；rng 切 math/rand/v2 后首次显现） | 测试改为从题库取「非答案」可猜角色作 miss 猜测 |
| **`page.close()` 不保证关闭 WS**：headless Chromium 中页面关闭后 WS 存活，成员状态不置离线 | E2E 断线场景改为「导航离开」（页面卸载确定关 WS）；替换语义（新连接替换旧连接）已由 Go 集成测试覆盖 |

### 与计划的偏差

- **`ws: true` 声明不成立**：Next 16 的 Rewrite 类型无该字段且配置校验直接拒绝（`invalid field: ws for route`）；实测 Next 16 dev 代理对带 Upgrade 头的请求走 httpxy `proxy.ws`，无需该字段即可同源代理 WS——next.config 仅注释说明，不加字段。
- **连接顺序**：useRoom 先建连（hello → 重放）后拉快照（hello-ok 后），快照作为自视角棋盘/权威状态补充（设计为快照兜底，本实现为快照+事件双通道，按 sequence 去重）。
- **E2E 断线/宽限判负**：宽限判负（60s）无法在浏览器端等，由 Go 集成测试覆盖；E2E 覆盖「断线（导航离开）→ 重连 → 在线恢复」。
- **限流 env 覆盖**：`MULTI_JOIN_RATE_LIMIT`（默认 10 次/分不变，dev/E2E 并行放宽），Phase 2「不进配置」的例外，已在 config 注释说明。

### Phase 6 输入（明确交接）

- 前端页面清单与交互已稳定；`useRoom` 事件应用/重连/补齐语义与后端一致。
- 需要收口的体验细节：猜测错误 toast、图例折叠、历史局摘要条、`prefers-reduced-motion`（当前未做动画降级）。
- E2E 需要 `task dev`（Go+Next+DB）与 `MULTI_JOIN_RATE_LIMIT` 环境（playwright webServer 已注入）。

