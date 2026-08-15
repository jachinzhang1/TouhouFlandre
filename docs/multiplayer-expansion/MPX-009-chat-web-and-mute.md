# MPX-009：实现聊天面板、表情发送、历史与闭麦设置

**类型**：功能/Web Issue  
**优先级**：P1  
**依赖**：MPX-008  
**建议标签**：`type:feature` `area:web` `area:a11y`

**决策依据**：[聊天 channel × 接收角色](./decisions.md#聊天-channel--接收角色)、[独立聊天持久化、cursor 与本地闭麦](./decisions.md#独立聊天持久化cursor-与本地闭麦)

## 要解决的问题

没有统一的聊天入口时，玩家和观战者只能依赖外部工具交流；把消息直接塞进棋盘又会干扰竞速信息。前端需要按参与者身份展示合适的消息流，并让每个人控制是否显示他人的消息。

## 目标体验

- 房间 lobby、playing、finished/观战回看都能打开同一个聊天面板；面板不改变棋盘核心操作区。
- 支持文本和 Unicode emoji 发送、发送中/失败/重试、历史分页、未读提示和断线重连。
- 玩家视角只会收到 `room` channel 的玩家消息；观战者视角显示 `room` 与 `spectator` 两类获授权消息，前端不自行扩大范围。
- 提供 `receiveChat` 闭麦开关：关闭后隐藏他人消息并保留未读计数，自己的消息不隐藏；偏好保存在当前浏览器 localStorage，刷新/重连后恢复，不同步到服务端。
- 不把 sender/channel 交给客户端自行决定；客户端只渲染服务器返回的授权投影。

## 属于本 Issue

- `useRoom` 的 chat state、v2 hello 中独立的 `lastChatCursor`、`sync.complete` 水位提交、按 messageId/cursor 去重、history 合并、连接错误和 optimistic/ack 状态；chat frame 不进入 room event reducer。
- ChatPanel、消息列表、输入框、emoji 快捷选择、闭麦按钮、未读提示和移动端响应式布局。
- 玩家/观战者权限状态、空状态、长文本换行、键盘/屏幕阅读器支持和组件/e2e 测试。

## 不属于本 Issue

- 不修改消息可见性授权、数据库、REST/WS payload；问题回到 MPX-007/008。
- 不实现图片表情包、上传、拖拽、对象存储或审核。
- 不实现聊天搜索、私聊、禁言、举报和跨房间通知。

## 验收标准

- 玩家和 spectator 在当前需求的可见范围内能互发文本/emoji；spectator 消息不会显示给 player。
- 闭麦只影响当前客户端显示，不改变 `lastGameSequence` 或 `lastChatCursor`；重新打开后可显示仍在本地/历史保留范围内的获授权消息和未读状态。
- 发送失败、重连、重复事件、历史分页和 finished/closed 边界有稳定 UI；不会把 token 或隐藏答案写入 DOM/日志。
- 在重放切实时的边界收到重复帧时只显示一次；断线期间和握手期间提交的获授权消息都能出现，不会因空历史页停在旧 cursor。
- `sync.complete` 前再次断线时仍从上一次完成水位恢复，不会持久化 `hello-ok` 的目标水位而跳过尚未交付的帧。
- 消息正文始终按纯文本渲染；HTML/Markdown/XSS 样例不会被解释为 DOM，昵称和错误文案同样经过安全渲染。
- spectator claim-seat 成为 player 时，chat state 立即按新角色重建/过滤，不再显示或补拉 spectator channel；后续发送也不能沿用旧 channel。
- 桌面、窄屏和键盘操作通过组件测试与多人 Playwright e2e；无障碍名称和焦点顺序可验证。

## 可能涉及的代码

`apps/web/src/hooks/useRoom.ts`、`apps/web/src/domain/multiRoom.ts`、`apps/web/src/components/RoomPage.tsx`、新增 `ChatPanel`/消息组件、`apps/web/src/generated/api.ts`、`apps/web/e2e/multiplayer.spec.ts` 及样式/测试。
