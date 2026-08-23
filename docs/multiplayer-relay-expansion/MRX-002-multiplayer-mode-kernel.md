# MRX-002：抽取可插拔多人模式内核与现有玩法适配器

**类型**：重构/架构 Issue  
**优先级**：P0  
**依赖**：MRX-001  
**建议标签**：`type:refactor` `area:api` `area:multi` `area:test`

**决策依据**：[模式内核边界](./decisions.md#2-模式内核边界)、[兼容优先的底层改造](./decisions.md#1-兼容优先的底层改造)

## 要解决的问题

现有 handler 已有 guess mode module，但容量校验、开局、round 创建、完成、sweeper 和投影仍散布 mode/人数分支。直接加入 N 人接力会继续扩大 `if relay`，并让 race 被迫理解配对、濒死和轮空。需要先形成稳定的共享编排边界，同时保持所有现有行为不变。

## 要做到什么程度

- 建立显式 `ModeDefinition` 注册表，由 mode 组合 room policy、match factory、action handler、completion/scoring 和 projector。
- 把共享鉴权、锁序、幂等、事件落库/发布、snapshot 水位与生命周期保留在 kernel。
- 将现有 race、双人 relay 接入兼容适配器；适配器可继续调用现有规则函数，首个 PR 不要求重写算法。
- 把时钟、随机源和持久化端口注入规则/编排层，使后续配对和结算可做确定性测试。
- 用 typed domain result 连接规则和 handler，禁止规则模块直接构造 HTTP 响应或调用 hub。
- 整理包依赖，使 `multi` 领域代码不依赖 OpenAPI generated 类型，handler 负责 DTO 转换。

## 属于本 Issue

- `internal/multi` 内的接口、registry、共享 command context、capability 基础类型和兼容 adapter。
- `handler`、sweeper、projection 入口改为通过 registry 调度。
- 对旧 race/relay 的特征测试、并发测试和 snapshot/WS 对比测试。
- 删除已被 adapter 取代的重复 mode switch，但不进行与目标无关的命名或格式重构。

## 不属于本 Issue

- 不引入 stage unit、encounter 表或 WS v3。
- 不改变数据库 schema、REST 路径、事件 payload、错误码或 UI。
- 不放宽 relay 容量，不实现新的计分策略。
- 不强行用一个接口统一 race 匿名矩阵和 relay 完整棋盘；投影只共享调用协议。

## 验收标准

- MRX-001 的全部基线在重构前后结果相同，尤其是 N 人 race placement、双人 relay turn/pass/timeout、观战和 chat。
- 增加一个测试用 fake mode 时，可以通过 registry 接入 room policy 与 action/completion，而无需修改核心 handler 的 mode switch。
- 规则测试可注入固定时钟和随机源，不依赖全局状态。
- kernel、adapter 和 handler 的依赖方向有包级测试或静态检查保护，不出现 import cycle。
- 此 PR 可单独部署，用户看不到新控件或新行为。

## 可能涉及的代码

`apps/api/internal/multi/{modes.go,match.go,round_completion.go,race_*.go,relay_turns.go,projection.go,sweeper.go}`、`apps/api/internal/handler/{mode_guess.go,matches.go,round_actions.go,snapshot.go}`、相关 server tests。
