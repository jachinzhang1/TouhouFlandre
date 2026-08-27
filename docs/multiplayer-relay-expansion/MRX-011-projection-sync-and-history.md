# MRX-011：完成多 encounter 投影、同步与按需历史 API

**类型**：功能/协议/安全 Issue  
**优先级**：P0  
**状态**：已完成
**依赖**：MRX-009  
**建议标签**：`type:feature` `area:api` `area:contracts` `area:websocket` `area:security`

**决策依据**：[投影、能力与页面状态](./decisions.md#16-投影能力与页面状态)、[历史与负载边界](./decisions.md#17-历史与负载边界)、[契约与 WS v3](./decisions.md#15-契约与-ws-v3)

## 要解决的问题

玩法后端完成后，客户端仍需要一套不会泄露答案、不会因并发事件错序、也不会把所有历史棋盘塞进 snapshot 的 relay 读模型。当前 relay projection 只返回单一 shared board，当前 round archive 也不适合长期累积多张完整棋盘；race 匿名矩阵 projector 必须保持独立，不能为了复用而放宽可见性。

## 要做到什么程度

- 以 capability 而非单纯 role 投影 paired、encounter-ended、bye、near-death、eliminated、left 和 spectator。
- relay 所有查看者获得当前 stage 全部 encounter 的完整 turn/标签；只有 viewer 自己的活动 encounter 可能拥有动作 capability。
- 进行中 encounter 永不投影 answer；terminal encounter 返回 answer 和 outcome；同一 relay projector 供 realtime、replay、snapshot 和 history 复用，但不供 race 匿名矩阵复用。
- snapshot 返回 current stage、encounter summaries/details、standings、participant states、紧凑 stage summaries 和 sequence 水位，不嵌入无界完整历史。
- 增加分页 stage history 与终态 encounter detail API，使用不透明 cursor/稳定索引并在每次请求重新鉴权。
- WS v3 共享全房间事件信封和连续 sequence；`relay.encounter.*` payload 由 relay codec/projector 拥有，客户端可从任意断点 replay，缺口仍由 snapshot 补齐。
- 控制单事件/快照大小，历史查询按需水合角色与标签，避免 N×stage 全量 fan-out。

## 属于本 Issue

- relay API/WS/snapshot/history projector、mode fragment DTO、授权、cursor/分页和 generated types；core 只组合信封和 snapshot shell。
- `relay.encounter.*`、`relay.stage.*` 事件的观察者投影、cursor frame、replay 和 reconnect tests。
- answer/token/跨房间 ID 泄漏测试、payload size 与查询数量基线。
- 供 Web 使用的 selector/domain reducer 基础类型，但不实现最终布局。

## 不属于本 Issue

- 不改变 pairing、turn、scoring 或 lifecycle 结果。
- 不将 relay 套用 race 匿名矩阵；完整标签是冻结需求。
- 不让 race projector 查询 relay stage/encounter，也不把 relay viewer capability 塞入全局 participant role。
- 不把聊天并入 game sequence，也不修改 chat channel。
- 不实现页面分页、提示和排行榜组件。

## 验收标准

- player、bye、eliminated 和 spectator 均能看到所有 relay 棋盘完整标签；任何人都看不到未结束 encounter 的答案字段。
- 非 encounter 成员即使伪造 encounterId 也只能读取授权视图，不能获得动作 capability 或提交动作。
- 一张棋盘的 turn 只更新该 encounter；其他棋盘的 React/domain state 不被清空或覆盖。
- 并发 encounter 事件拥有唯一递增 room sequence；断线、乱序、重复、真正缺口和 snapshot 对齐测试通过。
- 新连接只靠 snapshot + replay 可恢复当前 turn、各棋盘终态、bye、积分、濒死/淘汰与 stage barrier 等待状态。
- 100 个历史 stage fixture 下 snapshot 大小不随完整 turn 总量线性增长；历史分页无重复/遗漏，terminal answer 权限正确。
- v2 客户端被明确拒绝并获得刷新原因；v3 game-only/chat-capable 连接均保持原同步屏障。
- race snapshot/WS fixture 在启用 relay projector 后字节语义不变；只注册 race projector 时无需构造 relay history repository。

## 可能涉及的代码

共享 snapshot/event shell、relay mode projector/history reader、transport snapshot/WS/history adapter、hub 信封出口、`contracts/openapi/`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts`、Web mode-fragment reducer 与同步测试。

## 实施与验收记录（2026-08-24）

- 已交付 relay projection：snapshot 返回当前 stage 的全部 encounter summaries/details、bye、settlement、standings 与紧凑历史摘要；所有 relay viewer 可见完整标签；进行中 encounter 不返回 answer，terminal encounter 返回 answer、outcome、winner 与完整 turn rows。
- 已交付 capability projection：`canGuess`、`canPass`、`canForfeit` 仅在 viewer 是该 encounter 当前 turn 且仍为 active encounter player 时为 true；非成员、spectator、bye、ended、eliminated、left 与跨房间访问均被限制。
- 已交付统一事件投影：`relay.stage.*`、`relay.encounter.*` 由同一 relay projector 供实时推送、replay 与 snapshot 使用；active event 会丢弃意外携带的 answer，terminal event 保留 answer/outcome。初始 `after=0` snapshot 仅保留 stage/match 终态事件，避免完整 turn 历史随 snapshot 无界增长；`after>0` 仍提供事件增量。
- 已交付 history API：新增按 match 的 ended stage 分页，`limit` 限制为 1..20，cursor 为绑定 matchIndex 与稳定 stageIndex 的 base64url 不透明值；每次请求重新鉴权并校验 room/match，history encounter 仅返回终态详情和答案。
- 已交付 Web 基础投影：`packages/shared/src/multi.ts` 增加 relay fragment/view/capability 类型，Web 新增 relay domain reducer；按 encounter 更新，使用 room sequence 去重并忽略迟到事件，不清空其他棋盘。最终页面分页、提示、排行榜和本地统计仍属于 MRX-012。
- 主要变更面：`apps/api/internal/handler/relay_snapshot.go`、`apps/api/internal/handler/relay_stage.go`、`apps/api/internal/handler/snapshot.go`、`apps/api/internal/multi/projection.go`、relay SQL queries/generated repo、OpenAPI source/generated types、`packages/shared/src/multi.ts`、`apps/web/src/domain/relayProjection.ts` 及对应 API/WS/安全/跨 encounter 测试。
- 迁移与回滚：本 Issue 没有新增数据库 migration；仅增加可回读的查询、投影和 API 契约。生成物由 OpenAPI、sqlc 和 Web API generator 重新生成；回滚应用时保留现有 relay 表和历史数据，不执行破坏性数据操作。
- 验证通过：
  - `cd apps/api && go test ./internal/multi/... ./internal/handler -count=1`
  - `cd apps/api && go test ./internal/server -run "TestRelayModeSharedTurns|TestMRX011" -count=1`
  - `cd apps/api && go test ./...`
  - `pnpm --filter @touhouflandre/shared test`
  - `pnpm --filter @touhouflandre/web test`
  - `pnpm --filter @touhouflandre/web typecheck`
  - `pnpm check:ws-protocol`
  - `pnpm check:openapi-refs`
  - `pnpm lint:openapi`
  - `pnpm check:multiplayer-boundaries`
  - `task gen:openapi`
  - `/home/jachin/go/bin/sqlc generate`
  - `task gen:web`
  - generated 目录二次生成哈希一致
  - `git diff --check`
- 回归兼容：完整 Go 测试中发现的旧 `TestRelayModeSharedTurns` 事件列表断言已按 MRX-011 的初始 snapshot 负载边界调整为从 `currentStage.encounterDetails` 读取终态棋盘；WS 连续 sequence 断言仍保持不变。
- 偏差与后续：未实现最终多棋盘页面、历史翻页交互、bye/淘汰/结算提示、排行榜组件与 stats v1-v6 接入，按原范围交由 MRX-012；未修改 race 匿名矩阵、chat sequence 或 pairing/turn/scoring/lifecycle 规则。
