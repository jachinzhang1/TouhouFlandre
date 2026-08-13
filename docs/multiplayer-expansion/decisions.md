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
| `maxSpectatorsPerRoom` | 单房间未离开 spectator 的服务端安全上限 | 首版固定 32，不可由房主设置，不占 `playerLimit`；用于限制成员行、WS 连接和广播扇出 |
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
| final ready vs join | final ready 冻结当时 roster 并将房间转为 playing | join 重新读到 playing，只能在 spectator cap 内加入为 spectator | 新 member 不进入 roster |
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
