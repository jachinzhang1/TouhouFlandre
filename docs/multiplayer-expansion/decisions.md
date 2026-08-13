# MPX 多人扩展决策记录

本文是 MPX-001 冻结的规范性决策记录。MPX-002A 至 MPX-010 的数据库、契约、服务端、Web 与测试必须遵循本文；若实现发现冲突，应回到拥有该语义的 Issue 修改本文和对应验收，不能在消费端增加另一套解释。

文中的 `必须`、`不得`、`仅` 表示不可由实现自行放宽的约束。字段名使用公开 wire 形态（camelCase）；数据库字段在需要时另写 snake_case。

## 术语与生命周期

| 术语 | 冻结定义 | 生命周期与约束 |
|---|---|---|
| participant / member | 房间内由服务端签发游客令牌绑定的参与者记录；本轮角色只有 `player` 与 `spectator` | 加入时创建；lobby player 离开可删除，playing/finished roster member 为终态恢复保留；不能把“没有 seat”当作唯一角色判断 |
| `memberId` | 房间内稳定、可公开的参与者标识 | 从 member 创建到该记录清理前不变；不是令牌、账号或权限凭据；事件、比分、棋盘和运行时状态以它关联 |
| role | member 当前的授权角色：`player` 或 `spectator` | 只由服务端命令改变；claim-seat 可在 lobby 将 connected spectator 改为未准备 player；角色变化使旧 WS 连接失效并要求重鉴权 |
| seat | player 在当前房间的正整数展示顺序，seat 1 在本轮仍表示房主 | 同房间活动 player 唯一；spectator 必须为 null；可在 lobby 降容压紧时变化，因此不得作为身份键 |
| slot | v1、旧数据库或旧双人 payload 的历史术语 | 只在描述 `slot1/slot2`、`winner_slot`、`score_slot1/2` 等待迁移结构时使用；目标模型和新增公开字段统一使用 seat |
| match roster | match 开始事务冻结的 player 集合及其开局时 seat 快照 | 场内身份、计分和 rematch 完整性以 roster `memberId` 为准；新 member 或 spectator 不能补位 |
| capability | 服务端根据 member、role、room/match 状态和 roster 计算的动作许可 | 不由客户端声明，也不从 seat 或 UI 是否显示按钮推断 |
| viewer | 当前 REST/WS 请求经令牌鉴权后的 member 与 capability 视角 | `memberId` 可公开不代表获得该 viewer 的权限；所有投影在服务端执行 |
| `playerLimit` | 房间允许同时入座的 player 最大数 | 默认 2；race 允许 2..8，relay 固定 2；它不是必须凑满的开局人数 |
| `minPlayers` | 允许开局的最少 player 数 | 服务端固定为 2，不开放房主设置；满足下限、全员 connected + ready 即可按当前集合开局 |
| `spectatorCap` | 单房间未离开 spectator 的服务端安全上限 | 首版固定 32，不可由房主设置，不占 `playerLimit`；服务端配置名可用 `maxSpectatorsPerRoom`，公开文档统一称 spectatorCap |
| chat channel | 聊天消息由服务端派生的授权范围 | 本轮只有 player 对应的 `room` 和 spectator 对应的 `spectator`；客户端不得提交 channel |
| `receiveChat` | 查看者当前浏览器是否渲染他人聊天的本地偏好 | 不改变服务端授权、历史扫描、chat cursor、游戏 sequence 或其他查看者的显示 |
| game sequence | `room_event.sequence` 的房间级、从 1 递增的游戏/生命周期事件位置 | v2 对每个授权连接投递业务事件或同 sequence cursor envelope，使连接看到连续序列 |
| chat cursor | 服务端签发并校验的房间绑定、不透明聊天扫描位置 | 独立于 game sequence；客户端不得加一、解析、从时间或 messageId 构造 |

除明确说明“现有/v1/迁移前”外，`member` 指成员记录，`player`/`spectator` 指角色，`seat` 指展示位置，`memberId` 指稳定关联键。统计落盘和导出不得保留 `memberId`、昵称、房间标识或令牌。

## 模式能力边界

