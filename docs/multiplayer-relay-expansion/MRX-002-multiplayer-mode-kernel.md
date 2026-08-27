# MRX-002：抽取可插拔多人模式内核与现有玩法适配器

**类型**：重构/架构 Issue  
**优先级**：P0  
**依赖**：MRX-001  
**状态**：已完成
**建议标签**：`type:refactor` `area:api` `area:multi` `area:test`

**决策依据**：[模式内核边界](./decisions.md#2-模式内核边界)、[兼容优先的底层改造](./decisions.md#1-兼容优先的底层改造)、[多人模式模块边界](./architecture.md)

## 要解决的问题

现有 handler 已有 guess mode module，但容量校验、开局、round 创建、完成、sweeper 和投影仍散布 mode/人数分支。直接加入 N 人接力会继续扩大 `if relay`，并让 race 被迫理解配对、濒死和轮空。需要先形成窄 application core 与按需 capability registry，同时保持现有 `RaceRules` 和所有公开行为不变。

## 要做到什么程度

- 建立显式 registry，分别注册 `RoomPolicy`、`MatchFactory`、`CommandHandler`、`CompletionDriver`、`SnapshotProjector`、`HistoryReader` 和 `RecoveryDriver` 等按需能力，不建立“大而全”的 `ModeDefinition` 接口。
- 把共享身份、room lifecycle、事务入口、幂等、事件落库/发布和 snapshot 水位保留在 core；玩法 timeout、完成、排名和投影仍由所属 mode driver 决定。
- 将现有 race、双人 relay 接入兼容适配器；race adapter 组合现有 `RaceRules`，不得复制或改写其 wins/points/placement 算法。
- 把时钟、随机源和持久化端口注入规则/编排层，使后续配对和结算可做确定性测试。
- 用 typed domain result 连接规则和 handler，禁止规则模块直接构造 HTTP 响应或调用 hub。
- 整理包依赖，使 core 不 import mode concrete package、race/relay 互不 import，领域代码不依赖 OpenAPI generated 类型，组合根负责注册，handler 负责 DTO 转换。
- 引入 `RuleSetRef{mode,key,version}` 领域值和解析端口，但保持数据库与 wire 不变；现有 race `scoringMode` 只在 adapter 内转换。

## 属于本 Issue

- `internal/multi` 内的窄接口、registry、共享 command context、capability 基础类型、`RuleSetRef` 和兼容 adapter。
- `handler`、sweeper、projection 入口改为通过 registry 调度。
- 对旧 race/relay 的特征测试、并发测试和 snapshot/WS 对比测试。
- 删除已被 adapter 取代的重复 mode switch，但不进行与目标无关的命名或格式重构。
- 添加依赖方向检查和 race-only/fake-mode 装配测试。

## 不属于本 Issue

- 不引入 relay stage、encounter 表或 WS v3。
- 不改变数据库 schema、REST 路径、事件 payload、错误码或 UI。
- 不放宽 relay 容量，不实现新的计分策略。
- 不强行用一个 DTO/实现统一 race 匿名矩阵和 relay 完整棋盘；投影只共享 capability 调用协议和 core shell。
- 不把现有 `RaceRules` 改名为全局规则引擎，也不抽取 race/relay 尚无相同语义的计分父类。

## 验收标准

- MRX-001 的全部基线在重构前后结果相同，尤其是 N 人 race placement、双人 relay turn/pass/timeout、观战和 chat。
- 增加一个测试用 fake mode 时，可以只实现所需 capability 并通过组合根注册，无需修改核心 handler、race 或 relay package。
- 规则测试可注入固定时钟和随机源，不依赖全局状态。
- core、mode、adapter 和 handler 的依赖方向有包级测试或静态检查保护；race-only 装配不构造 relay repository，relay 测试装配不构造 `RaceRules`。
- 仓库提供可重复执行的 `check:multiplayer-boundaries` 入口，CI 与 MRX-013 发布闸门调用同一检查。
- `RuleSetRef` 缺失、未知 mode/key/version 均返回稳定错误，不回退到任意默认计分规则。
- 此 PR 可单独部署，用户看不到新控件或新行为。

## 可能涉及的代码

`apps/api/internal/multi/{modes.go,match.go,round_completion.go,race_*.go,relay_turns.go,projection.go,sweeper.go}`、`apps/api/internal/handler/{mode_guess.go,matches.go,round_actions.go,snapshot.go}`、相关 server tests。

## 实施与验收记录（2026-08-23）

本 Issue 已建立按 capability 独立注册的多人模式内核，并把当前 race 与双人 relay 经兼容 adapter 接入。交付保持数据库 schema、迁移尾号 `0014`、REST/OpenAPI、WS v2、事件 payload、stats v5 与 UI 源码不变；production registry 只注册 `race/wins@1`、`race/points@1`、`race/placement@1` 和 `relay/legacy_wins@1`，没有提前实现 MRX-003 及后续规则。

主要交付如下：

- `apps/api/internal/multi/core` 提供 `RuleSetRef`、稳定 typed domain error、`Clock`、`RandomSource`、共享 command context/result，以及 `RoomPolicy`、`MatchFactory`、`CommandHandler`、`CompletionDriver`、`SnapshotProjector`、`HistoryReader`、`RecoveryDriver` 的独立 registry。生产随机源使用 `crypto/rand` 播种，测试可注入固定 clock/random。
- `apps/api/internal/multi/{race,relay}` 拥有模式规则集标识，`race/adapter` 继续组合既有 `RaceRules`，`relay/adapter` 保持双人 turn/pass/timeout/BO 兼容；`multi/assembly` 是唯一同时注册两种具体模式的生产组合根，并提供 race-only、relay-only 与 full 装配。
- room create/settings/ready/rematch、match/round 创建、guess/pass/forfeit、离场/timeout/sweeper、restart recovery、snapshot/history 和 WS replay/publish 均先解析完整模式能力。未知或矛盾的持久化 mode/scoring state fail closed；集成测试验证 `relay + points` 返回 `500 + INTERNAL` 且不写 event/turn。
- `apps/api/cmd/check-multiplayer-boundaries` 使用 Go AST 阻止 core 导入具体模式、race/relay 相互导入，以及 core/mode/adapter 直接依赖 HTTP、OpenAPI 或 hub。根脚本 `pnpm check:multiplayer-boundaries`、CI 与 MRX-013 发布闸门使用同一入口。
- 新增 partial fake mode、未来 relay capability probe、重复注册、缺失/未知 RuleSetRef、固定时钟/随机、race-only/relay-only/full assembly、非法持久化状态与随机端口测试。现有 MRX-001 fixture、race/relay sweeper、restart、snapshot、WS replay/broadcast 和 stats v1-v5 回归保持通过。

WSL 实测结果：

- `pnpm check:multiplayer-boundaries`、`pnpm lint:openapi`、`pnpm check:openapi-refs`、`pnpm check:ws-protocol`、`pnpm typecheck` 全部通过；OpenAPI 检查仍为 39 个 YAML、38 个本地引用、无孤儿。
- `pnpm test` 通过：shared 10、data 26、Web 152，共 188 项。`go vet ./...` 与 `task test:go` 全部通过；最终 server 集成套件 30.212s，migration 套件通过。
- `task gen` 使用临时、与 CI 同版本的 `sqlc v1.31.1` 完整通过，临时工具随后移除；Windows Git 确认 `apps/api/internal/generated`、`apps/web/src/generated` 零漂移。`pnpm --filter @touhouflandre/web build` 通过。
- 在连接一次性 `touhouflandre_test` 的当前 API（端口 `4011`、高 join 限流）上，以 `API_PROXY_TARGET=http://127.0.0.1:4011 pnpm --filter @touhouflandre/web test:e2e e2e/multiplayer.spec.ts --workers=4` 完成 desktop/Pixel 7 回归，最终 34/34 通过，58.5s。

执行中发现 MRX-001 虽记录视觉基线已更新，但提交 `de66960` 删除了对应 10 张 Linux snapshot，导致原始 E2E 命令首次为 26 通过、8 个用例仅因 `snapshot doesn't exist` 失败。逐张检查本轮生成的 desktop/Pixel 7 图片，确认动态字段遮罩、匿名棋盘、淘汰排名、观战分页、聊天布局、无横向溢出和无答案泄露后，原始命令复跑为 34/34；这些图片只作为本地测试产物保留，由 `apps/web/.gitignore` 排除，不进入 Git 版本管理。没有修改 Web 组件或用户行为。

本 Issue 没有新增迁移、执行 Down、修改开发/生产数据或改变 wire。可单独部署；应用回滚只需部署上一 binary，数据库保持向后可读。开发 PostgreSQL 保留运行，临时 `4011` API 和 Playwright Web 服务已停止。偏离原计划的唯一事项是本地生成并检查上述缺失视觉 snapshot；relay stage/encounter、持久化 RuleSetRef、WS v3、新计分、容量与 UI 仍明确留给 MRX-003 及后续 Issue。
