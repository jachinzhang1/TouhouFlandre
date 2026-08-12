# MPX-009：实现聊天面板、表情发送、历史与闭麦设置

**类型**：功能/Web Issue  
**优先级**：P1  
**依赖**：MPX-008  
**建议标签**：`type:feature` `area:web` `area:a11y`

## 要解决的问题

没有统一的聊天入口时，玩家和观战者只能依赖外部工具交流；把消息直接塞进棋盘又会干扰竞速信息。前端需要按参与者身份展示合适的消息流，并让每个人控制是否显示他人的消息。

## 目标体验

- 房间 lobby、playing、finished/观战回看都能打开同一个聊天面板；面板不改变棋盘核心操作区。
- 支持文本和 Unicode emoji 发送、发送中/失败/重试、历史分页、未读提示和断线重连。
- 玩家视角显示玩家与观战者消息中“有权查看”的部分；观战者视角显示玩家和观战者消息，符合 MPX-007 的授权结果。
- 提供 `receiveChat` 闭麦开关：关闭后隐藏他人消息并保留可恢复的未读计数策略，自己的消息不隐藏；设置在刷新/重连后按产品决策恢复。
- 不把 sender/team/scope 交给客户端自行决定；客户端只渲染服务器返回的投影。

## 属于本 Issue

- `useRoom` 的 chat state、sequence 去重、history 合并、连接错误和 optimistic/ack 状态。
- ChatPanel、消息列表、输入框、emoji 快捷选择、闭麦按钮、未读提示和移动端响应式布局。
- 玩家/观战者权限状态、空状态、长文本换行、键盘/屏幕阅读器支持和组件/e2e 测试。

## 不属于本 Issue

- 不修改消息可见性授权、数据库、REST/WS payload；问题回到 MPX-007/008。
- 不实现图片表情包、上传、拖拽、对象存储或审核。
- 不实现聊天搜索、私聊、禁言、举报和跨房间通知。

## 验收标准

- 玩家和 spectator 在当前需求的可见范围内能互发文本/emoji；spectator 消息不会显示给 player。
- 闭麦只影响当前客户端显示，不导致游戏事件 sequence 缺口；重新打开后按定义显示新消息/未读状态。
- 发送失败、重连、重复事件、历史分页和 finished/closed 边界有稳定 UI；不会把 token 或隐藏答案写入 DOM/日志。
- 桌面、窄屏和键盘操作通过组件测试与多人 Playwright e2e；无障碍名称和焦点顺序可验证。

## 可能涉及的代码

`apps/web/src/hooks/useRoom.ts`、`apps/web/src/domain/multiRoom.ts`、`apps/web/src/components/RoomPage.tsx`、新增 `ChatPanel`/消息组件、`apps/web/src/generated/api.ts`、`apps/web/e2e/multiplayer.spec.ts` 及样式/测试。
