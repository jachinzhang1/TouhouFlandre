# MPX-006：N 人竞速积分淘汰与 Web 体验

**类型**：功能/全栈 Issue

**优先级**：P1

**依赖**：MPX-004、MPX-005

**建议标签**：`type:feature` `area:api` `area:web` `area:contract` `area:a11y`

**决策依据**：[术语与生命周期](./decisions.md#术语与生命周期)、[WS v2 游戏 sequence 与同步屏障](./decisions.md#ws-v2-游戏-sequence-与同步屏障)、[隐私投影与可观察元数据](./decisions.md#隐私投影与可观察元数据)

## 要解决的问题

MPX-005 已提供 2..8 人竞速 roster 与容量操作，原 MPX-006 Web 实现也已把 slot 状态迁移为 `memberId + 集合`。实际试玩后仍有两类缺口：一是 N>2 继续套用双人 BO 胜场规则，首位猜中后立即结束，无法形成真正的多人竞争；二是容量、对手分页、放弃反馈、历史入口和本地统计尚未完整表达积分淘汰状态。

本 Issue 因此扩展为服务端规则、数据库、OpenAPI/WS、Web 与本地统计的同分支交付。WS 仍保持 v2，但新增字段必须同步源契约、生成物和协议检查。

## 目标

- race 实际开局 N=2 时保留 BO 规则，N>2 时冻结为 placement scoring mode；relay 规则不变。
- 多人竞速按完成顺序计分，从 `floor(N/2)` 局开始淘汰，并以完整共享名次排行榜结束整场。
- Web 以 memberId 展示积分、参与状态、淘汰状态和历史，不允许淘汰玩家继续执行游戏操作。
- 本地统计升级为 v5，保存匿名的多人积分结果和每局参与状态，同时保持身份字段零泄漏。

## 属于本 Issue

### 服务端规则与数据

- race 单局时限为 300 秒，relay 继续使用 900 秒整局时限。
- N>2 race 的 match 固化 `scoringMode=placement`、`rosterSize=N`、`maxRounds=3N`；每局固化 `activePlayerCount=n`。
- 第 m 名正确完成者获得 `n-m+1` 分；放弃、离场、耗尽次数或超时为 0 分。首位猜中后本局继续，直到所有参与者终态或截止时间到达。
- round 行锁串行分配唯一 `finishRank`，幂等重试不重复排名或加分。
- 从 `floor(N/2)` 局开始，按最低累计积分、最低历史最高单局积分依次筛选淘汰者；仍并列时成组淘汰，全员同为候选时不淘汰。
- 每局结算后按剩余人数、两人积分差和 `3N` 上限判断整场终态；按总积分生成 `1、1、3` 式共享名次，只有唯一第一名设置 `winnerMemberId`。
- 对局中离场或断线宽限逾期标记 `left`，当前局 0 分。playing/finished 阶段新加入者始终为 spectator，claim-seat 只允许 lobby。
- `0011_race_elimination_scoring.sql` 扩展 match、match player 和 round player 的积分、状态、完成名次与淘汰数据；旧 wins 列保留用于兼容。

### 契约与投影

- `MatchView`/`match.started` 包含 `scoringMode`、`rosterSize`、`maxRounds`；比分包含 match player 状态、最高单局积分和淘汰局。
- `RoundView.self` 包含权威 participation status 与可选 finish rank；`round.started` 包含 `activePlayerCount`。
- `round.ended` 包含每人完成状态、名次、本局得分和 `eliminatedMemberIds`；`match.ended` 包含完整 ranking。
- 淘汰或 left 玩家保留 player 身份，但获得 spectator 等级的完整棋盘投影；active 玩家继续只能消费匿名 `opponents[].rows`。
- WS 子协议保持 `touhouflandre-multi.v2`，sequence、cursor、snapshot 补齐和 replaced 语义不变。

### Web 与统计

- 创建页和房主大厅使用原生 range 控件调整 2..8 人上限；大厅下限为 `max(2, playerCount)`，显式应用并等待服务端确认。
- BO segmented control 保留并标记为“双人赛制”；实际 N>2 开局后，棋盘和结果只显示积分制、当前局和剩余人数。
- active 玩家进行中只挂载一张对手棋盘；局末、历史和 spectator 保持桌面每页两张、移动端每页一张。
- 历史栏位于棋盘上方，“返回当前局”始终显示并使用 `aria-pressed`；选中项使用结果色边框，积分局显示本局得分与淘汰状态。
- 放弃请求发出后立即禁用输入，成功后从权威 participation status 保持只读提示；刷新和重连同样恢复猜中、放弃、耗尽、超时和淘汰状态。
- 淘汰玩家的计分块使用红色状态样式，页面复用只读 spectator 棋盘；最终结果展示完整共享名次排行榜。
- 统计 schema v5 / Dexie v4 记录 scoring mode、本人最终名次、并列第一、淘汰局以及每局得分/完成状态；导入兼容 v1-v5，导出仅 v5，草稿不导出。

## 不属于本 Issue

- 不把 relay 扩展为 N 人。
- 不加入聊天面板或聊天协议；聊天属于 MPX-007 至 MPX-009。
- 不升级 WS 协议版本，不新增虚拟列表依赖。
- 不将本分支直接合入 `main`；完成后合回 `feature/multipalyer_mode_backend`。

## 验收标准

- N=3..8 的积分、唯一完成名次、淘汰阈值、成组淘汰、离场、两人差距终止、`3N` 上限和共享冠军均有规则测试。
- 两人 race 和 relay 的原有 BO/共享棋盘行为无回归。
- playing/finished 阶段所有新加入者只能观战；淘汰者能看到完整棋盘，但猜测和放弃均被服务端拒绝，active 玩家投影不泄露角色或字段值。
- 两处 range 控件、单对手 DOM、历史栏与选中边框、放弃即时反馈、刷新恢复、淘汰计分块和完整排行榜有 Web 测试。
- 本地统计 v1-v5 迁移、匿名多人比分、最终名次、逐局积分和递归隐私断言通过。
- WSL 中通过 typecheck、workspace 单测、Web build、OpenAPI/WS 检查、完整 Go 测试和 desktop/Pixel 7 Playwright；Windows PowerShell 中确认 Git diff 与工作树无意外生成物。

## 主要代码

- 服务端：`apps/api/internal/{handler,multi}/`、`apps/api/sql/queries/multi.sql`、`apps/api/migrations/0011_race_elimination_scoring.sql`
- 契约：`contracts/openapi/schemas/multi-*.yaml`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts`
- Web：`apps/web/src/hooks/useRoom.ts`、`apps/web/src/components/{MultiLobby,RoomLobby,RoomPage,MatchBoard,MemberPaginator,MemberScoreStrip,MatchResultOverlay,GuessInputBar}.tsx`
- 统计：`apps/web/src/stats/{types,db,multiplayerRecorder,transfer}.ts`、`apps/web/src/components/StatsDashboard.tsx`

## 实施与验收记录（2026-08-14）

`feat/mpx-6-race-web` 建立在 MPX-005 完成提交 `33fbe24` 上；原 N 人 Web 迁移已作为 `8d7ec8c feat(web): add n-player race experience` 独立提交。本轮在其上扩展 `0011` 迁移、placement scoring engine、契约字段、淘汰只读投影、Web 交互和统计 v5。

WSL 实测结果：

- `0011` 迁移与 Go seed 成功；完整 Go 测试通过，覆盖 N=3..8 积分/淘汰、并发唯一名次、离场、round cap、共享名次和投影隐私。
- `pnpm typecheck`、workspace 单测（shared 10、data 26、Web 115）、Web production build、OpenAPI lint/ref 检查与 WS protocol 检查通过。
- 真实 WSL API/PostgreSQL 上的 Playwright 多人套件通过：desktop Chromium 16/16、Pixel 7 16/16，共 32/32。
- 视觉基线共 10 张，覆盖 desktop/Pixel 7 的 8 人大厅、进行中单对手棋盘、spectator 完整棋盘、淘汰只读视图和最终排行榜；均断言无页面横向溢出。

`task db:seed` 的前置题库校验仍会因既有 `秋姐妹` 搜索名同时属于 `shizuha_aki` 与 `minoriko_aki` 而失败；本次改动未触及题库，验收使用成功执行的 `task db:seed:go` 刷新开发库。该独立数据问题不并入 MPX-006 修复范围。

分支合并前需与 MPX-007 至 MPX-009 协调迁移编号：本分支占用 `0011`，聊天分支 rebase 后应使用下一可用编号。
