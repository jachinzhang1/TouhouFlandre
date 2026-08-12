# MPX-006：适配 N 人竞速的房间、棋盘与观战界面

**类型**：功能/Web Issue  
**优先级**：P1  
**依赖**：MPX-004、MPX-005  
**建议标签**：`type:feature` `area:web` `area:a11y`

## 要解决的问题

现有 `RoomPage`、`MatchBoard`、`SpectatorRaceBoards` 和状态 hook 仍通过 `playerSlot: 1 | 2`、`slot1/slot2` 和双栏布局组织视图；`apps/web/src/stats/` 也把多人记录保存为 `scoreSelf/scoreOpponent`。三名以上玩家加入后，页面和本地统计都必须按稳定 memberId 工作，不能因数组重排错配身份。

## 目标

将 Web 状态和组件改为集合驱动：玩家列表按 seat 展示，所有关联以 memberId 为键；自己的棋盘突出显示，对手棋盘按响应式网格/折叠分页显示，观战者可查看所有玩家的完整棋盘。移动端必须可滚动且保留当前行动、胜者和连接状态。

## 属于本 Issue

- `useRoom`/`multiRoom` 类型、localStorage 房间凭据和事件 reducer 从 slot1/slot2 改为稳定 memberId + 集合；游戏 sequence 真缺口触发 snapshot，cursor 只推进水位。
- `MultiLobby`/`RoomLobby` 的 `playerLimit` 上限控件、剩余席位、当前/上限人数、玩家名单、满员后 spectator 状态、claim-seat 控件、无席位和断线状态；文案明确“不必满员，至少 2 人且全员准备即可开始”，也不暗示提高上限会自动晋升观战者。
- race 玩家棋盘、结果层、历史记录、当前回合/倒计时和观战归档的 N 人渲染。
- 本地多人统计升级：新增 schema version 和导入兼容，将 `scoreOpponent` 改为不带身份的对手比分列表（或等价集合形态），记录实际 roster size、playerLimit 与本人结果；self memberId 只用于运行时定位自己的棋盘/比分，持久化统计把成员引用归一化为 `self`/`other`，并剥离所有 memberId、displayName、roomId、roomCode 和令牌。恢复中的草稿只能使用不导出的本地不透明 source key，结束后删除。既有 v3 双人记录继续可读。
- ready/unready 控件反映可取消准备的 lobby 状态；房主界面提示“保持未准备可继续等人，准备后若当前全员已准备将立即开局”。
- 可访问性、键盘操作、空状态、加载/错误/重连状态，以及组件/Playwright 视觉回归。

## 不属于本 Issue

- 不重新定义 API/WS 字段或服务端胜负逻辑；发现契约问题应回到 MPX-004/005。
- 不实现 relay N 人布局。
- 不加入聊天面板；聊天 UI 属于 MPX-009。

## 验收标准

- 2、3、4、8 名玩家在桌面和移动视口均能看到稳定、不按事件到达顺序重排的棋盘和状态；8 人长棋盘不会一次渲染全部不可见内容造成明显卡顿。
- 玩家视角继续隐藏对手敏感字段；观战视角显示完整棋盘但不出现玩家操作按钮。
- 玩家离开、spectator 加入、重连、round/match 结束和历史回看不会因数组顺序变化而错配身份。
- lobby 降容导致非房主 seat 压紧时，组件仅更新展示顺序，准备状态、凭据、棋盘和统计草稿仍按 memberId 关联。
- lobby spectator 认领空席位后沿用同一 memberId 切换为未准备 player，并在 `member_changed` 后自动用原 token 重连、更新本地角色凭据；并发失败、房间刚开局和席位刚被占用都有可恢复提示，playing/finished 不显示认领入口。
- N 人 race 正确写入并展示本地统计，旧双人统计导入/聚合无回归，落盘和导出不包含令牌、房间标识或任何成员身份；relay 保持两人规则和既有展示行为，并消费共享 member 集合。
- `pnpm typecheck`、Web 单测、多人 Playwright e2e 和关键 viewport 截图检查通过。

## 可能涉及的代码

`apps/web/src/hooks/useRoom.ts`、`apps/web/src/domain/multiRoom.ts`、`apps/web/src/components/{MultiLobby,RoomPage,RoomLobby,MatchBoard,RelayMatchBoard,OpponentBoard,MatchResultOverlay,RoundResultOverlay}.tsx`、`apps/web/src/stats/{types,db,multiplayerRecorder,aggregate,transfer}.ts` 及相关测试/样式。
