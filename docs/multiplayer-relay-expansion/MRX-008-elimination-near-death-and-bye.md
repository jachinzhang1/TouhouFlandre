# MRX-008：实现多人接力淘汰、濒死、轮空与存留排名

**类型**：功能/规则 Issue  
**优先级**：P0  
**依赖**：MRX-006  
**状态**：已完成
**建议标签**：`type:feature` `area:api` `area:multi` `area:test`

**决策依据**：[淘汰计分与濒死](./decisions.md#9-淘汰计分与濒死)、[配对与轮空](./decisions.md#5-配对与轮空)、[淘汰排名](./decisions.md#10-淘汰排名)

## 要解决的问题

淘汰赛不是现有 race `placement` 的变体：它从 10 分开始、负分触发一次濒死保护、扣分随 stage 增长，并可能在一次结算后留下奇数玩家或同时淘汰所有人。需要 `(relay, elimination, 1)` 独立 policy 和 relay-owned 状态，不能复用 `RaceRules` 或把转换散落到 encounter、共享 core 或 Web。

## 要做到什么程度

- 实现 relay-owned `EliminationPolicy` 纯函数，输入 stage index、旧积分/生命状态和 outcome，输出积分、状态、淘汰 stage 与 match 终止。
- 初始 10 分、上限 10；胜 +1、负 `-n`、平各 `-floor(n/2)`、bye 0。
- 精确实现首次 `<=0` 钳制为 0 并把 relay `lifeState` 改为 `near_death`；公共参与状态仍为 active。near-death 不再加分，下一次真实负分后淘汰。
- 批量结算允许 0..N 人同时淘汰；结算后 active `<=1` 即结束，不创建空 stage。
- 新 stage active 为奇数时使用 MRX-005 bye 计划，bye 分数/状态不变且不能连续。
- 最终只按 `survivedStages` 排名，唯一 survivor 优先；积分不破同分。
- 不套用 BO 或任意安全轮数上限；正常终止只由 stage 结算后的存留人数决定。
- 所有变化以结构化 `scoreDelta/lifeTransition/eliminatedMemberIds/byeMemberId` 投影。

## 属于本 Issue

- 计分、濒死状态机、淘汰与终止纯函数。
- relay match/stage player 持久化、约束、stage settlement 与排名。
- round/stage event、snapshot standings 和服务端规则/并发测试。
- 多人降为 2 人后继续淘汰 policy 的测试。

## 不属于本 Issue

- 不改变 2 人 relay 的 BO 规则。
- 不修改 race placement 的初始分、淘汰算法、3N 上限、排名或公开 `scoringMode`。
- 不按积分或 seat 打破存留轮数并列。
- 不增加多次复活、回血道具、轮空加分或房主可调常量。
- 不处理主动离场/断线宽限；MRX-009 负责把异常转为统一 status/outcome。
- 不实现 UI 样式。

## 验收标准

- 普通玩家从正分结算到恰好 0 时变为 near-death 且公开分为 0；首次结算到负数时同样进入 near-death 并钳制为 0。
- near-death 获胜时仍为 0；平局在 `floor(n/2)=0` 时不淘汰；下一次负分后保留负分并淘汰。
- 胜者在 10 分时不会超过上限；同一 stage 多人状态在一个事务中一致可见。
- 3/5/7 名 active 时恰有一名 bye，连续至少 20 个确定性计划中无人连续 bye；bye 的积分和状态完全不变。
- 一轮淘汰多人、仅剩一人、全部淘汰和并列 survival ranking 均有表驱动测试。
- 最终唯一 survivor 为 rank 1；全部同时淘汰时允许并列第一且 `winnerMemberId=null`。
- settlement 重试不会重复濒死、重复扣分或修改已经冻结的 bye/pairing。
- race placement 与 relay elimination 可在同一 binary 独立注册、独立测试，任一 policy 的常量变化不会改变另一方 fixture。

## 可能涉及的代码

relay mode package 下的 `elimination`、stage settlement 与 pairing adapter、relay SQL queries、相关 `0015+` migration、mode-owned contract payload、`packages/shared/src/multi.ts` 的 relay union、server/domain tests。

## 实施与验收记录（2026-08-24）

本 Issue 已交付 `(relay, elimination, 1)` 的完整多人核心链路。relay-owned `EliminationPolicy` 从 10 分开始并封顶 10 分，按 stage index 处理胜 `+1`、负 `-n`、平双方 `-floor(n/2)` 和 bye `0`；普通玩家第一次真实结算的原始结果小于等于 0 时钳制为 0 并进入 near-death，因此恰好归零也会触发濒死。near-death 的正分不生效、零变化不淘汰，下一次真实负分保留负数并淘汰。`scoreDelta` 始终记录封顶或钳制后的实际变化，所有转换显式投影为 `none`、`entered_near_death` 或 `eliminated`。

stage barrier 在同一事务内更新 relay player score/life/eliminated stage 和公共 `multi_match_player.status=eliminated`，一次结算支持 0..N 人同时淘汰；结算后 active 多于 1 人才创建下一 stage，降至 2 人仍继续 elimination，active 小于等于 1 时直接按存留局数结束且没有任意 BO/轮数上限。奇数 active 继续复用 MRX-005 已冻结的 pairing/bye 计划，`relay.stage.ended.byeMemberId` 表示当前结算 stage 的 bye，下一 stage 的 bye 只随 `relay.stage.started` 发布。3/5/7 人连续 20 个确定性计划的测试确认每轮恰有一名 bye 且无人连续 bye。

终局排名只使用 `survivedStages`，积分和 seat 不破同分；唯一 survivor 为唯一第一并设置 winner，全部同时淘汰允许并列第一且 `winnerMemberId=null`。为避免 elimination 负分进入非负的通用 race DTO，`match.ended` 增加 optional relay-owned standings/ranking fragment；OpenAPI、WS v3、共享 TypeScript 类型、snapshot 和 replay 同步增加 `lifeTransition`、`eliminatedMemberIds` 与 `survivedStages`。开局按完整 `RuleSetRef` 初始化分数，legacy/fixed-points 保持 0，elimination 为 10；production runtime/capability 已能解释 elimination，未知 key/version 继续 fail closed。

持久化复用既有 expand schema，无新增 migration；仅增加 sqlc 源查询，以便在 stage 结算事务内同步公共淘汰状态。SQL、OpenAPI Go 和 Web TypeScript 生成物均由 WSL 固定工具链重新生成，二次生成前后四个目标文件 SHA-256 完全一致。公开 relay `PrepareRoom`、`ReadyRoster`、创建/设置和 MatchFactory 仍保持 2 人 legacy 规则，不会选择 elimination；MRX-004 位于另一开发主干且未在本分支吸收。4/6/8 人规则由表驱动 domain 测试覆盖，4 人到淘汰后 3 人 bye、再降至 2 人和终局的完整链路由直接 service/真实 PostgreSQL fixture 验证，后续开放多人前端和房间策略时可按冻结 `RuleSetRef` 直接接入。

WSL 验证结果：

- 聚焦验证 `go test ./internal/multi/relay/... -count=1`、`go test ./internal/multi/... -count=1`、`go test ./internal/server -run MRX008 -count=1` 和 `go test ./internal/server -run "MRX005|MRX006|MRX007|MRX008" -count=1` 通过。MRX-008 真实 PostgreSQL 测试覆盖生产 runtime、3 人 bye、事务可见性、精确重试、降至 2 人、唯一 survivor、并发最终全灭、snapshot/replay 和公共状态同步。
- `go test -race ./internal/multi/relay/... -count=1` 与 `go test -race ./internal/server -run MRX008 -count=1` 通过。
- `go test ./... -count=1` 全部通过，其中 server `36.217s`、migrations `6.883s`；`go vet ./...` 通过。
- `pnpm test` 通过 shared 10、data 26、Web 152，共 188 项；`pnpm typecheck` 与 `pnpm --filter @touhouflandre/web build` 通过。
- `pnpm check:ws-protocol`、`pnpm lint:openapi`、`pnpm check:openapi-refs` 和 `pnpm check:multiplayer-boundaries` 通过；OpenAPI 检查为 41 个 YAML、40 个本地引用、无孤儿文件。
- `task gen:openapi`、固定 `sqlc v1.31.1 generate` 与 `task gen:web` 二次生成前后目标文件 SHA-256 完全一致；Windows Git `diff --check` 通过。

本次没有数据库 migration 或破坏性数据操作。应用回滚只需在不存在进行中的 elimination match 时回到前一 binary；当前公开入口仍限制双人，因此不会由产品流量创建此类 match，未来 MRX-004 开放入口时需沿用发布闸门的停止新建与排空规则。没有实现 MRX-004 多人房间策略、MRX-009 离场/断线统一终态、MRX-011 history projector 或 MRX-012 Web 样式与本地统计。

### 规则调整记录（2026-08-24）

根据规则修订，健康玩家首次真实结算的原始积分结果由“小于 0”改为“小于等于 0”时进入 `near_death`；恰好归零仍将积分公开为 0，本次不淘汰。轮空和已经处于 `near_death` 的玩家分支保持不变。领域单测、真实 PostgreSQL stage settlement 测试及上述决策/矩阵文档已同步更新。
