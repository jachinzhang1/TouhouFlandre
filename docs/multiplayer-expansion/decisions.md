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

