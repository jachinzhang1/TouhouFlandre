# Phase 6 开发计划 — 收尾（配置、可观测性、文档与回归）

> 依据：[`08_multiplayer_mode_design.md`](../08_multiplayer_mode_design.md) §13 M6、§11（配置与可观测性）、§12（测试计划）、§14（决策记录）、§15（风险与缓解）；[`07_productization_plan.md`](../07_productization_plan.md) §8（发布、可靠性与可观测性）、§9（验收场景）
> 状态：📋 待执行（执行记录见 §10）
> 影响范围：`apps/api/internal/config/`、`apps/api/internal/`（日志/指标埋点）、`apps/api/cmd/server/`（排空审计）、`docs/`（02 功能表、README、07/08 交叉引用）、CI、测试补全
> 原则：**不留半截配置，不留未声明的指标**；文档与实现一一对应（07 §3：没有基线和目标值，不宣称性能/可靠性提升）。

---

## 1. 目标与边界

### 目标

1. 配置项收口（08 §11.1）：`MULTI_LOBBY_TTL`、`MULTI_DISCONNECT_GRACE`、`MULTI_ROUND_SECONDS`、`MULTI_ROUND_COUNTDOWN`、`MULTI_INTERMISSION`、`MULTI_MAX_ROUNDS_FACTOR`、`MULTI_FINISHED_RETENTION`、`MULTI_EVENT_RETENTION`、`MULTI_WS_READ_LIMIT`、`MULTI_WS_SEND_QUEUE`（无 `MULTI_CONN_PER_MEMBER`——单连接语义固定）。全部接入 `internal/config`，默认值与 08 §4.7 一致。
2. 可观测性收口（08 §11.2）：结构化日志字段（`roomId`/`memberId`/`roundIndex`/`sequence`/`eventType`；token 永不入日志）、Prometheus 语义指标（`rooms{status}`、`members{status}`、`active_rounds`、`ws_connections`、`events_total{type}`、`guess_latency{p50,p95}`、`reconnects_total`、`forfeits_total{reason}`）、优雅排空审计。
3. 文档收口：`docs/02_website_features.md` 功能表补多人项、README 命令（多人相关 dev/测试）、07 §7 与 08 交叉引用修订、`docs/develop_plan/multiplayer_mode/` 各 phase 执行记录补全。
4. 测试补全与最终回归：08 §12 测试矩阵全绿、单人六端点与黄金用例不回归、`task gen` 生成物零 diff、`pnpm build`/`go vet` 通过。
5. 风险表复核（08 §15）：逐项核对缓解措施已落地，未落地项显式标注为后续触发项。

### 非目标（本阶段明确不做）

- 不引入多实例横向扩展/跨实例广播/`LISTEN/NOTIFY`/`FOR UPDATE SKIP LOCKED`（08 §9.4 延后项，由压测触发）。
- 不做账号体系、排行榜、回放、观战（产品边界，08 §1.2）。
- 不宣称性能/可靠性指标达标（07 §3：无基线不宣称）。

---

## 2. 前置条件（开工前必须完成）

- [ ] Phase 1–5 交付物全部验收通过（契约、数据、房间大厅、对局引擎、实时通道、前端）。
- [ ] 单人路径回归基线记录在案（06 迁移总结或 CI 快照）。

---

## 3. 交付物

| 交付物 | 位置 | 说明 |
|---|---|---|
| 配置 | `apps/api/internal/config/config.go` | 08 §11.1 全部项 + 默认值 + env 绑定 |
| 日志/指标埋点 | `apps/api/internal/`（handler/multi/hub） | 结构化字段、Prometheus 语义计数 |
| 排空审计 | `apps/api/cmd/server/main.go` | 终止对局/关 WS/停 sweeper 顺序日志 |
| 文档 | `docs/02_website_features.md`、`README.md`、`docs/07_productization_plan.md` | 功能表、命令、交叉引用 |
| 测试补全 | `apps/api/internal/`、`apps/web/src/` | 08 §12 矩阵补漏 + 回归 |
| 执行记录 | `docs/develop_plan/multiplayer_mode/phaseNN.md` §10 | 各阶段收尾时补全 |

---

## 4. 关键设计要点（摘自 08，修复后版本）

### 4.1 配置（08 §11.1）

