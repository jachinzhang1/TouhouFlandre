# MRX-001：冻结多人接力契约与现有功能回归基线

**类型**：设计/质量 Issue  
**优先级**：P0  
**依赖**：无  
**状态**：已完成
**建议标签**：`type:design` `area:multi` `area:test` `area:contracts`

**决策依据**：[兼容优先的底层改造](./decisions.md#1-兼容优先的底层改造)、[房间配置与开局](./decisions.md#3-房间配置与开局)、[多人模式模块边界](./architecture.md)

## 要解决的问题

本次允许重构多人房间底层。如果没有可执行的现状基线，后续很难区分“有意引入的新接力规则”和“重构造成的竞速/双人接力回归”。同时，用户规则中的“局”既可能指全场轮次，也可能指一对玩家的接力棋盘，濒死、离场、奇数准备和 BO 在不同赛制下也存在可被多种方式解释的细节。

## 要做到什么程度

- 评审并冻结 `decisions.md` 中的 stage/encounter/turn、开局、题目隔离、relay 三种 rule set、濒死、轮空、离场、排名和历史语义。
- 建立状态 × 角色 × capability、`mode + RuleSetRef` × outcome、异常终态和契约字段矩阵。
- 记录当前集成分支完整基线：数据库迁移、Go test、workspace typecheck/test/build、OpenAPI/WS 检查及多人 Playwright。
- 补足“特征测试”，覆盖当前 2 人 race wins、N 人 race points/placement 与淘汰开关、2 人 relay、spectator、chat、断线重连、rematch 和 stats v1-v5 导入；这些测试描述现状而不是提前实现新玩法。
- 给关键 API/WS/数据库 fixture 保存最小快照，供 MRX-002 重构前后逐项对比。
- 记录当前迁移尾号 `0014`、WS v2 和 stats v5，后续 Issue 不得从旧 main 的版本号开始。
- 建立 core/race/relay/transport/storage 所有权表和允许 import 图，作为 MRX-002 的静态检查输入。

## 属于本 Issue

- 本文档组的规则评审和必要修订。
- 只用于锁定既有行为的测试、fixture、基线命令与实测记录。
- 列出已知失败、环境前置和生成物范围；不把既有失败伪装为本次回归。
- 确认 WS v3 是从当前 race `points/placement` 版 v2 向前扩展的不兼容升级，并记录 v2 房间排空前提。

## 不属于本 Issue

- 不创建新表、新 API 或新事件。
- 不放宽 relay 人数、不实现淘汰或多棋盘 UI。
- 不借基线测试修正无关的竞速、聊天、题库或视觉问题；发现问题另开 Issue。

## 验收标准

- [测试矩阵](./test-matrix.md)每条 P0 基线均有测试文件或明确的待补测试负责人。
- 当前稳定文档、OpenAPI、WS v2 与实现之间的差异已记录，不留“实现时再决定”的核心规则。
- 重复运行基线不会产生未解释的 migration/generated/snapshot diff。
- MRX-002 可以仅凭该基线判断重构是否保持现有功能。
- race-only、legacy-relay 和完整 registry 三种装配形态的预期行为已写入测试矩阵；未注册模式的错误语义已冻结，具体装配入口由 MRX-002 交付。

## 可能涉及的代码

`apps/api/internal/{multi,handler,server}/**/*_test.go`、`apps/web/src/**/*.{test,spec}.tsx`、`apps/web/e2e/multiplayer.spec.ts`、`apps/web/src/stats/`、`scripts/check-ws-protocol.mjs`、`docs/multiplayer-relay-expansion/`。

## 实施与验收记录（2026-08-23）

本 Issue 主要冻结当前行为，没有修改运行时规则、REST/OpenAPI、WS v2 或数据库 schema，也没有实现 registry、WS v3、N 人 relay 或后续 Issue 的入口。按后续明确要求收敛 Playwright 基线时，只修正了已确认的 Web 展示/可访问性缺陷和测试契约；没有改变 race、relay、spectator、chat 的服务端规则。新增内容如下：

- `apps/api/internal/server/mrx001_baseline_test.go` 锁定 legacy relay 的 BO1/3/5/7 完整终局、`3N` 安全局数上限、逐局交替先手，以及 guess/pass/timeout/round-forfeit 行为；同一文件从真实 API 投影、WS v2 事件和 PostgreSQL v14 schema 校验三份规范化 fixture。
- `apps/web/src/stats/transfer.test.ts` 增加 stats v1-v5 表驱动导入，统一归一化为 v5，并验证 token、room、seat/memberSlot 不进入导入结果。
- `fixtures/mrx-001-api.json`、`fixtures/mrx-001-ws-v2.json` 和 `fixtures/mrx-001-database.json` 固定最小对比样本；迁移尾号为 `0014`，WS 子协议为 `touhouflandre-multi.v2`，本地统计版本为 v5。
- `test-matrix.md` 将 B-01 至 B-08 映射到现有测试文件，并冻结 race-only、legacy-relay、full registry 三种装配预期和未注册模式的 fail-closed 语义；具体 registry、typed error 和 `check:multiplayer-boundaries` 入口仍由 MRX-002 交付。
- `apps/web/e2e/multiplayer.spec.ts` 不再依赖易变整句文案或宽泛 locator：竞速创建页断言配置摘要和选中赛制，匿名棋盘通过真实猜测验证投影单元格只有状态图标且没有文本值，淘汰场景显式开启 `raceEliminationEnabled` 并按语义化结果 dialog 校验完整排名，闭麦场景在解除闭麦前先等待同频道观察者收到消息。
- Playwright 视觉基线经逐张检查后更新，覆盖当前淘汰设置、聊天入口和公开 `P1/P2` 席位标签；`prepareVisualSnapshot` 排除只存在于开发环境的 Next Dev Tools 浮钮。大厅聊天栏改为文档流布局并增加不重叠的几何断言，活动对局猜测栏提高到聊天栏之上，避免移动端建议项被聊天输入拦截；结果层补充 `dialog` 语义。

WSL 实测结果：

- `cd apps/api && go test ./internal/server -run '^TestMRX001' -count=1` 通过；`pnpm --filter @touhouflandre/web exec vitest run src/stats/transfer.test.ts` 通过 12/12。
- `pnpm lint:openapi`、`pnpm check:openapi-refs`（39 个 YAML、38 个本地引用、无孤儿）、`pnpm check:ws-protocol` 和 `pnpm typecheck` 全部通过。
- `pnpm test` 通过：shared 10、data 26、Web 152，共 188 项；`task test:go` 全部通过，server 套件 38.866s，migration 套件通过。
- 使用 CI 固定的临时 `sqlc v1.31.1` 执行 `task gen` 成功；Windows Git 检查 `apps/api/internal/generated`、`apps/web/src/generated` 无漂移。`pnpm --filter @touhouflandre/web build` 通过。
- 隔离 API（端口 `4011`、高 join 限流、当前代码）上以 4 workers 执行 `pnpm --filter @touhouflandre/web test:e2e e2e/multiplayer.spec.ts --workers=4`，desktop/Pixel 7 共 34/34 通过，54.9s。编辑前的 14 项失败已全部归因并收敛：过期文案/排名排版改为语义断言，匿名 locator 改为真实投影结构断言，淘汰 helper 补齐明确设置，闭麦用例增加消息已到达同步点，视觉变化经检查后更新。原先表面落在移动端 context-close 的 3 项失败经真实移动视口复现后确认是聊天栏 `z-45` 覆盖 `z-40` 猜测建议层；将猜测栏提升到 `z-50` 后，3 workers 聚焦复跑 3/3、完整套件 34/34 均通过，没有保留已知失败或放宽默认 30 秒超时。
- 发布闸门预列的 `pnpm check:multiplayer-boundaries` 当前不存在；这是 MRX-002 验收标准明确要求新增的入口，不在 MRX-001 提前实现。

数据库验证把本地开发库从已有 `0011` expand 到 `0014` 并用 Go seed 刷新题库；没有新增迁移、执行 Down、删除数据库或删除 volume。交付物本身不需要部署迁移或回滚步骤，后续新迁移必须从 `0015` 开始。首次按旧发布文档带额外 `--` 的 Playwright 命令会扩展到全部 64 项且复用端口 4000 的既有低限流服务，因此不作为可比基线；发布闸门命令已移除该分隔符，上面的隔离 34/34 结果是 MRX-002 重构前后的对照标准。
