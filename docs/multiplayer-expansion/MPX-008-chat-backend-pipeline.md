# MPX-008：实现房间聊天消息的持久化、授权与实时投影

**类型**：功能/API + 数据库 Issue  
**优先级**：P1  
**依赖**：MPX-007  
**建议标签**：`type:feature` `area:api` `area:db` `area:contracts` `area:security`

## 要解决的问题

房间事件目前只记录游戏状态。聊天必须可重连、可分页回看、可按查看者安全投影，同时不能让 spectator 消息出现在 PK 玩家流中，也不能被恶意客户端伪造发送者或 scope。

## 目标行为

- 新增房间级消息表（推荐 `multi_chat_message`）和必要索引，文本/emoji 先作为结构化 `kind + text` 保存；消息事件写入数据库后再广播。
- 提供发送和历史查询接口（建议 `POST /api/rooms/{roomId}/messages`、`GET .../messages?before=`）；发送使用成员 token、幂等键和服务端 sender 推导。
- WebSocket 发布 `chat.message`，按 MPX-007 的 scope 对每个连接投影；不把未授权的 team/member 信息放在公共 payload。
- 应用房间状态、消息长度/Unicode 控制字符校验、每成员/房间限流和历史/关闭房间保留策略。
- 对数据库故障、慢消费者、重复发送和 sequence 缺口给出稳定错误或补齐行为。

## 属于本 Issue

- goose migration、SQLC 查询、Go service/handler、OpenAPI/WS 契约与生成代码。
- scope 授权函数及 player/spectator/team 测试；事件投影和 snapshot/history 补齐。
- 限流、幂等、日志脱敏、指标（消息数、拒绝数、投影失败）和配置项。

## 不属于本 Issue

- 不实现聊天面板、emoji picker、未读数或闭麦控件；MPX-009 负责。
- 不接受图片二进制、外链预览、富文本 HTML 或 Markdown；媒体另开 Issue。
- 不实现管理员审核/删除/禁言；只保留未来扩展字段和权限边界。

## 验收标准

- 玩家发送的消息只有 player/spectator 连接可见；spectator 发送的消息只有 spectator 连接可见；伪造 scope/sender/team 的请求被拒绝。
- 重连和分页历史严格按授权返回；切换/离开角色后不能读取不应有权限的消息。
- 重复幂等键只产生一条消息/一个事件；超长、空白、控制字符、过频和 closed 房间发送有明确错误。
- 游戏事件的 sequence、未知事件忽略、snapshot 补齐和慢消费者测试通过。
- `task gen`、`task check:generated`、`cd apps/api && go test ./...` 通过。

## 可能涉及的代码

`apps/api/migrations/`、`apps/api/sql/queries/`、`apps/api/internal/handler/`、`apps/api/internal/multi/`、`apps/api/internal/hub/`、`contracts/openapi/paths/`、`contracts/openapi/schemas/`、`contracts/ws/protocol.yaml`、生成目录和服务端测试。