| 维度 | race | relay |
|---|---|---|
| `playerLimit` | 默认 2，可由房主在规则允许时设置为 2..8 | 固定 2，拒绝 race 专属设置 |
| `minPlayers` | 固定 2，不要求填满 `playerLimit` | 固定 2，等同于固定容量 |
| match roster | 开局时冻结当前 2..`playerLimit` 名 eligible player | 开局时冻结 seat 1、2 两名 player |
| 计分主体 | roster `memberId`，每名玩家独立 wins | roster `memberId`，仍为两人比分 |
| 行动主体 | roster 中仍可参与本局的每名玩家并行猜测 | 单一 `turnMemberId`，按两人 roster 轮转 |
| 小局放弃 | 仅该玩家退出本局；只剩一名 active player 时该玩家赢 | 放弃者本局判负，对方赢 |
| 对局中离开/断线超时 | roster member 标记 left 并等价于本局放弃；剩余玩家继续，仅剩一名 active roster member 时其直接赢整场；全部同时失效则无胜者结束 | 离开者/超时者判负，对方赢，保持现有两人结果 |
| rematch | 只允许原 roster 完整、无人 left、全员 connected 且全部确认 | 同左，仍固定原两人 roster |
| player 进行中视图 | 自己完整棋盘；每名对手独立匿名矩阵 | 双方共享完整棋盘 |
| spectator 进行中视图 | roster 所有玩家的完整棋盘 | 完整共享棋盘 |

## 大厅串行化与开局冻结

race 的 `playerLimit` 只表示入座容量，不表示开局必须人数。开局判定使用以下唯一算法：

1. join、claim-seat、ready/unready、`playerLimit` 修改和首次 match 创建都必须在数据库事务内先锁定同一 room 行。
2. 容量统计包含 lobby 中 `connected` player 和仍在断线宽限期内的 `disconnected` player；后者保留原 seat，其他 member 不能抢占。lobby player 明确离开或宽限期届满并完成删除后才释放 seat。
3. ready 命令显式提交布尔值。`ready=false` 仅在 lobby 且 match 尚未创建时允许并保持幂等；房主可保持未准备以继续等人，设置 `playerLimit` 本身不得触发开局。
4. `ready=true` 更新后，在同一 room 锁和事务中重新读取全部活动 player。只有 `2 <= playerCount <= playerLimit`、每名 player 均为 `connected + ready`、seat 1 房主仍为 `ready` 且尚无 match 时，才以此刻按 seat 排序的 player `memberId` 集合冻结 match roster 并进入 playing。
5. roster 行、match/首局状态和对应 room events 必须在同一事务提交。提交后才广播；任何消费者不得从 `members.length` 或事件到达先后自行推导另一套 roster。

例如 `playerLimit=8` 时，2、3、5 或 8 名当前 player 均可在全员 connected + ready 后开局；第 9 个参与者不影响已冻结 roster。少于 2 人、任一 player 未准备或处于 disconnected 时均不得开始。

并发只允许以下线性化结果：

| 竞争 | 先获得 room 锁的事务 | 后获得 room 锁的事务 | 权威结果 |
|---|---|---|---|
| final ready vs join | final ready 冻结当时 roster 并将房间转为 playing | join 重新读到 playing，只能在 spectatorCap 内加入为 spectator | 新 member 不进入 roster |
| final ready vs claim-seat | final ready 冻结当时 roster 并转为 playing | claim-seat 重新读到非 lobby，稳定失败 | spectator 不补入已开始 match |
| join vs final ready | join 取得 player seat 并以 `ready=false` 提交 | final ready 重新读取到该未准备 player | 不开局，直到新 player 也准备 |
| claim-seat vs final ready | claim-seat 复用 memberId、取得 seat 并以 `ready=false` 提交 | final ready 重新读取到该未准备 player | 不开局，claim 成功者进入候选 roster |
| 多个 claim-seat 竞争最后席位 | 首个事务分配最小可用 seat | 后续事务重新读取到满员 | 至多一人成功 |
| 修改上限 vs join/claim-seat | 修改先提交则后续按新上限判断 | 入座先提交则修改不得低于新的 player 数 | 不出现超额 player 或 `seat > playerLimit` |

服务端不得依赖可重试事务的偶然执行次数发布事件；只有最终提交事务分配 sequence 并广播。序列化失败可安全重试，但同一幂等命令最终只能形成一次状态变化。

## 状态 × 角色 × 动作权限

