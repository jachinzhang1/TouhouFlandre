# MRX-005：实现可复用配对器与 relay stage 完成屏障

**类型**：功能/核心编排 Issue  
**优先级**：P0  
**依赖**：MRX-003  
**状态**：已完成
**建议标签**：`type:feature` `area:api` `area:multi` `area:db`

**决策依据**：[Stage、encounter 与 turn](./decisions.md#4-stageencounter-与-turn)、[配对与轮空](./decisions.md#5-配对与轮空)、[事务与锁序](./decisions.md#14-事务与锁序)

## 要解决的问题

现有 round completion 假定一张棋盘结束就是整局结束。多人接力需要在 stage 开始时冻结随机配对，并在 1..4 个 encounter 独立结束后只结算一次。配对算法可以是无存储依赖的通用纯函数，但 stage 持久化和完成屏障属于 relay，不能进入共享 core 或要求 race 采用同一生命周期。

## 要做到什么程度

- 实现纯函数 `PairingPolicy`：输入按稳定顺序排列的 active players、上轮 bye 和注入随机源，输出 pair 列表及可选 bye。
- 配对计划含稳定 encounter index、双方 memberId/seat snapshot；先完整校验，再在一个事务中持久化。
- `RelayStageCoordinator` 负责创建 relay stage/encounter、统一 startsAt、participant 状态和 `relay.stage.started` 领域结果，但不解释 +2/-n。
- encounter 进入终态时尝试 stage barrier：在 stage 锁下检查 unit 状态，只有最后一个完成者获得 settlement ownership。
- stage settlement 使用唯一 marker/version 防重；失败可由请求重试或 sweeper 恢复。
- 下一 stage 只能在上一个 settlement 完成后创建；配对和 bye 一经写入不得因重连/重启重抽。
- 不为未来假设的非 pair unit 建立通用表或 `StageUnit` 必选接口；第二个真实消费者出现后再从纯配对计划/屏障协议中提取复用点。

## 属于本 Issue

- pairing 纯函数、随机源适配、stage plan/domain types。
- relay stage/encounter repository query、完成屏障、settlement ownership 与恢复扫描。
- `relay.stage.started`/encounter summary 的内部事件结果和单元/事务/并发测试。
- bye 选择和“禁止连续两轮轮空”的计划约束；积分影响由 MRX-008 处理。

## 不属于本 Issue

- 不创建答案、接收猜测或判定 encounter 胜负；MRX-006 负责。
- 不计算积分、濒死、淘汰、最终排名；MRX-007/008 负责。
- 不处理玩家离场造成的活动 encounter 终态；MRX-009 负责。
- 不实现 Web 分页或历史。

## 验收标准

- 固定随机源下 2/4/6/8 人分别产出 1/2/3/4 个无重复、无遗漏配对，计划可序列化并稳定恢复。
- 奇数 active roster 恰有一名 bye，其他人恰好出现一次；上轮 bye 不会再次 bye。
- 多个 encounter 并发完成时，恰有一个事务执行 stage settlement，恰有一个 `stage.ended`，不重复创建下一 stage。
- 普通 unit 更新不持有其他 unit 行锁；并发测试和数据库锁超时测试证明不存在反向锁序。
- settlement 中途失败后重试得到同一配对、同一结果和连续事件 sequence。
- relay coordinator 不 import 具体 fixed-points/elimination 常量，fake relay scoring policy 可接收统一 outcomes。
- race-only 装配不创建 relay coordinator 或查询 relay stage；修改配对策略无需修改 `RaceRules`。

## 可能涉及的代码

relay mode package 下的 `pairing`、`stage`、`stage_coordinator`（具体目录由 MRX-002 决定）、relay SQL queries、relay recovery driver、server 并发测试、MRX-003 新增 repository types。

## 实施与验收记录（2026-08-24）

本 Issue 已交付无存储依赖的随机配对策略、relay-owned stage coordinator、PostgreSQL repository、settlement recovery scan 和 expand-only bye 持久化。固定随机源下 2/4/6/8 人分别生成 1/2/3/4 个 encounter；奇数 roster 恰有一个 bye，下一 stage 从已落库计划读取上轮 bye 并禁止连续轮空。配对计划冻结 encounter index、memberId、seat、统一 startsAt、answer/deadline provision 结果，重复创建、重连或恢复均读取同一持久化计划，不会重抽。

完成屏障遵循 `encounter -> stage -> match -> room/event sequence` 锁序。普通 encounter 更新不锁 sibling；最后一个已提交 encounter 在 stage 行锁下成为唯一 settlement owner，调用抽象 `ScoringPolicy`，原子写入 participant settlement、relay player state、唯一 versioned marker、`relay.stage.ended`、可选下一 stage 及其 `relay.stage.started`。事务中途失败会整体回滚，`RecoverSettlements` 通过数据库候选扫描重试同一 stage；并发、锁超时与失败注入测试证明 settlement、结束事件、下一 stage 和事件 sequence 均不重复。

主要变更如下：

- `internal/multi/relay` 新增 `PairingPolicy`、可校验/JSON round-trip 的 pairing/stage domain types、`EncounterProvisioner`、`ScoringPolicy` 与 `StageCoordinator`。coordinator 不解释 fixed-points/elimination 常量；答案/deadline 和计分分别留给 MRX-006、MRX-007/008 的 relay-owned 实现。
- relay adapter 与 SQL 源新增 stage 查找/锁定、完整计划恢复、settlement candidate、player state 更新、bye 和 stage event 持久化；sqlc `v1.31.1` 生成物同步更新。
- `0016_relay_stage_pairing.sql` 新增 `multi_relay_stage_bye`，以 stage 主键保证每轮最多一个 bye，并以复合外键约束 match roster。Down 是 no-op，旧应用忽略新表，应用回滚不删除已冻结的 bye 数据。
- domain、数据库、事务与并发测试覆盖偶数/奇数 roster、稳定恢复、单一 settlement owner、禁止反向 sibling lock、失败回滚、recovery scan、连续 event sequence 和 race-only 边界。MRX-001 迁移尾号基线同步到 16；MRX-005 server fixture 在测试结束时精确关闭自身 match，避免污染既有 restart 扫描。

WSL 最终验证结果：

- `pnpm test` 全部通过：shared 10、data 26、Web 152，共 188 项；`task test:go` 全部通过，其中 server 31.502s，migrations 通过。
- `go test ./internal/multi/... -count=1`、`go test ./internal/server -run MRX005 -count=1`、`go test ./migrations -run MRX005 -count=1` 全部通过。
- `go test -race ./internal/multi/relay/... -count=1` 与 `go test -race ./internal/server -run MRX005 -count=1` 全部通过；`go vet ./...` 与 `pnpm check:multiplayer-boundaries` 通过。
- `pnpm check:ws-protocol`、`pnpm lint:openapi`、`pnpm check:openapi-refs`、`pnpm typecheck` 与 `git diff --check` 全部通过。
- `go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate` 二次生成前后目标文件 SHA-256 一致。`task gen:repo` 因当前 WSL PATH 没有独立 `sqlc` 可执行文件而未采用；改用与仓库生成物一致的固定版本执行，没有全局安装或机器配置变更。

本 Issue 没有接入 room handler/production assembly，没有创建答案、处理动作、判定 encounter、计算积分/濒死/淘汰/排名，也没有开放 fixed-points/elimination 用户流程。当前交付的是后续 relay 玩法可调用的权威配对与 stage 结算底座；MRX-004、MRX-006、MRX-007/008、MRX-009 继续负责房间入口、encounter 引擎、具体计分和生命周期接线。
