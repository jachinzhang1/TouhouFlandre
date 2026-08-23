# MRX-001：冻结多人接力契约与现有功能回归基线

**类型**：设计/质量 Issue  
**优先级**：P0  
**依赖**：无  
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
