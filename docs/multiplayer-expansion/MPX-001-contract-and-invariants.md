# MPX-001：冻结 member、seat、房间容量与消息可见性术语

**类型**：设计/文档 Issue  
**优先级**：P0，所有后续多人扩展的前置  
**依赖**：无  
**建议标签**：`type:design` `area:docs` `area:contracts`

## 要解决的问题

当前代码已经有 `player` / `spectator`，但公开视图没有稳定 `memberId`，`slot` 同时承担身份、顺序和房主判断，容量、开局条件、比分、本地统计及“谁能看见什么”也被不同模块用不同方式表达。若直接开始改数据库或加聊天，很容易出现：数组重排错配身份、把容量上限误当成必须凑满的人数、静音/授权过滤被误判为游戏事件丢帧等问题。

## 目标

形成一份被 API、数据库、Go 领域层、WebSocket 和 Web 前端共同引用的决策记录，明确以下内容：

1. `member`、`memberId`、`seat`、`role`、`match roster`、`capability`、`chat channel` 的定义和生命周期；明确 seat 用于显示顺序且本轮 seat 1 仍表示房主，但不能代替 memberId 作为身份。
2. 房间配置的冻结时机：`playerLimit` 是允许入座的最大人数，默认 2，race 为 2..服务端上限，relay 固定 2；`minPlayers=2` 是服务端固定的开局下限。观战者另有不可由房主设置的服务端硬上限，避免无限成员/连接扇出。
3. 玩家/观战者的权限矩阵；特别是“能发送”与“能接收”必须分开，客户端不能选择任意消息 channel。
4. 游戏事件 sequence、无内容 cursor、snapshot 补齐与独立聊天 cursor 的关系。
5. 协议升级策略：规划直接使用 `touhouflandre-multi.v2` 和集合 payload，不维护 `slot1/slot2` 双写；部署前排空/关闭短期 v1 房间。

## 属于本 Issue

- 在 `docs/multiplayer-expansion/decisions.md` 或本 Issue 中记录最终决策和被否决的替代方案。
- 输出 race/relay 的能力矩阵：玩家容量、开局下限、实际 match roster、计分主体、轮流主体、离开/断线语义和观战可见内容。
- 输出消息 channel 表：player 的消息由服务端归入 `room`，player/spectator 均可见；spectator 的消息归入 `spectator`，仅 spectator 可见。
- 明确团队模型不属于本轮；不创建 `team` 表，不预留客户端可选的 `team`/`member` scope。
- 定义文本/表情的大小、字符、频率和保留期上限的产品默认值，供 MPX-008 使用。
- 冻结并发加入、最终准备、容量修改的串行化规则，以及 WS 先订阅缓冲、再按高水位重放、最后切实时的无缺口握手。
- 为每个后续 Issue 写清验收口径和不可突破的不变量。

## 不属于本 Issue

- 不修改数据库、OpenAPI、WS YAML、Go 或 React 代码。
- 不决定具体 UI 视觉稿，不实现表情选择器或聊天输入框。
- 不把接力模式改成 N 人，不设计组队规则，也不实现管理员/审核系统。

## 验收标准

- 文档中的术语在整个 `docs/multiplayer-expansion/` 目录中用法一致。
- 有一张状态 × 角色 × 动作权限表，覆盖创建、加入、观战者认领空席位、准备/取消准备、设置玩家上限、猜测、放弃、空过、重赛、离开、发消息和看消息。
- 明确竞速不必填满 `playerLimit`：当前玩家数处于 `minPlayers..playerLimit`、全部 connected + ready 且房主保持 ready 时，以当时玩家集合冻结 match roster 并开局。
- 有一张消息 channel × 接收角色表，明确当前需求：玩家消息对所有 PK 玩家和观战者可见；观战者消息只对观战者可见，channel 完全由服务端推导。
- 明确游戏事件对每个连接保持连续 sequence；投影跳过时发送 cursor，真正缺口才触发 snapshot。
- 明确聊天独立持久化和分页，不进入 `room_event.sequence`；“闭麦”只影响本地渲染，不改变服务器授权、chat cursor 或其他人的显示。
- 明确对手角色名、字段值和可逆列映射属于隐藏数据；已发生猜测的数量、行序和事件到达时间属于可观察元数据，不能承诺隐藏。
- MPX-002A、MPX-002B、MPX-002C 至 MPX-010 的依赖和完成定义能直接链接到本决策记录，不留“以后再定”的关键安全问题。

## 相关代码定位

本 Issue 不改代码，但决策必须以当前实现为基线：`apps/api/internal/multi/types.go`、`apps/api/internal/multi/projection.go`、`apps/api/internal/hub/{hub.go,conn.go}`、`contracts/ws/protocol.yaml`、`contracts/openapi/schemas/multi-*.yaml`、`apps/web/src/hooks/useRoom.ts` 和 `apps/web/src/stats/`。