下表是服务端授权矩阵。`允许`仍须通过请求格式、限流和玩法规则校验；`条件允许`的附加条件在表后冻结。所有写命令均要求 token 对应 member 为 `connected`，`disconnected` 必须先重连，`left` 不得写入。

| 动作 | 无房间身份 | lobby host player | lobby 其他 player | lobby spectator | playing roster player | playing spectator | finished 原 roster player | finished spectator / retained left | closed |
|---|---|---|---|---|---|---|---|---|---|
| 创建房间 | 允许 | 允许创建另一房间 | 允许创建另一房间 | 允许创建另一房间 | 允许创建另一房间 | 允许创建另一房间 | 允许创建另一房间 | 允许创建另一房间 | 允许创建另一房间 |
| 公开预检 / 加入 | 条件允许 A | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 拒绝 |
| claim-seat | 无身份拒绝 | 不适用 | 不适用 | 条件允许 B | 状态拒绝 | 状态拒绝 | 状态拒绝 | 状态拒绝 | 拒绝 |
| 准备 `ready=true` | 无身份拒绝 | 允许 | 允许 | 只读拒绝 | 状态拒绝 | 只读拒绝 | 状态拒绝 | 只读拒绝 | 拒绝 |
| 取消准备 `ready=false` | 无身份拒绝 | 允许 | 允许 | 只读拒绝 | 状态拒绝 | 只读拒绝 | 状态拒绝 | 只读拒绝 | 拒绝 |
| 设置 `playerLimit` | 无身份拒绝 | 条件允许 C | 非房主拒绝 | 只读拒绝 | 配置锁定 | 只读拒绝 | 配置锁定 | 只读拒绝 | 拒绝 |
| 猜测 | 无身份拒绝 | 状态拒绝 | 状态拒绝 | 只读拒绝 | 条件允许 D | 只读拒绝 | 状态拒绝 | 只读拒绝 | 拒绝 |
| 放弃当前小局 | 无身份拒绝 | 状态拒绝 | 状态拒绝 | 只读拒绝 | 条件允许 E | 只读拒绝 | 状态拒绝 | 只读拒绝 | 拒绝 |
| relay 空过 | 无身份拒绝 | 状态拒绝 | 状态拒绝 | 只读拒绝 | 条件允许 F | 只读拒绝 | 状态拒绝 | 只读拒绝 | 拒绝 |
| 请求 rematch | 无身份拒绝 | 状态拒绝 | 状态拒绝 | 只读拒绝 | 状态拒绝 | 只读拒绝 | 条件允许 G | 只读拒绝 | 拒绝 |
| 主动离开 | 无身份拒绝 | 允许并关闭房间 | 允许并释放 seat | 允许 | 条件允许 H | 允许且不改变赛果 | 允许并使 rematch 不再可用 | 允许且不改变赛果 | 幂等拒绝 |
| 房主关闭房间 | 无身份拒绝 | 允许 | 非房主拒绝 | 只读拒绝 | 状态拒绝 | 只读拒绝 | 状态拒绝 | 只读拒绝 | 幂等拒绝 |
| 发聊天消息 | 无身份拒绝 | 条件允许 I | 条件允许 I | 条件允许 I | 条件允许 I | 条件允许 I | 条件允许 I | left 拒绝；connected spectator 条件允许 I | 拒绝 |
| 看房间/游戏状态 | 仅公开预检 | 允许 | 允许 | 允许 | 允许 | 允许 | 允许 | 保留期内允许只读终态 | 不允许 |
| 看聊天历史/实时 | 无身份拒绝 | 按当前 role 授权 | 按当前 role 授权 | 按当前 role 授权 | 按当前 role 授权 | 按当前 role 授权 | 按当前 role 授权 | retained member 按最后有效 role 只读授权 | 不允许 |

条件定义：

