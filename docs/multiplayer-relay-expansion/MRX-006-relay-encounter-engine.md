# MRX-006：实现独立题目与独立 turn 的接力 encounter 引擎

**类型**：功能/核心规则 Issue  
**优先级**：P0  
**依赖**：MRX-005  
**状态**：已完成
**建议标签**：`type:feature` `area:api` `area:multi` `area:contracts`

**决策依据**：[题目隔离](./decisions.md#6-题目隔离)、[Encounter 规则](./decisions.md#7-encounter-规则)

## 要解决的问题

当前 relay turn 直接读取 round 的单一 answer/turn slot，并使用 `[2]int` 和 room seat 1/2。多人 stage 需要每对玩家拥有完全独立的答案、轮次计数、空过额度、deadline 和胜负，同时仍保持现有双人接力的规则体验。

## 要做到什么程度

- 为每个 stage plan 的 encounter 从题库范围独立抽题，同 stage 无放回；答案池不足时原子失败，不留下半个 stage。
- encounter 使用 `memberId`/side 做权威行动者，seat 只作展示；初始先手与后续换手由纯函数决定。
- guess/pass/forfeit 端点显式定位 `stageIndex + encounterId`，transport 只负责路由，relay command handler 校验成员属于该 encounter 且当前有 capability。
- turn、重复猜测、幂等、每人最大轮次、每人 2 次空过、turn timeout 和 encounter deadline 都在 encounter 范围结算。
- 正确、违规空过、forfeit、双方耗尽和整局超时只产出 `EncounterOutcome`；由 MRX-005 屏障决定何时结算 stage。
- 所有新 relay match 共用此 encounter 引擎；N=2 配合 `(relay, legacy_wins, 1)` 后，胜负、先手、空过、超时和 BO 结果与现有实现一致。MRX 前历史仍由 legacy storage adapter 读取。
- 每个增量事件只携带一张棋盘的变化，不广播整个 stage；进行中 payload 不包含 answer。

## 属于本 Issue

- relay encounter domain、command routing、relay-owned repository queries、recovery timeout 和事件源契约。
- 答案选择、题库版本/范围绑定、完整反馈水合与服务端 capability 校验。
- `relay.encounter.started/turn.guess/turn.pass/turn.timeout/ended` 事件与 snapshot 当前 encounter 数据。
- 双人 relay adapter 切到新 encounter engine 所需的兼容测试。
- 1..4 张棋盘同时提交、同角色跨棋盘猜测和幂等竞争测试。

## 不属于本 Issue

- 不给多人 outcome 加减积分或生成最终排名。
- 不实现轮空选择、离场恢复或历史分页。
- 不修改 race 猜测端点、race answer 或匿名矩阵。
- 不让共享 core 读取 `turnMemberId` 或 encounter outcome 来推进 match。
- 不实现 Web 棋盘；测试可使用 API/WS client fixture。

## 验收标准

- 同一 stage 2..4 个 encounter 的 `answerId` 两两不同；不同 encounter 可独立猜同一角色且不会触发唯一键冲突。
- 一张棋盘猜中后只结束该 encounter，其他棋盘仍接受合法动作，stage 尚未结算。
- 成员对其他 encounter 提交 guess/pass/forfeit 返回 `NOT_ENCOUNTER_PLAYER`；非当前行动者返回 `NOT_YOUR_TURN`。
- 已结束 encounter 的任何动作返回 `ENCOUNTER_ENDED` 且不新增 turn/event。
- 并发正确猜测、guess 与 timeout、pass 与 disconnect sweeper 的提交顺序产生唯一终态和连续事件。
- N=2 的 BO1/3/5/7、交替先手、猜测耗尽、2 次空过、forfeit 和 deadline 与 MRX-001 fixture 一致。
- REST、snapshot、WS、日志和错误响应都不泄露进行中 encounter 的答案。

## 可能涉及的代码

relay mode package 下的 encounter/turn/question/recovery 实现、transport command adapter、relay SQL queries、`contracts/openapi/paths/`、`contracts/ws/protocol.yaml`、server integration tests；race 文件只允许必要的兼容调用点调整。

## 实施与验收记录（2026-08-24）

本 Issue 已交付 relay-owned encounter 权威引擎，并将所有新双人 relay match 从 legacy `multi_round` 切换到独立 stage/encounter/turn 存储。每个 encounter 独立冻结答案、行动者、turn deadline、整局 deadline、每人最大 turn 与 2 次空过额度；同 stage 无放回答案不足时，开局事务整体回滚。guess/pass/forfeit 的 canonical API 显式校验 room、stage、encounter、member、turn、幂等键和持久化 `RuleSetRef`，未知 key/version fail closed。legacy 双人 guess/pass/forfeit REST 入口继续通过兼容 adapter 驱动同一引擎。

主要交付如下：

- `internal/multi/relay` 新增可纯函数测试的首手、turn、重复猜测、空过/timeout、双方耗尽、deadline 与 forfeit 状态转换，以及 legacy wins stage scoring policy。`StageCoordinator` 接收冻结题库范围和历史答案，普通 encounter 更新不锁 sibling，最后一个终态 encounter 才通过既有 barrier 结算 stage。
- relay adapter 新增题目 provision、动作事务、完整反馈水合、timeout/recovery scan、终态事件和 N=2 leave/disconnect 兼容路径。共享 sweeper 只依赖窄 `ModeRecovery`/`ModeMemberForfeiter` 接口；多人永久离场、双方同时离场 draw 和明确 `server_restart` encounter 终态仍由 MRX-009 负责。
- `0017_relay_encounter_engine.sql` expand 终态幂等元数据、encounter member 外键和终态一致性约束，Down 为保留数据的 no-op；relay SQL 源与 sqlc `v1.31.1` 生成物同步。迁移测试验证重复应用、外键、终态约束和 backward-readable rollback 语义。
- OpenAPI/WS v3 源增加 encounter 规则上限、稳定错误与可执行 action 响应；Go/TypeScript/OpenAPI/Web 生成物同步。`relay.encounter.started/turn.guess/turn.pass/turn.timeout/ended` 只携带目标棋盘变化，进行中 snapshot/事件/错误不含答案，终态才揭示对应答案。history API 仍按 MRX-011 保持 `501 FEATURE_DISABLED`。
- server/domain/migration 测试覆盖 2/4/6/8 人的 1..4 张棋盘、同 stage 答案互异、题池不足原子失败、跨棋盘相同 guess、权限/turn/终态错误、精确幂等重放、4 棋盘并发、guess-timeout 与 pass-disconnect 竞争、单一 settlement、连续 sequence、完整反馈、答案可见性、N=2 leave/disconnect 和 finished match 重启恢复边界。旧双人 relay WS/共享 turn fixture 已迁到 relay-owned 存储和 namespaced v3 事件，同时保留旧 REST 行为与 BO 结果。

WSL 最终验证结果：

- `go test ./... -count=1` 全部通过，其中 server `33.040s`、migrations `7.097s`；`go vet ./...` 通过。
- `go test ./internal/multi/relay/... -count=1`、`go test ./internal/server -run MRX006 -count=1`、MRX-001/003/005/006 聚焦 server 回归和 MRX-003/005/006 migration 回归全部通过。
- `go test -race ./internal/multi/relay/... -count=1` 与 `go test -race ./internal/server -run MRX006 -count=1` 通过；双人 relay WS 与 shared-turn 兼容测试重复 5 次通过。
- `pnpm test` 全部通过：shared 10、data 26、Web 152，共 188 项；`pnpm typecheck`、`pnpm check:ws-protocol`、`pnpm lint:openapi`、`pnpm check:openapi-refs` 和 `pnpm check:multiplayer-boundaries` 通过。OpenAPI 检查为 41 个 YAML、40 个本地引用、无孤儿文件。
- `pnpm --filter @touhouflandre/web build` 通过。`task gen:openapi`、固定 `sqlc v1.31.1 generate` 与 `task gen:web` 二次生成前后目标文件 SHA-256 完全一致；Windows Git `diff --check` 通过。

迁移为 expand-only，可随新 binary 直接应用；应用回滚保留新表、终态元数据和旧列，不执行破坏性 Down。相对原计划的收尾调整仅包括：把仍断言 v2 `round.*`/`multi_round` 的双人 relay 回归测试同步到 v3 encounter 事件与新存储，以及移除内部异常文本中的答案标识。没有实现 MRX-007/008 计分排名、MRX-009 完整生命周期、MRX-011 history/projector 或 MRX-012 Web 棋盘。