| 配置 | 默认 | 用途（对应 08 §4.7） |
|---|---|---|
| `MULTI_LOBBY_TTL` | 30min | 大厅无人加入过期 |
| `MULTI_DISCONNECT_GRACE` | 60s | 断线宽限 |
| `MULTI_ROUND_SECONDS` | 900s | 单局时限（超时平局） |
| `MULTI_ROUND_COUNTDOWN` | 3s | 首局倒计时（仅 round 1） |
| `MULTI_INTERMISSION` | 5s | 局间间歇（下一局 `startsAt` = 上局 `ended_at` + 此值，兼作倒计时） |
| `MULTI_MAX_ROUNDS_FACTOR` | 3 | 安全上限 = `3 × N` |
| `MULTI_FINISHED_RETENTION` | 30min | 对局结束展示期 |
| `MULTI_EVENT_RETENTION` | 24h | closed 到删除的保留时长（08 §4.7/§9.1 删除策略） |
| `MULTI_WS_READ_LIMIT` | 4096 | 客户端消息读限 |
| `MULTI_WS_SEND_QUEUE` | 64 | 发送队列长度 |

- 无 `MULTI_CONN_PER_MEMBER`：每成员单连接（替换语义）为固定规则（08 §8.1/§8.5）。
- 集成测试用短值注入验证 sweeper 时序（Phase 2/3 已用此法，收尾统一默认值配置文档）。

### 4.2 可观测性（08 §11.2）

- 日志：结构化字段统一 `roomId`/`memberId`/`roundIndex`/`sequence`/`eventType`；**token 永不入日志**（07 §5.3——错误路径尤其要检查 `guest:{token}` 不被打印）。
- 指标（Prometheus 语义，Stage 5 正式落地，本阶段埋点 + 暴露端点可开关）：
  - `rooms{status}`、`members{status}`：状态直方（sweeper/事务后更新，或采集时聚合，选实现最简者）。
  - `active_rounds`、`ws_connections`：hub 注册表实时值。
  - `events_total{type}`：`InsertRoomEvent` 后计数。
  - `guess_latency{p50,p95}`：猜测端点耗时直方（分位数）。
  - `reconnects_total`、`forfeits_total{reason}`：重连成功/弃赛原因计数。
- 排空审计：SIGTERM 日志记录「终止 N 场对局 → 关闭 M 连接(1012) → 停 sweeper → shutdown」各步骤耗时。

### 4.3 文档与交叉引用

- `02_website_features.md`：功能表补「多人房间（创建/加入/赛制/匿名矩阵/再来一局）」条目，标注游客身份边界（无排行/无云存档）。
- `README.md`：多人相关命令说明（无新增 task 则注明沿用 `task dev`/`task test:e2e`）。
- `07_productization_plan.md` §7：如与落地有出入修订（例如公开预检端点、`room.closed reason` 枚举扩展）。
- `08` §13 里程碑状态勾选 + 各 phase §10 执行记录。

### 4.4 测试矩阵补漏（08 §12 对照）

| 层 | 补漏重点 |
|---|---|
| Go 单元 | 配置默认值、投影黄金用例回归（若 Phase 4 已覆盖则仅回归） |
| Go 集成 | 全矩阵回归 + 重启/慢消费者/竞速等高压用例按需重跑 |
| Vitest | `useRoom` reducer、`OpponentBoard` 安全断言回归 |
| Playwright | 双人全流程 + 断线/刷新回归 |
| 回归 | 单人六端点 + 黄金用例 + `task gen` 零 diff |

---

## 5. 设计细节

### 5.1 配置接线

- `internal/config` 沿用现有加载模式（env → 默认值）；新增 `Multi` 子结构，`cmd/server` 与 sweeper/hub 注入。
- 常量语义：`MULTI_EVENT_RETENTION` 默认值需定稿（建议 24h，覆盖「成员展示期后仍可能回看结果」的窗口——`FINISHED_RETENTION` 是 finished 展示期，`MULTI_EVENT_RETENTION` 是 closed 到删除；两个值不冲突）。

### 5.2 指标暴露

- 若仓库已有 prometheus 客户端依赖则直接接入 `/metrics`（受保护或内网）；否则本阶段只做进程内计数 + 结构化日志兜底，正式端点由 Stage 5 决定（07 §8.3 不提前建设）。

### 5.3 文档清单核对