- A：目标房间未 closed 且未超过保留期。lobby 有 player 空位时签发 player 身份，否则签发 spectator；playing/finished 只能签发 spectator；spectator 已达 32 人则稳定拒绝，不创建 member 行。
- B：仅 connected spectator 本人可在 lobby、match 尚未创建且 `playerCount < playerLimit` 时认领；事务内复用原 `memberId`/token、分配最小可用 seat、设置 `ready=false`，随后旧 WS 必须失效。
- C：仅 race、match 未创建、当前无人 ready 且新值处于 2..8 并不小于当前 player 数时允许；relay 固定 2。降容须先按旧 seat、`memberId` 稳定压紧非房主 seat。
- D：当前 round 已进入 playing，race 中该 roster member 仍可参与且未超猜测上限；relay 中还必须轮到该 `turnMemberId`。
- E：当前 round 为 playing 且该 roster member 尚未 forfeited/left；race 只退出该小局，relay 保持两人判负规则。
- F：仅 relay 当前 round 为 playing、轮到该 `turnMemberId` 且其共享空过额度未触发判负前可提交；race 稳定拒绝。
- G：原 match roster 完整、无人 left、全员 connected 且由原 roster member 提交；每人确认幂等，全部确认后按原 roster 开新 match，任何新 member/spectator 均不能补位。
- H：race 离开等价于将该 roster member 标记 left 并退出当前小局，剩余 roster 按模式终态规则继续；relay 保持离开者判负。finished 离开保留终态记录但永久破坏该 roster 的 rematch 完整性。
- I：房间未 closed/过期、sender 为 connected member、内容与限流校验通过；服务端从当前 role 派生 channel，客户端只提交内容和幂等键。

角色变化和 member 状态变化必须在每次 REST 请求鉴权时重新读取；WS 不得在 claim-seat 后继续使用连接建立时缓存的 role/capability。公开 `memberId`、seat、昵称或某条历史消息都不授予任何矩阵外动作。

## 聊天 channel × 接收角色

发送请求只允许客户端提交 `clientMessageId`、`kind` 和对应内容。`senderMemberId`、displayName/role/seat 发送时快照与 channel 必须由服务端从 token 对应的当前 member 派生；请求中出现这些授权字段不能覆盖服务端结果，并应以稳定的非法请求错误拒绝。

| 服务端 channel | 唯一允许的发送者当前 role | player 接收实时/历史 | spectator 接收实时/历史 | 说明 |
|---|---|---|---|---|
| `room` | player | 可见 | 可见 | PK 玩家消息对本房间所有获授权 player 与 spectator 可见 |
| `spectator` | spectator | 不可见且历史查询不得返回 | 可见 | 观战者消息只在本房间 spectator 之间可见 |

发送者 × channel 的其他组合全部禁止：player 不能发送 `spectator`，spectator 不能发送 `room`，任何 member 都不能选择 `team`、`member` 或私聊范围。服务端授权投影必须同时用于 REST history、WS replay 和 WS realtime，不能依赖前端隐藏消息。

消息保存不可变的发送时 `senderMemberId`、displayName、role、seat 快照及派生 channel。seat 后续压紧或被新 member 占用不得改写历史发送者；member 行在 lobby 删除也不得级联删除消息。spectator claim-seat 后：

- 旧 WS 立即失效，不能继续以 spectator capability 接收或发送；
- 同一 token 重连后以 player 授权，后续消息只进入 `room`；
- 过去的 spectator 消息仍保留原快照和 `spectator` channel，但该 member 当前作为 player 不再获权查询或恢复它们；
- 重新成为某角色不会追溯改写消息 channel，也不会把不可见历史复制到新 channel。

retained left member 只可在房间保留期内按其最后有效 role 读取原本获授权的历史，不得发送；closed/已清理房间不再提供聊天访问。`receiveChat` 关闭不会改变本表中的接收授权。

## WS v2 游戏 sequence 与同步屏障

多人扩展直接使用子协议 `touhouflandre-multi.v2`。v1 的 `lastSequence` 不扩展；v2 hello 使用 `lastGameSequence`，并为聊天预留独立的可选 `lastChatCursor`。旧页面连接 v2 时必须在握手阶段失败并提示刷新，不能表面连接后忽略集合或控制帧。

`room_event.sequence` 是房间级、从 1 严格递增的游戏/生命周期序列。对于数据库中每个 sequence，服务端对每个已鉴权 observer 必须恰好投递以下一种游戏帧：

- observer 获权查看业务 payload：投递该业务 room event envelope；
- observer 不获权查看业务 payload，或事件对自己无需 reducer 处理：投递同 `eventId`、`roomId`、`sequence`、`occurredAt` 的 `room.cursor` envelope，不带业务 `payload`，也不泄露原事件类型。

