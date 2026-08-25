# MRX-009：收口并行接力的离场、恢复与再来一局

**类型**：可靠性/生命周期 Issue  
**优先级**：P0  
**状态**：已完成
**依赖**：MRX-007、MRX-008  
**建议标签**：`type:feature` `area:api` `area:multi` `area:reliability`

**决策依据**：[离场、断线与异常终态](./decisions.md#11-离场断线与异常终态)、[再来一局](./decisions.md#12-再来一局)、[事务与锁序](./decisions.md#14-事务与锁序)

## 要解决的问题

多个 encounter 并行后，离场、断线超时、服务重启和 rematch 都可能同时影响一张棋盘、stage 屏障和最终排名。沿用“对手就是另一个 room slot”的处理会误结算其他 pair，遍历 sweeper 结果还可能制造非确定胜者。

## 要做到什么程度

- 短暂断线只更新 member connection state，计时器继续；宽限期内恢复相同 encounter/turn。
- 主动 leave 或宽限逾期在锁定所属 encounter 后处理：未结束则该玩家负、对手胜；双方同时永久离场则 draw。
- `left` 从后续配对移除。relay `fixed_points` 继续到 planned stages；奇数 active 使用 bye，不足 2 人提前结束。relay `elimination` 按当前 stage 记录存留终止但不触发濒死保护。
- 批量处理同一 `now` 到期成员，结果不能依赖数据库遍历顺序。
- relay `RecoveryDriver` 扫描活动 encounter 和未完成 settlement；能恢复则继续，不能恢复则返回明确 `server_restart` 领域终态，由共享事件出口发布。
- rematch 仍要求原 roster 完整、connected 且全员确认；淘汰者可确认，left 成员阻止；新 match 全量重置积分、生命状态、pairing 和答案。
- finished retention、closed cleanup、chat role 和 spectator capability 沿用现有生命周期。
- core sweeper 只调用已注册模式的 recovery capability，不读取 relay stage/turn 字段；race recovery 保持原实现。

## 属于本 Issue

- leave/disconnect grace/sweeper/restart/rematch 的领域与事务实现。
- 异常 match end reason、事件、snapshot 和错误码。
- 同时离场、离场与猜中、离场与 turn timeout、重启 settlement 的并发/恢复测试。
- 2 人 relay 和 race 现有离场语义的兼容回归。

## 不属于本 Issue

- 不设计断线暂停全房间或投票暂停。
- 不允许替补、重入 roster 或 finished 后重新认领 seat。
- 不因异常离场改变正常计分常量。
- 不实现 Web 提示和历史加载。

## 验收标准

- 某 pair 的玩家离场只终止该 encounter，其他 encounter 继续；最后完成时 stage 仍恰好结算一次。
- 同一 pair 双方同时过期得到 draw，不因 sweeper 顺序给任一方胜利。
- points 模式离场后可用 3/5/7 active roster 完成余下 stages，bye 不加分；只剩一人时明确提前结束。
- elimination 模式离场者的 `survivedStages` 与当前 stage 一致，且不消耗/授予 near-death。
- 重启后 pairing、answer、turn、积分和事件 sequence 不重建、不重复；无法恢复时客户端收到明确终态。
- 淘汰玩家可以 rematch，left 玩家使 rematch 稳定返回 `REMATCH_NOT_AVAILABLE`；新 match 状态完全重置。
- race 与双人 relay 的 leave/disconnect/rematch 基线无回归。
- registry 未注册 relay recovery 时不会扫描 relay 表；未知 rule set version 不得用当前默认规则恢复。

## 可能涉及的代码

共享 room/member lifecycle 与 mode recovery 调用点、relay recovery/forfeit/coordinator、relay SQL queries、mode-owned OpenAPI/WS payload、server recovery/concurrency tests；race recovery 仅做回归或必要的 adapter 调整。

## 实施与验收记录（2026-08-24）

- 已交付 relay-owned lifecycle：主动离场和断线宽限逾期会批量锁定同一房间的 departed roster，单人离场只终止所属 encounter，双方同时永久离场写 draw；fixed_points 的 left roster 被后续配对移除，3/5/7 active 继续并复用 bye，不足 2 人以 `insufficient_active_players` 结束；elimination 的 left 记录当前 stage、保留 near-death 状态且不产生淘汰 transition，排名的 `survivedStages` 使用离场 stage。
- 已交付恢复边界：core restart/sweeper 只通过 registry capability 进入模式；relay recovery 在 adapter 内扫描 active encounter 和 settlement candidate。可恢复时不重抽 pairing/answer/turn，不重复 settlement/event；未知 ruleset version 或缺失/未知 ruleset 在 relay adapter 内 fail-closed 为 `server_restart` 终态，不回落到当前默认规则。
- 已交付 rematch：rematch 以最新 finished match 的冻结 roster 为锚点；淘汰者可确认，left/missing/disconnected roster 成员稳定返回 `REMATCH_NOT_AVAILABLE`；新 match 重新创建 roster state、relay state、stage、encounter、answer 和 turn deadline，历史 match 保持只读。
- 主要变更面：`apps/api/internal/multi/relay/*` 规则与 stage coordinator、`apps/api/internal/multi/relay/adapter/*` 持久化 adapter、`apps/api/internal/multi/sweeper.go`、`apps/api/internal/multi/restart.go`、`apps/api/internal/handler/matches.go`、SQL source/generated repo、OpenAPI/WS reason enum、Web match result/stat transfer reason 列表，以及迁移 `0018_relay_lifecycle_recovery.sql`。
- 迁移与回滚：`0018` 为 expand-only/backward-readable 迁移，只放宽 relay encounter outcome 与 terminal winner check 以允许 `server_restart`；旧 binary 仍可读取既有终态，发布回滚仍要求新 relay 房间按原发布闸门排空。
- 验证通过：
  - `task gen:openapi`
  - `cd apps/api && go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate`
  - `task gen:web`
  - `cd apps/api && go test ./internal/multi/relay/... -count=1`
  - `cd apps/api && go test ./internal/multi/... -count=1`
  - `cd apps/api && go test ./internal/server -run "MRX006|MRX007|MRX008|MRX009|MultiRematch|MultiForfeit|MultiDisconnectGrace|MultiRestartTermination|MultiRace" -count=1`
  - `cd apps/api && go test ./internal/server -count=1`
  - `cd apps/api && go test ./... -count=1`
  - `pnpm check:ws-protocol`
  - `pnpm lint:openapi`
  - `pnpm check:openapi-refs`
  - `pnpm check:multiplayer-boundaries`
  - `pnpm --filter @touhouflandre/web typecheck`
  - `pnpm --filter @touhouflandre/web test`
  - `git diff --check`
- 偏差与后续：本 Issue 未实现 Web 提示、历史加载、替补/重入 roster 或房间暂停，按原非范围延后；`task gen` 在当前 WSL PATH 中找不到全局 `sqlc`，本次按仓库既有可复现方式使用 pinned `go run ...sqlc@v1.31.1 generate`。
