# MPX-001：冻结参与者、席位、队伍与消息可见性术语

**类型**：设计/文档 Issue  
**优先级**：P0，所有后续多人扩展的前置  
**依赖**：无  
**建议标签**：`type:design` `area:docs` `area:contracts`

## 要解决的问题

当前代码已经有 `player` / `spectator`，但 `slot`、人数、比分和“谁能看见什么”仍被不同模块用不同方式表达。若直接开始改数据库或加聊天，很容易出现：观战者被误当玩家、队内消息越权、静音导致事件序列缺口、房主修改了已经开始的配置等问题。

## 目标

形成一份被 API、数据库、Go 领域层、WebSocket 和 Web 前端共同引用的决策记录，明确以下内容：

1. `member`、`seat`、`team`、`role`、`capability`、`audience` 的定义和生命周期。
2. 房间配置的冻结时机：`playerLimit`、队伍分配策略、模式支持范围和服务器硬上限。
3. 玩家/观战者/未来角色的权限矩阵；特别是“能发送”与“能接收”必须分开。
4. 聊天消息的 scope 语义，以及事件序列、重放、snapshot 补齐与消息过滤的关系。
5. 旧房间和旧客户端的兼容策略：默认 `playerLimit=2`，旧双人 payload 是否提供过渡字段，以及何时提升 WS 子协议版本。

## 属于本 Issue

- 在 `docs/multiplayer-expansion/decisions.md` 或本 Issue 中记录最终决策和被否决的替代方案。
- 输出 race/relay 的能力矩阵：玩家数、队伍数、计分主体、轮流主体、观战可见内容。
- 输出消息 scope 表，至少包含 `players`、`spectators`、`team`、`member` 四类的定义、发送者限制和接收者计算方式。
- 定义文本/表情的大小、字符、频率和保留期上限的产品默认值，供 MPX-008 使用。
- 为每个后续 Issue 写清验收口径和不可突破的不变量。

## 不属于本 Issue

- 不修改数据库、OpenAPI、WS YAML、Go 或 React 代码。
- 不决定具体 UI 视觉稿，不实现表情选择器或聊天输入框。
- 不把接力模式改成 N 人，也不实现管理员/审核系统。

## 验收标准

- 文档中的术语在整个 `docs/multiplayer-expansion/` 目录中用法一致。
- 有一张状态 × 角色 × 动作权限表，覆盖创建、加入、准备、猜测、放弃、空过、重赛、离开、发消息、看消息。
- 有一张消息 scope × 接收角色表，明确当前需求：玩家消息对所有 PK 玩家和观战者可见；观战者消息只对观战者可见。
- 明确“闭麦”只影响本地渲染，不改变服务器授权、数据库事件序列或其他人的显示。
- MPX-002 至 MPX-010 的依赖和完成定义能直接链接到本决策记录，不留“以后再定”的关键安全问题。

## 相关代码定位

本 Issue 不改代码，但决策必须以当前实现为基线：`apps/api/internal/multi/types.go`、`apps/api/internal/multi/projection.go`、`contracts/ws/protocol.yaml`、`contracts/openapi/schemas/multi-*.yaml`、`apps/web/src/hooks/useRoom.ts`。