因此任一连接看到的游戏 sequence 连续；授权投影不得通过“什么都不发”形成跳号。`room.cursor` 只推进游戏水位，不进入游戏 reducer、统计记录或用户通知。

v2 游戏同步帧冻结为：

| frame | 关键字段 | 语义 |
|---|---|---|
| `hello` | token、`lastGameSequence`、可选 `lastChatCursor` | 客户端提交上一次已完整确认的水位 |
| `hello-ok` | `targetGameSequence`、可选 `targetChatCursor` | 只确认鉴权成功和捕获的目标高水位，不代表重放完成 |
| room event | `eventId`、`roomId`、`sequence`、`occurredAt`、业务 type/payload | 授权后的游戏/生命周期事件 |
| `room.cursor` | `eventId`、`roomId`、`sequence`、`occurredAt` | 无业务 payload 的连续性占位帧 |
| `sync.complete` | `gameSequence`、可选 `chatCursor` | FIFO 中此前重放/缓冲均已交付，可提交完成水位 |
| `resync.required` | scope、reason、服务端当前水位 | hello 水位无效或历史不可连续恢复；客户端改拉权威 snapshot |

服务端建立连接的顺序必须为：

1. 校验子协议、Origin、hello 格式、token 与 room 绑定，但尚不向客户端宣告同步完成。
2. 先把连接注册为 buffering，再捕获数据库的 game high watermark；注册前不得先查历史。
3. 发送 `hello-ok`，按 sequence 查询 `(lastGameSequence, highWatermark]`，逐 observer 投影为业务事件或 cursor 并按序入 FIFO。
4. 丢弃缓冲中 `sequence <= highWatermark` 的重叠副本，按序排空更高 sequence；排空期间新事件继续进入同一缓冲队列。
5. 在连接队列锁内确认缓冲为空，把携带最后实际交付 sequence 的 `sync.complete` 放入 FIFO，再切为 live；此后实时帧只能排在 `sync.complete` 后面。

这一屏障同时覆盖注册前后、捕获水位、查询重放和排空期间的并发写入。重叠帧允许出现，但客户端以 roomId + sequence/eventId 去重并只应用一次；不得用“先查历史、再订阅”留下窗口。

客户端维护 `persistedGameSequence`（上次完整确认）与当前连接的 `appliedGameSequence`：

- 同步阶段收到 `sequence <= appliedGameSequence` 时去重；等于 `appliedGameSequence + 1` 时应用业务事件或仅推进 cursor；大于该值才是真缺口。
- 真缺口只启动一个 in-flight snapshot 对齐，暂停后续 reducer 并缓冲重叠帧；snapshot 返回权威 game watermark 后再按 sequence 去重排空，不能为同一缺口并发拉多次。
- 首个 `sync.complete` 之前不得覆盖 `persistedGameSequence`；若中途断线，下一次 hello 仍提交旧的完成水位。处理 `sync.complete` 后持久化其 `gameSequence` 并进入 live，之后每个连续且已应用的 live 游戏帧可推进持久化水位。
- snapshot/cursor 都不能被当作用户可见业务事件；chat frame 也不得改变任何 game sequence。

`lastGameSequence < 0`、高于当前 room 高水位、与 room 不匹配、格式错误或早于最老可重放事件时不得静默夹取到合法范围。协议版本/格式错误关闭连接；可通过完整 snapshot 恢复的情况返回 `resync.required`，客户端重置为 snapshot 明示的权威水位后重新握手。

## 独立聊天持久化、cursor 与本地闭麦

聊天必须使用独立的 `multi_chat_message`（或等价）持久化和房间内单调位置，不得写入 `room_event`、分配 game sequence 或作为 room event payload 搭车。消息成功提交数据库后才可广播；聊天写入失败不得产生实时帧。

### 消息模型与默认限制

持久化消息至少包含：`messageId`、`roomId`、`senderMemberId`、发送时 `senderDisplayName`/`senderRole`/`senderSeat` 快照、`clientMessageId`、`kind`、规范化内容、服务端派生 `channel`、房间内 chat position/cursor、`createdAt`。不公开预留删除、撤回、审核、team 或私聊字段。

首版产品默认值冻结如下：