- [ ] `02_website_features.md` 功能表更新。
- [ ] `README.md` 命令说明（多人测试依赖 `task dev`）。
- [ ] `07_productization_plan.md` §7/§9 与落地一致性修订。
- [ ] `08_multiplayer_mode_design.md` §13 里程碑勾选。
- [ ] 各 phase `§10` 执行记录（Phase 1–5 实施时同步补，本阶段复查完整）。

---

## 6. 任务分解

任务有依赖序；每个任务完成即标记，验收不通过不进入下一任务。

### T1 — 配置项收口

**动作**：

1. `internal/config` 新增全部 10 项（§4.1 表），默认值与 08 §4.7 一致。
2. 替换 Phase 2/3/4 实现中的硬编码常量；sweeper/hub 从注入配置读取。
3. 集成测试用短值验证配置生效（TTL/间歇/宽限）。

**验收**：

- [ ] `go test ./...` 全绿；配置项均有默认值文档注释；无硬编码残留（grep 复核 `ROUND_COUNTDOWN` 等常量来源）。

### T2 — 日志与指标埋点

**动作**：

1. 全 handler/hub/sweeper 日志补结构化字段（`roomId`/`memberId`/`roundIndex`/`sequence`/`eventType`）。
2. 指标计数接入（§4.2 清单）；`guess_latency` 直方在猜测端点。
3. token 日志审计：grep 确认无 `guest:` 打印路径；错误响应不泄漏 token。

**验收**：

- [ ] 集成/冒烟中日志含结构化字段；token 未出现（日志断言）。
- [ ] 指标计数随事件/连接/猜测正确变化（进程内读取验证）。

### T3 — 文档收口

**动作**：

1. `02_website_features.md`、`README.md` 更新（§5.3 清单）。
2. `07` §7 修订（如有出入）；`08` §13 勾选。
3. 各 phase §10 执行记录补全/复查。

**验收**：

- [ ] 文档与实现一致（功能表条目可在 UI 中对应找到；命令可执行）。

### T4 — 最终回归

**动作**：

1. 全量：`pnpm test`、`pnpm typecheck`、`pnpm build`、`cd apps/api && go vet ./... && go test ./...`、`task gen` + `check:generated`、`task lint:openapi`、`check:ws-protocol`。
2. Playwright 全场景（单人回归 + 多人双 context，需 `task dev`）。
3. 08 §15 风险表逐项复核：缓解措施落地情况标注。

**验收**：

- [ ] 所有 gate 全绿；生成物零 diff；风险表无「声称已缓解但未落地」项。

---

## 7. 总验收标准（阶段退出条件）

1. 全部配置项接线且默认值符合 08 §4.7；无硬编码常量残留。
2. 结构化日志 + 指标计数落地，token 零泄漏（日志断言）。
3. 文档（02/README/07/08/各 phase §10）与实现一致。
4. 08 §12 测试矩阵全绿；单人路径零回归；生成物零 diff。
5. 08 §15 风险表逐项复核完成，延后项（多实例等）显式标注触发条件。

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 配置默认值与实现漂移 | 配置项单一来源 + 集成测试短值注入 |
| 指标埋点过度（提前建设） | 只做 08 §11.2 清单项；正式端点由 Stage 5 触发（07 §8.3） |
| token 泄漏进日志 | 全路径审计 + 日志断言测试（07 §5.3） |
| 文档与实现不一致 | 功能表条目与 UI 对应核对；命令可执行验证 |
| 回归遗漏 | 08 §12 矩阵对照表 + CI gate 全量重跑 |

## 9. 与后续阶段/产品化的衔接

- **多实例扩展（延后）**：触发条件 = 单实例压测数据（07 §7.4）；届时 `LISTEN/NOTIFY`/`SKIP LOCKED` 设计已在 08 §9.4 预留。
- **账号体系（Stage 2）**：`guest:`/`jwt:` 令牌前缀共存已预留（08 §5.1）；本阶段不引入。
- **07 验收场景**：多人全场景在最终回归中逐项对照（乱序/重复/丢事件/重连/慢消费者/服务重启）。

---

## 10. 执行记录

> 状态：待执行。完成后按仓库惯例记录完成情况、真实问题与修复、与计划的偏差（参照 `migration_to_go/phase01.md` §10 格式）。
