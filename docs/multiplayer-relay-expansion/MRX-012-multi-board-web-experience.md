# MRX-012：交付多人接力单棋盘浏览、结算与本地统计

**类型**：功能/Web Issue  
**优先级**：P0  
**依赖**：MRX-010、MRX-011  
**状态**：已完成

**建议标签**：`type:feature` `area:web` `area:a11y` `area:stats` `area:test`

**决策依据**：[投影、能力与页面状态](./decisions.md#16-投影能力与页面状态)、[历史与负载边界](./decisions.md#17-历史与负载边界)

## 要解决的问题

当前 `RelayMatchBoard` 只渲染一张 shared board，局末由 overlay 主导；spectator 历史按 round archive 选择。多人接力需要在同一 stage 浏览 1..4 张棋盘、等待其他 pair、查看历史和全员积分，同时保证动作永远指向自己的 encounter。

## 要做到什么程度

- 建立 relay-owned `RelayStageView`/selector/reducer，把当前 stage、encounters、viewer capability、历史选择和 standings 从共享 `RoomPage` shell 分离；不改变 race board reducer。
- 当前与历史都每页只挂载一张棋盘；使用上一张/下一张图标按钮、页码/对阵选择菜单和键盘可达控制。
- 每张棋盘左上角显示 `{user_A_name}({seat}) vs {user_B_name}({seat})`；顺序按 encounter side 固定。
- 顶部 `MemberScoreStrip` 扩展为多人接力积分、near-death、eliminated、left、bye 和最终共享名次，长列表可扫描且不遮挡。
- own encounter 进行中且当前选中该棋盘、轮到本人时才启用 guess/pass/forfeit；浏览其他棋盘、bye、已完成、淘汰和 spectator 全部只读。
- own encounter 结束后使用非阻塞状态条提示“你已猜中本局”或“对手已猜中本局”等，不弹出遮挡棋盘的对话框；可立即继续翻页/看历史。
- history 先显示紧凑 stage/encounter 索引，选择后按需请求详情，并提供“返回当前轮”。
- 本地统计升级到 v6，使用 `multiplayerMode + ruleSetKey + ruleSetVersion` 判别；relay score/delta 允许负数，匿名记录最终名次/存留轮数、每 stage 积分变化、bye 和本人 encounter outcome，不保存房间/成员/对手身份。
- stats v1-v5 先通过兼容 adapter 标准化；race `scoringMode` 继续可导入导出，但 v6 聚合不得把 race points 与 relay fixed-points 当成同一规则。

## 属于本 Issue

- RoomPage 状态拆分、relay stage/encounter board、paginator/history、score strip、result/ranking 和 input capability。
- loading/empty/error/reconnect/finished/retention 状态及桌面/移动响应式布局。
- stats v6 discriminated schema/migration/import/export、component tests、hook tests、Playwright 与视觉基线。
- 现有双人 relay 在新组件上的等价展示。

## 不属于本 Issue

- 不在客户端重新计算积分、濒死、淘汰、配对或胜负。
- 不预加载并永久挂载全部历史棋盘。
- 不在 player 视图匿名化其他 relay 棋盘。
- 不修改 race 多棋盘布局、聊天协议或服务端规则。
- 不让共享 `RoomPage` 或 stats 聚合读取 near-death/encounter 字段来推导玩法；它们只分派 mode fragment。

## 验收标准

- 2/4/6/8 人当前 stage 的 DOM 中始终最多一张棋盘表格；翻页不改变顶部积分或自己的动作状态。
- 对阵标题精确包含双方 displayName 和 seat/no；重复昵称仍可由 seat 区分。
- 浏览其他棋盘时输入不可用；返回自己的 active encounter 后按服务端 capability 恢复，不能把猜测提交到当前浏览的他人 encounter。
- own/opponent 正确、平局、forfeit、timeout、等待其他棋盘、bye、near-death、eliminated 和 final ranking 均有可访问状态提示且无阻塞模态。
- 玩家和 spectator 都看到完整标签；刷新/重连后恢复所选范围、当前 turn、已完成棋盘和 stage 等待状态。
- 历史按需加载可浏览任意已结束 stage/encounter，并能一键返回当前；错误重试不重复插入缓存。
- stats v1-v6 导入后统一为 v6；race v5 记录的 `scoringMode` 语义保持不变，relay 记录包含完整 rule-set discriminator；导出不包含 `roomId/memberId/encounterId`、昵称、seat 或 token。
- 移除/关闭 relay Web module 后，race 房间页面和 stats v1-v5 fixture 仍可编译运行。
- desktop 与 Pixel 7 视觉/e2e 无页面横向溢出、按钮文字截断、积分条遮挡或棋盘/输入重叠。

## 可能涉及的代码

共享 `RoomPage` shell/通用控件、relay mode 下的 board/stage/paginator/history/selector/reducer、mode fragment transport adapter、`apps/web/src/stats/`、`apps/web/e2e/multiplayer.spec.ts`；race components/reducer 仅做回归或必要的装配点调整。

## 实施与验收记录（2026-08-25）

本 Issue 已完成。Relay 游戏中页面现由独立 `RelayStageView`、projection selector/reducer 与按需 history hook 拥有；当前轮和历史轮都只挂载一张 encounter 棋盘，支持菜单、前后翻页和一键返回当前轮。对阵标题按服务端 side 固定显示双方昵称与 seat；2/4/6/8 人积分条展示 active、near-death、eliminated、left、bye 与共享最终名次。结果、等待、轮空、淘汰和最终排名均使用页面内可访问状态区，不再用 relay 局末模态阻塞棋盘。

动作只在当前选中本人 active encounter 且服务端投影允许时启用，并显式携带 `stageIndex + encounterId`；浏览其他棋盘、历史、bye、已结束、淘汰和 spectator 均只读。Projection 按 encounter 增量更新，前台计时与刷新恢复已接入本人 encounter；sessionStorage 选择以 `roomId + matchIndex` 隔离，保留逐步到达的 summary encounter，并在新 match 无缓存时回到当前本人棋盘。

本地统计已升级到 v6：多人记录使用 `multiplayerMode + ruleSetKey + ruleSetVersion`，race 继续保留 `scoringMode`，relay 支持负分、本人每 stage 的 delta/bye/outcome/生命转换、最终名次与存留轮数。v1-v5 记录在读取、导入和导出时统一标准化为 v6；导出不会保留 room/member/encounter、昵称、seat 或 token 等身份字段。IndexedDB object-store 版本未提升，不需要数据迁移。

主要交付面：

- 新增 `RelayStageView`、`RelayEncounterBoard`、`relayView` selector 和 `useRelayHistory`，并从共享 `RoomPage` 中移除旧 relay 棋盘与动作装配；race 页面 reducer、匿名矩阵和聊天通道保持独立。
- 扩展 relay projection、`useRoom` 事件分派、显式 encounter action API、前台计时和恢复；没有修改 OpenAPI、WS 源合同、服务端规则、数据库 schema 或生成物。
- 扩展 `MemberScoreStrip`、统计 recorder/transfer/privacy/types 与统计详情页；新增 projection、selector、history、component、stats 与 desktop/Pixel 7 Playwright 覆盖。

验收与验证：

- `pnpm test`：shared 2 files / 10 tests、data 2 files / 26 tests、Web 36 files / 184 tests，全部通过。
- `pnpm typecheck`、`pnpm build`：全部 workspace package 通过，Next.js production build 成功。
- `cd apps/api && go test ./...`：全部 Go package 通过；`pnpm check:multiplayer-boundaries`：通过。
- `pnpm lint:openapi`、`pnpm check:openapi-refs`、`pnpm check:ws-protocol`：通过；本 Issue 没有合同或生成物改动。
- `pnpm exec prettier --check <全部 MRX-012 改动的 TypeScript/TSX 文件>`：通过。一次扩展到整个 `apps/web/src` 的诊断扫描发现 52 个未改动文件已有格式差异，本 Issue 未批量改写这些无关文件。
- `cd apps/web && pnpm exec playwright test e2e/multiplayer.spec.ts`：desktop Chromium 与 Pixel 7 共 60/60 通过，覆盖旧 race、双人 relay、spectator、chat、forfeit、刷新以及 2/4/6/8 人 relay 单棋盘流程。
- 原桌面刷新选择竞态修复后，`--project=desktop-chromium --grep "刷新后恢复浏览的其他 encounter 且保持只读" --repeat-each=3` 为 3/3；最终 session 恢复调整后同场景 desktop/Pixel 7 为 2/2。
- 2/4/6/8 人 desktop/Pixel 7 共 8 张视觉基线均通过 Playwright 比对；最新 8 人桌面与 Pixel 7 快照已人工检查，无页面横向溢出、积分遮挡、按钮文字溢出或棋盘/输入重叠。快照目录按现有 `apps/web/.gitignore` 策略仅作本地验收，不改变忽略规则。
- Windows Git `diff --check`、`diff --name-status`、`status --short --untracked-files=all`：通过范围和空白审计；实施期间未创建分支、tag、push 或 PR。

迁移与回滚：本 Issue 没有数据库 migration、合同切换或服务端部署要求。入口仍受既有 relay Web/API rollout flag 控制；关闭新入口不会改变已冻结房间的 `RuleSetRef`，当前 binary 可继续完成已有房间。代码回滚不删除服务端或本地数据；v1-v5 本地记录继续可读，已产生的 v6 导出应由支持 v6 的客户端导入。完整并发/负载、安全、axe/200% zoom、生产灰度与发布文档仍按原范围留给 MRX-013。
