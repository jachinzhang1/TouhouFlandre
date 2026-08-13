# MPX-007：冻结聊天消息模型、可见性策略与接收偏好语义

**类型**：设计/契约 Issue  
**优先级**：P0  
**依赖**：MPX-002B（逻辑）；实现顺序上仍放在 MPX-005 之后

**建议标签**：`type:design` `area:docs` `area:contracts` `area:security`

## 要解决的问题

聊天不是“给 WebSocket 加一个字符串事件”。它需要稳定的发送者身份、服务器推导的接收范围、可分页重连的独立游标，以及不破坏现有游戏事件重放的 frame 语义。尤其不能把客户端闭麦当成访问控制，也不能让 spectator 消息造成 player 的游戏 sequence 假缺口。

## 目标模型

消息实体至少包含：`messageId`、`roomId`、`senderMemberId`、发送者 displayName/role/seat 的发送时快照、`kind`、规范化文本/emoji、服务端派生的 `channel`、稳定分页 cursor 和创建时间。sender snapshot 是不可变历史，其中 senderMemberId 是快照值而不是鉴权依据，不能依赖活动成员行存续，也不因 lobby 成员行删除而级联丢失。不为本轮未实现的撤销、删除、team 或私聊预埋公开字段。chat cursor 是不透明分页位置，不承诺对某个观察者连续；历史响应即使没有可见消息也要返回服务端已扫描到的新 cursor。

首版 channel 固定为：

| channel | 发送者 | 可见接收者 |
|---|---|---|
| `room` | player | 房间内所有获授权的 player 与 spectator |
| `spectator` | spectator | 房间内所有获授权的 spectator |

产品规则固定为：PK 玩家消息对所有 PK 玩家和观战者可见；观战者消息仅对观战者可见。发送请求只提交内容和幂等键，服务器从 token 对应 member 派生 sender 与 channel，拒绝客户端伪造这些字段。

`receiveChat` 是查看者的显示偏好：关闭后客户端不渲染他人消息，但仍可接收/补齐获授权的 chat cursor；自己的、且按该角色仍获授权的消息仍可在本地显示。spectator claim-seat 后，后续消息按 player 派生为 `room` channel，历史/缓存也按新角色重新过滤，不能继续请求或展示 `spectator` channel。游戏事件继续只推进 `room_event.sequence`，聊天以 message cursor 去重和分页，两者不得共用同一个 `lastSequence`。

v2 hello 分别提交 `lastGameSequence` 与可选 `lastChatCursor`。鉴权成功后连接先进入缓冲态，服务端捕获 game/chat high watermark，使用与 REST history 相同的授权投影重放到各自水位，再排空水位后的缓冲帧并切入实时；`hello-ok` 只声明目标水位，FIFO 队列中的 `sync.complete` 才返回真正完成同步的 game sequence 与 scanned chat cursor。即使该观察者没有可见聊天也能在同步完成后推进水位；若同步中途断线，客户端仍使用上一次已完成水位。允许重叠但必须由 eventId/messageId + cursor 去重，不允许在“历史结束”和“实时开始”之间留下丢消息窗口。chat cursor 不可做加一判断。

## 属于本 Issue

- 消息状态、channel、sender snapshot、生命周期/保留期、稳定分页排序和幂等语义，基于 MPX-002A 已冻结的 memberId/role/seat 模型，并与 MPX-002B 的 v2 同步语义对齐。
- 纯文本/Unicode emoji 的大小、控制字符、空消息、规范化和频率限制默认值；不接受或解释 HTML/Markdown。
- 在决策记录中冻结 REST `send/list`、WS v2 `hello`/`hello-ok`/`sync.complete` 和 `chat.message` frame 的 payload、chat cursor/高水位、错误码和权限矩阵；chat frame 不得被游戏 reducer 当作 room event 推进 sequence。MPX-008 再一次性写入生效中的 OpenAPI/WS 源并更新生成代码。
- 隐私威胁模型：越权观战、claim-seat 后旧 WS 的角色缓存失效/重鉴权、离开后回看、伪造 sender/channel、token 泄漏、重放和日志脱敏。

## 不属于本 Issue

- 不建表、不写 handler、不实现 UI，也不先修改会让现有服务端生成接口失配的生效中 OpenAPI/WS 源。
- 不实现图片上传、表情包 CDN、审核、举报、禁言、管理员角色和私聊。
- 不规定“闭麦后服务器完全不发送”的实现；MVP 使用本地显示过滤。
- 不实现或预留 `team`、`member` 私聊 channel；需要时另做权限和游标设计。

## 验收标准

- 文档有完整的发送者 × channel × 接收者矩阵，并能覆盖 MPX-008 的授权测试用例。
- 明确聊天不写入 `room_event`、不占用游戏 sequence；WS 重连和 REST 历史均通过同一带鉴权的投影按 chat cursor 补齐。
- WS v2 明确区分 room event envelope、room cursor envelope、chat frame 和 `sync.complete`；客户端分别维护 `lastGameSequence` 与不透明的 `lastChatCursor`，不得对 chat cursor 做 `+1` 缺口判断。
- `sync.complete`/history 响应即使没有可见聊天，也返回已扫描到的 chat cursor；客户端只按服务端返回的 cursor 推进，不从 messageId 或时间自行构造。
- chat cursor 与 room、分页方向绑定；格式错误、属于其他房间、超过服务端高水位或已不可恢复时返回稳定错误/重同步路径，不能静默回退到“从头”或“当前”而掩盖丢失。
- 用并发时序图或测试口径证明“订阅缓冲 → 捕获高水位 → 授权重放 → 排空缓冲 → 实时”期间提交的消息不会丢失，重叠消息只显示一次。
- 安全维护者确认不存在依赖前端隐藏实现权限的路径。

## 可能涉及的代码与文档

以 `contracts/ws/protocol.yaml`、`contracts/openapi/paths/`、`contracts/openapi/schemas/` 和 `packages/shared/src/multi.ts` 为现状参考，在 `docs/multiplayer-expansion/decisions.md`（或等价设计文档）冻结契约；不得在本 Issue 中修改生效契约、生成代码、数据库、handler 或 Web UI。MPX-008 必须把决策、契约源、生成物和实现放在同一个 PR 中落地。
