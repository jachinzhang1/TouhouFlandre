# MRX-012：交付多人接力单棋盘浏览、结算与本地统计

**类型**：功能/Web Issue  
**优先级**：P0  
**依赖**：MRX-010、MRX-011  
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
