# MRX-007：实现多人接力非淘汰固定轮数积分赛

**类型**：功能/规则 Issue  
**优先级**：P1  
**依赖**：MRX-006  
**状态**：已完成
**建议标签**：`type:feature` `area:api` `area:multi` `area:test`

**决策依据**：[非淘汰计分](./decisions.md#8-非淘汰计分)、[淘汰排名](./decisions.md#10-淘汰排名)

## 要解决的问题

N>2 且关闭接力淘汰时，现有 race `wins/points/placement` 和双人 `targetWins` 都不能作为规则调度依据。`(relay, fixed_points, 1)` 应只消费 relay encounter outcomes，不依赖 turn、棋盘实现或 race placement 计分。

## 要做到什么程度

- 实现 relay-owned `FixedPointsPolicy` 纯函数：win +2、loss +0、draw 双方 +1、bye +0。
- match 开始时初始积分为 0，无上限；`plannedStages=FormatNumber(format)`，不使用 `TargetWins`。
- stage barrier 一次性批量写入 `scoreBefore/delta/scoreAfter`，发布所有 player 的结算明细。
- 未达到 planned stages 时请求 coordinator 创建下一 stage；达到后结束 match。
- 最终按总积分降序生成 competition ranking（`1,1,3`），不用 seat 或任何隐藏规则破同分。
- policy 对离场只接受 relay coordinator 定义的统一 outcome/status；异常提前结束规则由 MRX-009 负责。

## 属于本 Issue

- 固定轮数计分纯函数、match 初始化、stage settlement、match completion 和 ranking。
- 数据库查询、WS/OpenAPI 结算字段、snapshot standings 和规则测试。
- BO1/3/5/7 × 4/6/8 人、全平、并列第一和幂等重试测试。

## 不属于本 Issue

- 不实现淘汰、濒死、积分上限或按存留轮数排名。
- 不修改 encounter 规则、配对随机性或题目隔离。
- 不实现离场后奇数轮空和不足 2 人提前结束；MRX-009 负责。
- 不实现 Web 排行榜和统计落盘。

## 验收标准

- 4/6/8 人在每种 BO 下恰好完成 1/3/5/7 个 stage，不能因某玩家先达到分数而提前结束。
- 每个 encounter 的两名玩家积分增量分别为 2/0 或 1/1；任何 player 每 stage 最多结算一次。
- stage 未全部完成前公开积分不变；最后 encounter 完成后一个事务更新全员比分并发布一次 `stage.ended`。
- 全部平分或部分平分生成稳定共享名次；没有隐式单一 winner。
- 重连、snapshot 和事件 replay 得到相同 `scoreBefore/delta/scoreAfter` 与最终排名。
- N=2 不会选择本 policy，仍由 `(relay, legacy_wins, 1)` 结算。
- race `points` fixture 在启用本 policy 后结果完全不变，二者没有共享计分常量或 ranking 函数。

## 可能涉及的代码

relay mode package 下的 `fixed_points`、stage settlement 与 match result、relay SQL queries、mode-owned contract payload、`packages/shared/src/multi.ts` 的 relay union、server/domain tests。

## 实施与验收记录（2026-08-24）

本 Issue 已交付 `(relay, fixed_points, 1)` 的完整 4/6/8 人核心链路。relay MatchFactory 继续让 N=2 使用 `legacy_wins`，并为 N=4/6/8 按 BO1/3/5/7 冻结 1/3/5/7 个 planned stages；fixed-points 不设置 match 级先手，不读取 `TargetWins`，每张 encounter 的先手仍由 relay provisioner 独立决定。公开 `PrepareRoom`、`ReadyRoster` 和房间设置仍保持双人限制，MRX-004 所属的多人创建权限没有在本 Issue 中开放。

领域层新增 relay-owned `FixedPointsPolicy`、完整 `RuleSetRef` 计分分派和 competition ranking。每个 stage 在 barrier 后按胜 2、平 1、负/bye 0 一次性生成全员 settlement；未达到 planned stages 时保持稳定 roster 并创建下一 stage，最后一轮按总分降序生成共享名次，唯一第一才设置 winner。fixed-points 不 import race，也不复用 race points 常量或 ranking 函数；未知规则版本、N=2 误用、异常 player/life 状态均 fail closed。legacy wins policy 继续只接受 `(relay, legacy_wins, 1)`。

持久化复用 MRX-003/005/006 已有的 relay player state、stage player settlement 和 completion marker，无新增 migration。repository 从 `multi_match.rule_set_key/version` 恢复规则集并按完整三元组调度；fixed-points 只更新 relay-owned score，不同步 `multi_match_player.wins/score` 或 race ranking。终局在 stage 事务内结束 match/room并发布带完整 `memberScores` 和共享 ranking 的 `match.ended`；重试由 stage marker、事务锁和既有唯一约束保证不重复加分、事件或下一 stage。

契约源为 fixed-points 增加 optional `match.started.plannedStages`，relay snapshot 增加 `plannedStages` 和 relay-owned terminal `ranking`；REST snapshot、`relay.stage.ended` replay 与 `match.ended` replay 共用权威 settlement/ranking。OpenAPI Go/Web 生成物已从源重新生成，二次生成前后 SHA-256 一致。没有实现 elimination/near-death、离场后的奇数 active/提前终止、history 分页、Web 排行榜或统计落盘。

WSL 验证结果：

- 基线 `go test ./internal/multi/relay/... -count=1`、`go test ./internal/server -run "MRX005|MRX006" -count=1`、`pnpm check:ws-protocol`、`pnpm lint:openapi`、`pnpm check:openapi-refs`、`pnpm check:multiplayer-boundaries` 全部通过。
- `go test ./internal/multi/relay/... ./internal/multi/assembly -count=1` 与 `go test ./internal/server -run 'MRX005|MRX006|MRX007' -count=1` 通过。MRX-007 DB 测试覆盖 4/6/8 × BO1/3/5/7、barrier 可见性、生产 runtime 恢复、并发重试、全平、部分并列、snapshot/replay/DB 一致性和 legacy score 隔离。
- `go test -race ./internal/multi/relay/... -count=1` 与 `go test -race ./internal/server -run MRX007 -count=1` 通过。
- `go test ./... -count=1` 全部通过，其中 server `33.869s`、migrations `6.778s`；`go vet ./...` 通过。
- `pnpm check:ws-protocol`、`pnpm lint:openapi`、`pnpm check:openapi-refs` 和 `pnpm check:multiplayer-boundaries` 通过；OpenAPI 检查为 41 个 YAML、40 个本地引用、无孤儿文件。
- `pnpm typecheck` 通过；`pnpm test` 通过 shared 10、data 26、Web 152，共 188 项；`pnpm --filter @touhouflandre/web build` 通过。
- `task gen:openapi` 与 `task gen:web` 二次生成后目标文件哈希不变；Windows Git `diff --check` 通过。

本次不需要数据库 rollout；应用回滚只需回到前一 binary，既有 expand schema 和 fixed-points fixture 数据保持可读，不执行破坏性 Down。相对原始依赖图的执行调整是按当前分支事实仅依赖已完成的 MRX-006：MRX-004 位于另一开发主干且只负责多人房间入口，本实现通过直接冻结的 4/6/8 人 service/DB fixture 验证完整核心功能，未吸收 MRX-004 的权限与配置范围。
