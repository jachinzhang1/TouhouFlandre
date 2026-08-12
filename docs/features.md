# 功能与页面

本文说明 TouhouFlandre 的用户功能、页面职责和系统边界。

## 产品概览

TouhouFlandre 是浏览器端东方角色推理游戏。服务端负责选择答案、校验猜测、生成反馈和维护多人状态；客户端负责搜索、游玩、会话恢复、本地统计与结果展示。

项目设计目标：

- 无需账号即可完成每日题、随机题和游客多人房间。
- 反馈规则稳定、可解释，进行中的答案不会发送给客户端。
- 角色名称与标签适合中文语境，同时保留多语言搜索能力。
- 数据、比较逻辑、API 与界面保持清晰边界，便于社区维护。

## 功能范围

| 能力 | 说明 |
|---|---|
| 每日题 | 同一天使用固定题目，支持恢复会话。 |
| 随机题 | 创建独立随机会话，可重新开始。 |
| 角色搜索 | 支持图标/列表视图、名称或登场顺序及正倒序切换。 |
| 属性反馈 | 六个核心字段，含完全、部分、方向与不匹配状态。 |
| 结果分享 | 复制无剧透的纯文本摘要。 |
| 答案资料 | 单人题结束后展示答案角色的日文名、首次登场、种族、能力、地点和身份。 |
| 会话恢复 | Postgres 保存游戏会话，浏览器保存会话标识。 |
| 多人房间 | 创建/加入房间、BO1/3/5/7 赛制、竞速、接力、再来一局和 WebSocket 实时同步。 |
| 本地统计 | 浏览器本地记录单人/多人游玩、作品、猜测次数、有效耗时与历史；支持筛选、清除和 JSON 导入导出。 |
| 公告 | 通过仓库内 Markdown 内容提供站点公告。 |
| 站点访问数 | 页脚展示全站访问次数；每次完整页面加载或刷新记录一次。 |

## 页面与路由

| 路由 | 页面职责 |
|---|---|
| `/` | 首页与主要游戏入口。 |
| `/single` | 单人模式选择。 |
| `/single/daily` | 每日题。 |
| `/single/random` | 随机题。 |
| `/search` | 角色题库搜索。 |
| `/multi` | 多人大厅：创建房间或输入房间号加入。 |
| `/multi/room/[code]` | 多人房间：大厅、对局和结果状态机。 |
| `/stats` | 本地游玩统计、图表、历史记录与数据管理。 |
| `/announcement` | 公告列表与正文。 |
| `/links` | 友链与第三方素材鸣谢。 |

`/single/[mode]` 只接受已注册的单人模式，非法模式返回 404。多人房间页会校验房间号和成员资格。

## 状态与存储

- Postgres 保存角色、作品、版本化题库快照、每日题映射、单人会话、多人房间和事件。
- Postgres 保存全站访问计数，服务重启不会清零；重新建库会归零。
- 浏览器 `localStorage` 保存每日题、随机题和多人房间恢复入口。
- 浏览器 IndexedDB `touhouflandre-stats` 保存完成记录、进行中统计草稿和清除边界，不上传到服务器。
- 统计计时只累计页面可见且题局进行中的前台时间。
- 本地统计导出不包含多人 guest token、房间号、对手昵称或进行中草稿。
- 服务端按 `Asia/Shanghai` 自然日创建每日题映射；同一日期一旦创建便不受题库更新影响。
- 会话引用创建时的题库快照，题库更新不会改变已开始会话的答案和比较数据。

## API 概览

`contracts/openapi/openapi.yaml` 是 HTTP 契约唯一入口。Go 侧使用 oapi-codegen 生成 handler 接口和 DTO，前端使用 openapi-typescript 生成类型并通过 openapi-fetch 调用。

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/health` | 服务健康检查。 |
| `POST` | `/api/site/visits` | 记录一次站点访问并返回全站访问数。 |
| `GET` | `/api/catalog` | 获取内容类型与题库统计。 |
| `GET` | `/api/catalog/characters` | 获取完整可猜角色表。 |
| `GET` | `/api/characters/search` | 搜索、排序或分页读取可猜角色。 |
| `POST` | `/api/puzzles/{mode}` | 按已注册模式创建游戏会话。 |
| `GET` | `/api/sessions/{sessionId}` | 恢复公开会话状态。 |
| `POST` | `/api/sessions/{sessionId}/guess` | 提交猜测并获取更新后的会话。 |
| `POST` | `/api/sessions/{sessionId}/forfeit` | 主动放弃单人会话并进入终态。 |
| `POST` | `/api/rooms` | 创建多人房间。 |
| `GET` | `/api/rooms/{roomCode}` | 加入前读取公开房间信息。 |
| `POST` | `/api/rooms/{roomCode}/join` | 加入多人房间。 |
| `POST` | `/api/rooms/{roomId}/ready` | 设置多人房间准备状态。 |
| `POST` | `/api/rooms/{roomId}/leave` | 离开多人房间。 |
| `DELETE` | `/api/rooms/{roomId}` | 房主关闭多人房间。 |
| `GET` | `/api/rooms/{roomId}/snapshot` | 获取房间快照与事件补齐。 |
| `POST` | `/api/rooms/{roomId}/rounds/{roundIndex}/guess` | 提交多人小局猜测。 |
| `POST` | `/api/rooms/{roomId}/rounds/{roundIndex}/forfeit` | 放弃当前多人小局。 |
| `POST` | `/api/rooms/{roomId}/rounds/{roundIndex}/pass` | 接力模式主动空过当前轮次。 |
| `POST` | `/api/rooms/{roomId}/rematch` | 结束后请求再来一局。 |
| `GET` | `/api/rooms/{roomId}/ws` | 多人房间 WebSocket 事件通道。 |

前端默认请求同源 `/api`，由 Next rewrites 代理到 Go API。设置 `NEXT_PUBLIC_API_BASE_URL` 后，浏览器会直连指定 API 地址。

## 兼容性与无障碍

客户端面向支持 ES modules、Fetch API、History API 和 Clipboard API 的现代浏览器。界面应满足以下基础要求：

- 所有主要操作可通过键盘完成。
- 图标按钮具备可访问名称或提示。
- 状态不只依赖颜色表达。
- 小屏幕可横向查看反馈表格。
- 系统启用“减少动态效果”时停用非必要动画。

开发边界和后续方向见[站点开发计划](./site-development-plan.md)。