| 项目 | 默认规则 |
|---|---|
| `kind=text` | CRLF/CR 先转 LF，再做 Unicode NFC 和首尾 Unicode 空白裁剪；结果须为 1..280 个扩展字素簇、UTF-8 不超过 1024 字节且最多 4 行 |
| 文本字符 | 允许普通文本与 Unicode emoji；拒绝除 LF 外的 C0/C1 控制字符及 U+202A..U+202E、U+2066..U+2069 双向覆盖/隔离控制；不解析 HTML 或 Markdown |
| `kind=emoji` | 只接受共享契约公布的单个快捷 emoji：😀、😂、😍、🤔、😭、😡、👍、👎、🎉、❤️、✨、🌸；服务端保存对应 Unicode 字符，不接受客户端自定义图片/URL |
| member 发送频率 | token bucket 容量 5，每 2 秒补 1 个；幂等重试不重复扣 token |
| room 聚合频率 | token bucket 容量 20，每 500 毫秒补 1 个；player 与 spectator 共用，防止 WS fan-out 被单一 channel 绕过 |
| 保留期 | 消息创建后最多 24 小时；room tree 更早删除时随 room 清理，closed 后即使物理行尚未清理也不再对外提供访问 |
| history 页大小 | 默认扫描 50 个原始位置，客户端可请求 1..100；服务端单次最多扫描 200 个原始位置以跨过不可见 channel |

规范化后的空消息稳定拒绝。服务端和客户端都必须把内容作为纯文本渲染；客户端转义是纵深防御，不能替代服务端大小/字符校验。超限返回稳定错误并可携带 `retryAfterMs`，不得把被拒绝内容写入日志。

发送以 `(roomId, senderMemberId, clientMessageId)` 唯一。首次成功插入后，相同 key 与相同规范化 payload 返回原消息，不再次广播或计入限流；同 key 不同 payload 返回幂等冲突，不能覆盖历史。

### 不透明 cursor 与分页

chat cursor 是服务端签发并完整性校验的 versioned opaque token，至少绑定 room、chat position、用途/方向和当前保留代际。公开协议不承诺其编码、数值连续性或可比较性：

- `after`/`lastChatCursor` 用于重连和向新方向扫描；`before` 用于加载更早历史，两种 token 不可互换。
- history `after` 请求捕获 chat high watermark 后，从 cursor 之后按原始 position 最多扫描一页，再按当前 viewer role 投影；响应消息按 position 升序。
- 响应必须返回服务端实际检查到的 `scannedCursor` 和相对所捕获高水位的 `hasMore`。即使这一页所有消息都因 channel 不可见而得到空数组，也推进 `scannedCursor`；客户端按 `hasMore` 继续，不能因空页停止。
- `before` 请求同样按绑定方向扫描更早位置，返回升序消息和新的 `beforeCursor`；不得用当前可见数组下标或时间戳作为下一页位置。
- REST history、WS replay 与 realtime 必须复用同一授权投影和 cursor 校验。WS `chat.message` frame 携带 `messageId` 与服务端 cursor，不含 game sequence；客户端以 roomId + messageId/cursor 去重。

cursor 格式/签名错误、属于其他 room/方向/代际、超过当前 high watermark 分别稳定返回 `CHAT_CURSOR_INVALID` 或 `CHAT_CURSOR_AHEAD`。cursor 早于最老保留位置时返回 `CHAT_RESYNC_REQUIRED` 及服务端签发的 `oldestAvailableCursor`/当前 high watermark；不得静默跳到开头或当前而掩盖历史缺失。

v2 hello 的可选 `lastChatCursor` 与 `lastGameSequence` 进入同一个连接屏障：先注册同时缓冲游戏和聊天，再分别捕获高水位和授权重放，排空两类缓冲后在 FIFO 队尾发送一个 `sync.complete(gameSequence, chatCursor)`。`chatCursor` 是已扫描而非最后一条可见消息的位置；即使 player 无权看到期间全部 spectator 消息也必须推进。同步中途断线时两种水位都保持上一次完成值。

### `receiveChat` 本地语义

`receiveChat` 是当前浏览器 localStorage 中的 viewer 偏好，默认 true，不同步到服务端：

