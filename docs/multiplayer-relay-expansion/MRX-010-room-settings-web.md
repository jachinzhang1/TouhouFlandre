# MRX-010：交付接力创建页与大厅配置体验

**类型**：功能/Web Issue  
**优先级**：P1  
**依赖**：MRX-004  
**状态**：已完成

**建议标签**：`type:feature` `area:web` `area:a11y` `area:test`

**决策依据**：[房间配置与开局](./decisions.md#3-房间配置与开局)、[灰度与可观测性](./decisions.md#18-灰度与可观测性)

## 要解决的问题

创建页只在 race 显示 2..8 连续人数滑杆，大厅把 relay 写成“固定 2 人”，也没有淘汰设置或奇数人数阻塞反馈。需要复用稳定控件原语，同时为 relay 暴露独立的模式设置；不能复制 race 表单布局，也不能让两个模式共享同一份淘汰语义、草稿状态或说明文案。

## 要做到什么程度

- 抽取可复用的 `PlayerLimitControl`，由 mode-specific form adapter 提供 allowed values、min/max/step；race 保持 step 1，relay 使用 step 2。
- 创建 relay 时显示 2/4/6/8 人上限滑杆和一个明确的淘汰 `switch`；默认关闭。
- switch 可复用无业务含义的控件 primitive，但 race 绑定 `raceEliminationEnabled`，relay 绑定 `relayEliminationEnabled`；切换 mode 时清理或隔离另一模式草稿。
- 房主大厅可在服务端允许时修改两项设置，使用单次原子 PATCH；请求期间禁用并以权威响应回填。
- 有人 ready 后控件锁定；奇数 roster 全员 ready 时显示服务端 `startBlockedReason`，不伪造倒计时。
- 大厅人数/空席/观战/准备列表复用现有 N 人布局，移除 relay “固定 2 人”的硬编码。
- feature flag 关闭时隐藏 N 人控件并维持双人 relay；后端拒绝仍是最终保护。
- 控件具备 label、value output、键盘操作、focus、disabled 和错误 live region。

## 属于本 Issue

- `MultiLobby` 创建表单、`RoomLobby` 房主设置、共享人数/无语义 switch primitive 和 mode-specific setting section。
- API client、表单状态、错误映射、rollout config 和组件/Playwright 测试。
- 2/4/6/8 人大厅的桌面/移动视觉基线。

## 不属于本 Issue

- 不实现游戏中棋盘、积分、轮空或最终排名；MRX-012 负责。
- 不在前端重新判断能否开局；只根据权威 room projection 展示。
- 不改变 race 的控件范围和积分赛说明。
- 不把 `RaceEliminationSwitch` 的竞速人数判断或文案直接用于 relay；仅可下沉无玩法语义的展示 primitive。
- 不在 flag 关闭时发送隐藏的多人 relay 设置。

## 验收标准

- relay 滑杆只能产出 2/4/6/8，键盘方向键步进 2；race 仍可产出 2..8 的每个整数。
- 创建与大厅 relay switch 默认/保存/刷新/重连状态一致；请求只发送 `relayEliminationEnabled`，实际 2 人开局时 UI 结果仍显示传统 BO。
- 设置请求原子失败时两项本地草稿不会部分显示为已应用，错误可被辅助技术读出。
- 奇数玩家、存在未准备/离线玩家、配置锁定和 settings 竞争均展示服务端权威状态。
- 8 人昵称、ready 状态、空席与 spectator 数在桌面/移动无重叠和横向页面溢出。
- flag 关闭后双人 relay 创建/大厅/ready 流程与当前版本相同。
- race 设置组件测试在 relay Web module 未启用时仍全部通过；两种开关同页切换不会相互污染。

## 可能涉及的代码

`apps/web/src/components/{MultiLobby.tsx,RoomLobby.tsx,PlayerLimitControl.tsx}`、mode-specific room settings components、`apps/web/src/config/multiplayerRollout.ts`、transport DTO adapter、相关 component/e2e tests。

## 实施与验收记录（2026-08-25）

本 Issue 已完成。创建页与房间大厅现分别维护 race/relay 草稿；relay 开启 Web rollout 后提供 2/4/6/8 人上限与独立淘汰开关，房主可在无人 ready 时用一次 PATCH 原子保存两项设置。大厅直接展示服务端投影的 `relayEliminationEnabled` 与 `startBlockedReason`，请求失败会同时回滚两项草稿并通过 live region 报错；2 人配置仍显示传统 BO 语义。关闭 relay Web rollout 时不显示或发送隐藏设置，双人创建和 ready 入口保持可用。

主要交付面：

- 新增无玩法语义的 `PlayerLimitControl`、`SettingSwitch`，race/relay adapter 分别约束 step 1 与 step 2，并由独立开关组件提供各自说明与状态。
- `MultiLobby` 隔离 race/relay 人数和淘汰草稿；`RoomLobby` 使用权威响应回填、ready/busy 锁定与原子失败回滚，并移除 relay “固定 2 人”硬编码。
- API client、`useRoom` reducer/snapshot 与 `RoomPage` 已贯通 `relayEliminationEnabled`、`startBlockedReason`；新增四个默认关闭的 API/Web rollout 环境变量。
- 2/4/6/8 人 relay 大厅覆盖 desktop Chromium 与 Pixel 7 视觉基线；长昵称、ready/在线状态、空席、spectator 与聊天区无重叠或页面横向溢出。

验收与验证：

- 基线 `pnpm --filter @touhouflandre/web test` 为 33 files / 154 tests，通过；实现后同命令为 33 files / 172 tests，通过。
- `pnpm --filter @touhouflandre/web typecheck`、`pnpm --filter @touhouflandre/web build`：通过。
- `pnpm exec prettier --check <MRX-010 TypeScript files>`：通过；`.env.example` 无可推断的 Prettier parser，已由 `git diff --check` 覆盖空白检查。
- `pnpm lint:openapi`、`pnpm check:openapi-refs`、`pnpm check:ws-protocol`：通过。
- `PLAYWRIGHT_USE_WEB_SERVER=0 pnpm --filter @touhouflandre/web exec playwright test e2e/multiplayer.spec.ts --grep "N 人接力房间设置"`：desktop/Pixel 7 共 14/14 通过；8 张截图逐一检查通过。
- 完整 multiplayer E2E 为 46/48 通过；两项失败均为既有 `接力模式共享棋盘与轮次锁定` 在进入 playing 后等待旧 `round.started`，服务端 relay stage/encounter 已启动但 MRX-012 Web 棋盘尚未消费其投影。将服务端 `MULTI_N_PLAYER_RELAY_ENABLED`、`MULTI_RELAY_ELIMINATION_ENABLED` 关闭后该断言仍以相同方式失败；创建、加入、ready 与 `match.started` 均成功，因此不属于本 Issue 的创建页/大厅回归，游戏中棋盘继续明确留给 MRX-012。
- `task db:migrate` 以 expand-only 方式应用现有 0015..0019；`go tool goose -dir migrations status` 确认数据库位于 version 19。未运行会清理旧题库行的 seed；现有题库版本 `aaa89ada`（36 部作品、139 名角色）足够完成 E2E。

本 Issue 未修改 OpenAPI/WS 源契约或数据库 schema，复用 MRX-004 已交付字段与投影。回滚只需先关闭两个 `NEXT_PUBLIC_*` Web 开关并重新构建，再关闭两个 API 开关；已有房间数据保持可读，无需迁移回滚。MRX-012 的接力游戏中棋盘、分页、积分、轮空与排名仍未在此实现。
