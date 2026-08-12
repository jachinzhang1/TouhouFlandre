# MPX-008：实现房间聊天消息的持久化、授权与实时投影

**类型**：功能/API + 数据库 Issue  
**优先级**：P1  
**依赖**：MPX-007  
**建议标签**：`type:feature` `area:api` `area:db` `area:contracts` `area:security`

## 要解决的问题

`room_event` 目前承载游戏状态且使用房间级连续 sequence。聊天必须可重连、可分页回看、可按查看者安全投影，同时不能让 spectator 消息出现在 PK 玩家流中，也不能被恶意客户端伪造发送者或 channel；未授权聊天更不能让游戏 reducer 误判丢帧。

## 目标行为

- 新增房间级消息表（推荐 `multi_chat_message`）和必要索引，文本/emoji 先作为结构化 `kind + text` 保存；使用稳定、可分页的独立 chat cursor，消息写入数据库后再广播，但不写 `room_event`。消息随 room 删除而清理，但 senderMemberId/displayName/role/seat 作为不可变快照，不对活动成员行设置级联删除依赖，不能因 lobby 玩家行被删除而丢失消息。
- 提供发送和历史查询接口（建议 `POST /api/rooms/{roomId}/messages`、`GET .../messages?after=` 用于重连补齐，并以 `before` 或等价 cursor 加载更早历史）；发送使用成员 token、客户端消息 ID 和服务端 sender 推导，数据库以 `(room_id, sender_member_id, client_message_id)` 保证幂等唯一。
- WebSocket v2 发布独立 `chat.message` frame，按 MPX-007 的 channel 对每个连接投影；请求不能提交 sender/role/seat/channel，公共 payload 不包含令牌或内部鉴权信息。
- 实现 v2 重连屏障：连接鉴权后先订阅并缓冲，捕获游戏/聊天高水位，分别重放到水位，再排空更新帧，在 FIFO 队尾发送 `sync.complete` 后进入实时；WS chat replay 与 REST history 复用同一授权/游标查询，重叠按稳定 ID 去重。同步中途断线时不得提前确认尚未完整交付的水位。
- 应用房间状态、消息长度/Unicode 控制字符校验、每成员/房间限流和历史/关闭房间保留策略。
- lobby/playing/finished 保留期内允许发送；closed 禁止发送但持有效、非 left token 者在房间树删除前仍可读取获授权历史，left token 不继续读取离开后的消息。
- sender/channel 和历史权限始终从请求时的当前 member role 派生；WS 连接不得长期缓存 capability-bearing role。spectator claim-seat 后旧连接立即失效并重鉴权，新消息进入 `room` channel；旧 spectator 消息保留发送时快照，但该 token 作为 player 不再获权读取 spectator 历史。
- 对数据库故障、慢消费者、重复发送和 chat cursor 缺口给出稳定错误或历史补齐行为，且不影响游戏 sequence。

## 属于本 Issue

- goose migration、SQLC 查询、Go service/handler、OpenAPI/WS 契约与生成代码。
- channel 授权函数及 player/spectator 测试；实时投影与 history 共用同一授权函数。
- 限流、幂等、日志脱敏、指标（消息数、拒绝数、投影失败）和配置项。

## 不属于本 Issue

- 不实现聊天面板、emoji picker、未读数或闭麦控件；MPX-009 负责。
- 不接受图片二进制、外链预览、富文本 HTML 或 Markdown；媒体另开 Issue。
- 不实现管理员审核/删除/禁言；只保留未来扩展字段和权限边界。

## 验收标准

- player 消息对获授权的 player/spectator 连接可见；spectator 消息只有 spectator 连接可见；发送 schema 根本不接受 sender/channel 等可伪造字段，附带未知字段按契约策略拒绝。
- 重连和分页历史严格按授权返回；player token 永远不能读取 `spectator` channel，left token 被拒绝。
- 同一发送者的重复 client message ID 只产生一条消息和一次逻辑广播，不同发送者使用相同 ID 互不冲突；超长、空白、控制字符、过频和 closed 房间发送有明确错误。
- lobby 发送者离开并释放 seat 后，既有消息及发送时昵称/role/seat 保持不变；新占用同一 seat 的 memberId 不会被误认成旧发送者。
- spectator claim-seat 前后的消息分别保留 spectator/player 发送快照；角色变化后实时和历史立即使用新权限，缓存重建不会把旧 spectator channel 暴露到 player 视图。
- spectator 高频消息不会改变 player 的 `lastGameSequence` 或触发 snapshot；chat frame 重复/乱序/慢消费者可按不透明 chat cursor 补历史，历史响应在过滤后为空时也会推进已扫描 watermark。
- 在高水位捕获前、授权重放中和切换实时前分别并发提交消息，客户端均无丢失且只显示一次；游戏事件在同一握手屏障下也保持连续或明确触发 snapshot。
- 伪造、跨房间、越过高水位或不可恢复的 chat cursor 被稳定拒绝/要求重同步，不会扩大历史权限、跳过未交付消息或触发全表扫描。
- `task gen`、Go/Web 生成目录漂移检查、OpenAPI/WS 检查和 `cd apps/api && go test ./...` 通过。

## 可能涉及的代码

`apps/api/migrations/`、`apps/api/sql/queries/`、`apps/api/internal/handler/`、`apps/api/internal/multi/`、`apps/api/internal/hub/`、`contracts/openapi/paths/`、`contracts/openapi/schemas/`、`contracts/ws/protocol.yaml`、生成目录和服务端测试。