- false 时不渲染他人的获授权消息，但自己的、且按当前 role 仍获授权的消息继续显示；隐藏消息仍可计入本地未读提示。
- 客户端仍接收实时帧、查询授权历史、处理空页并推进 `lastChatCursor`；不得通过停止同步实现闭麦。
- 重新开启后，可以从仍在内存缓存或 24 小时服务端保留范围内恢复获授权消息；超出保留期不承诺恢复。
- 偏好不改变发送 channel、服务端投影、其他 viewer 的显示、任何 game sequence 或 chat cursor。
- role 变化时先按新 role 清理/重建可见缓存，再应用该偏好；本地曾缓存的 spectator 消息不能在 claim-seat 后以 player 身份重新显示。

## 隐私投影与可观察元数据

授权边界由服务端投影保证，前端不得接收后再隐藏。race 进行中，player 对其他每名 subject player 只能得到按 `memberId` 分组的匿名反馈矩阵；以下数据在 `round.ended` 明确揭示前均属于隐藏数据：

- 对手每次猜测的 character ID、角色名、别名、头像、作品 ID/名称/代码、搜索文本或任何可反查角色的标识；
- 字段标签、字段原始值、标签值、比较输入及能把匿名列还原为具体字段的映射/种子；
- 答案角色、内部数据库键、token/hash、幂等键、未公开 capability 和其他 channel 的消息；
- 可将两个 observer 的匿名矩阵关联后恢复字段含义的共享置换。

每个对手矩阵的列置换必须稳定到当前 round + observer + subject，且彼此隔离。种子使用服务端秘密通过 HMAC 派生：`HMAC(secret, roundId || observerMemberId || subjectMemberId || schemaVersion)`；secret、原始字段顺序和派生结果不得进入 wire、日志或客户端代码。只对公开 ID 做无密钥哈希不可接受，因为客户端可以复算映射。

以下内容是玩法所需或传输层不可避免的可观察元数据，可以用于 UI，但文档、产品文案和安全声明不得承诺隐藏：

- 公开 roster 的 `memberId`、displayName、seat、role、连接/准备/left 状态以及公开比分；
- 某个 subject 已发生猜测的数量、匿名状态行、行序和是否达到公开猜测上限；
- room event/cursor 的 sequence、`occurredAt`、帧大小级别和客户端实际收到帧的时间；cursor 只隐藏业务类型/payload，不隐藏“房间发生了一个事件”；
- round/match 的公开倒计时、终态、胜者与结束原因；`round.ended` 后按规则揭示的答案和完整棋盘。

spectator 依据矩阵获权查看所有完整棋盘，但这项权限不扩展到 token、内部身份或 player 无权查看的 spectator channel。viewer 从 spectator claim-seat 为 player 后必须立即重新投影，旧连接和缓存不能继续提供 spectator 游戏/聊天视图。

隐私回归至少包含：对 player 的每个 opponent payload 做递归 denylist 检查、验证不同 observer/subject 的列置换不可相关、验证 spectator 完整视图的正例、验证 cross-room token/memberId 与伪造 sender/channel 均不能扩大权限。浏览器本地多人统计只保留 `self`/`other` 归一化结果，落盘和导出剥离 `memberId`、displayName、roomId、roomCode 与 token。

## Issue 依赖与完成定义追踪

下表把每个实现节点绑定到本文的不变量。各 Issue 的验收清单仍是完整完成定义；本表列出其进入下一节点前必须证明的决策结果。

