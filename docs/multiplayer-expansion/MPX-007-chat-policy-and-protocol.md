# MPX-007：冻结聊天消息模型、可见性策略与接收偏好语义

**类型**：设计/契约 Issue  
**优先级**：P0  
**依赖**：MPX-003  
**建议标签**：`type:design` `area:contracts` `area:security`

## 要解决的问题

聊天不是“给 WebSocket 加一个字符串事件”。它需要稳定的发送者身份、服务器授权的接收范围、未来队内通信的表达，以及不破坏现有房间事件重放的序列语义。尤其不能把客户端闭麦当成访问控制。

## 目标模型

消息实体至少包含：`messageId`、`roomId`、`senderMemberId`、发送者 role/seat/team 的当时快照、`kind`、规范化文本/emoji、`audienceScope`、创建时间和撤销/删除预留字段。

首版 scope 建议：

| scope | 发送者 | 可见接收者 |
|---|---|---|
| `players` | player | 房间内所有非 left 的 player 与 spectator |
| `spectators` | spectator | 房间内所有非 left 的 spectator |
| `team` | player（后续开放） | 同 team 的 player；默认本轮不开放发送入口 |
| `member` | 受权限控制 | 指定 member；本轮仅预留，不实现私聊 |

当前产品规则固定为：PK 玩家消息对所有 PK 玩家和观战者可见；观战者消息仅对观战者可见。服务器按每个查看者计算授权投影。

`receiveChat` 是查看者的显示偏好：关闭后客户端不渲染他人消息，但仍可接收并确认游戏事件和房间 sequence；自己的消息仍可在本地显示。若未来要做服务端级不下发，必须另设计按接收者维护的游标，不能直接过滤房间级 sequence。

## 属于本 Issue

- 消息状态、scope、sender snapshot、生命周期/保留期、排序和幂等语义，基于 MPX-003 已冻结的成员/角色/席位/队伍模型。
- 文本/Unicode emoji 的大小、控制字符、空消息、频率限制默认值。
- REST `send/list` 和 WS `chat.message` 的 payload 草案、错误码、兼容版本和权限矩阵。
- 隐私威胁模型：越权观战、变更 team 后回看旧消息、token 泄漏、重放和日志脱敏。

## 不属于本 Issue

- 不建表、不写 handler、不实现 UI。
- 不实现图片上传、表情包 CDN、审核、举报、禁言、管理员角色和私聊。
- 不规定“闭麦后服务器完全不发送”的实现；MVP 使用本地显示过滤。

## 验收标准

- 文档有完整的发送者 × scope × 接收者矩阵，并能覆盖 MPX-008 的授权测试用例。
- 明确消息与游戏事件是否共用房间 event sequence；推荐共用持久化事件序列，但每个接收者只收到其有权看到的 `chat.message` 投影，客户端缺口补齐仍以 snapshot 为准。
- 定义旧客户端遇到未知 `chat.message` 的兼容行为（忽略但推进 sequence），以及新客户端连接旧服务器时的降级。
- 安全维护者确认不存在依赖前端隐藏实现权限的路径。

## 可能涉及的代码与文档

`contracts/ws/protocol.yaml`、`contracts/openapi/paths/`、`contracts/openapi/schemas/`、`packages/shared/src/multi.ts`（仅契约草案/类型决策）、`docs/multiplayer-expansion/MPX-001-contract-and-invariants.md` 及新增决策记录。不得在本 Issue 中实现数据库、handler 或 Web UI。