| Issue | 直接依赖 | 必须保持的不变量 | 决策层完成定义 |
|---|---|---|---|
| [MPX-002A](./MPX-002A-member-seat-data-foundation.md) | MPX-001 | memberId 是身份键、seat 仅排序；race 上限 8、relay 2、spectator 32 | 旧双人/观战数据升级后公开模型以 memberId + seat 集合表达，默认 `playerLimit=2` 且数据库/生成类型无漂移 |
| [MPX-002B](./MPX-002B-ws-v2-game-sync-foundation.md) | MPX-002A | v2 每个 game sequence 为业务事件或 cursor；屏障末尾才 `sync.complete` | race/relay 双人流程在 v2 连续重放，并对真缺口单次 snapshot；无效水位不被静默接受 |
| [MPX-002C](./MPX-002C-foundation-regression-gate.md) | MPX-002B | 002A 数据底座与 002B 同步语义组合后仍一致 | 迁移、生成、两人 race/relay、观战、finished retention、cursor/重连全绿并形成 MPX-003 可复用基线 |
| [MPX-003](./MPX-003-room-lifecycle.md) | MPX-002C | room 行锁线性化 join/claim/final ready；2..`playerLimit` 灵活开局 | 并发结果只出现本文两种提交顺序，seat/capacity/role 变化不越权，原 roster rematch 不可补位 |
| [MPX-004](./MPX-004-n-player-race-engine.md) | MPX-003 | race 按 roster memberId 独立计分；relay 保持两人；对手隐私由服务端投影 | 2/3/4/8 人竞速终态、并发胜者、离场/超时与 HMAC 匿名矩阵测试通过，旧双人结果不变 |
| [MPX-005](./MPX-005-race-player-limit-setting.md) | MPX-004 | 上限是容量而非开局目标；仅 lobby host 且无人 ready 可改 | 2..8 配置、降容压紧、claim-seat 及与 join/ready 的并发终态和事件视图一致 |
| [MPX-006](./MPX-006-n-player-race-web-ui.md) | MPX-004、MPX-005 | Web 只以 memberId 关联、seat 仅展示；player 看匿名对手 | 桌面/移动 2/3/4/8 人、claim-seat/压紧/重连及统计迁移通过，落盘/导出无成员或房间身份 |
| [MPX-007](./MPX-007-chat-policy-and-protocol.md) | 逻辑依赖 MPX-002B；合并顺序在 MPX-005 后 | channel 完全服务端派生；chat cursor 独立且不透明 | sender/channel/receiver、内容限制、cursor、空页扫描、屏障与威胁模型均能直接生成 MPX-008 授权测试 |
| [MPX-008](./MPX-008-chat-backend-pipeline.md) | MPX-007 | 消息先持久化后广播，不进入 room_event；history/replay/realtime 共用投影 | 幂等、限流、24 小时保留、channel 授权、cursor 异常和 game/chat 无缺口屏障集成测试通过 |
| [MPX-009](./MPX-009-chat-web-and-mute.md) | MPX-008 | `receiveChat` 只影响本地渲染；role 变化清除过期权限缓存 | 历史/实时去重、空页推进、闭麦/未读、claim-seat 重建、移动端与 XSS 回归通过 |
| [MPX-010](./MPX-010-integration-security-rollout.md) | MPX-006、MPX-009 | 本文全部安全、并发、迁移、协议和隐私不变量 | 全量自动化、容量/fan-out 性能、v1 排空、灰度与生产保留 expand schema 的回滚演练通过后方可默认开放 |

关键安全语义在 MPX-001 已全部冻结：角色与 seat 生命周期、容量硬上限、开局/并发顺序、N 人离场、rematch 完整性、channel 授权、消息字符/大小/频率/保留期、game/chat 水位、role 变化重鉴权和隐私元数据边界均不得留给实现临时决定。允许后续 Issue 自行选择的仅是不会改变 wire/授权语义的内部函数拆分、索引名称、组件视觉细节和等价存储优化。

团队归属、队内轮流、团队计分、队内聊天、N 人 relay、私聊和账号身份均不属于本轮。不得创建 `team` 表、`teamId` 字段或可由客户端选择的 `team`/`member` channel；需要这些能力时必须另开设计 Issue。

## 被否决的替代方案

| 方案 | 不采用原因 |
|---|---|
| 用 seat/slot 作为玩家身份 | lobby 压紧 seat 会改变展示顺序，数组与历史状态会错配；稳定关联必须使用 `memberId` |
| 把 `playerLimit` 当作开局目标人数 | 会让 8 人房间无法以 3、5 人开始，也无法由房主用 ready 明确结束等待 |
| 继续增加 `slot3/slot4` 和动态 JSON key | 生成类型、排序、迁移和 8 人展示不可维护；wire 集合统一为带 `memberId` 的数组并按 seat 排序 |
| 本轮预建 team/私聊模型 | 没有已冻结的团队玩法消费者，却会扩大迁移、权限、投影和游标安全面 |
| 由客户端提交 capability/channel | 可伪造越权范围；服务端必须从令牌绑定 member 和当前状态派生 |
| 用 game sequence 承载聊天 | 不可见 spectator 消息会为 player 制造假缺口，聊天历史也无法独立分页与保留 |
