# HSO-006：让角色目录、单人、竞速和接力统一接入混合搜索

**类型**：功能/跨模式集成 Issue  
**优先级**：P0  
**依赖**：HSO-004、HSO-005  
**状态**：未开始  
**建议标签**：`type:feature` `area:web` `area:single-player` `area:multi` `area:test`

## 要解决的问题

HSO-004 为兼容旧调用方会在缺少本地上下文时继续远程搜索。要真正消除逐词公网请求，角色目录、单人和两种多人体验必须各自提供冻结题库版本和正确允许角色集合，同时保持相同 Hook、已猜过滤、交互和远程回退身份。

## 要做到什么程度

所有正式角色搜索入口只调用 `useCharacterSearch`，并提供本地路径需要的版本/范围以及远程回退需要的原身份参数。本地策略启用且索引就绪后，任何新查询都不访问搜索 API；切为 remote 或发生故障时，页面无需重载即可恢复当前服务端行为。

## 各入口数据来源

- 角色目录：`CatalogSummary.version`，不传游戏允许 ID，保留 work filter/sort/paging。
- 单人：`PublicGameSession.catalogVersion` 与 `questionScope.selectedCharacterIds`，同时保留 sessionId。
- 竞速：当前 `MatchView.catalogVersion/questionScope.selectedCharacterIds`，同时保留 roomId/matchIndex。
- 接力：当前 projection 对应 match 的同一版本/范围，同时保留 roomId/matchIndex；不同 encounter 共用场次搜索范围，已猜角色仍由当前棋盘过滤。

策略的 `gameScopeMode` 也属于上下文：`strict` 时游戏入口只有在 selected IDs 非空有效时才能本地；`full` 时游戏入口强制远程以保留现有全快照语义，角色目录仍可本地。

## 属于本 Issue

- 修改角色目录、SingleGamePage、GuessInputBar、RaceMatchExperience 和 RelayStageView 的上下文装配。
- 只装配 HSO-004 的搜索 adapter 与 HSO-005 的题局 adapter；不把两个 Issue 的请求逻辑重新合并到 `api.ts`。
- 在 session/match 版本可用后预取索引；预取不阻塞题局主体、棋盘或 WebSocket 投影。
- 版本/场次/难度切换时清空旧候选，避免上一题局结果短暂可选。
- 保留 GuessInputBar 和单人已有键盘、高亮、重复角色过滤、提交中禁用和焦点恢复行为。
- 为真实索引初载显示准确状态；将笼统的“正在连接本地题库”改为“正在准备题局”，搜索索引加载只在搜索区域表达。
- 回退期间沿用现有搜索 loading/error/retry 交互；用户显式 retry 只请求 HSO-004 打开一个半开探针，页面不得自行清除熔断或直接访问索引。
- 对旧 session/match 投影缺少版本或范围时使用远程身份回退，绝不以全目录本地搜索代替。
- 单人页面使用 HSO-005 resolve 主流程，并在 session 返回后立即提供搜索上下文。
- 覆盖角色目录、单人、竞速和接力的 local/remote/fallback 组件与 E2E 流程。

## 不属于本 Issue

- 不修改本地搜索算法、索引 schema、策略刷新或 resolve 服务端行为。
- 不删除 `api.searchCharacters`、remote 上下文参数或旧 API 兼容分支。
- 不修改多人 WebSocket schema、比赛规则、轮次/encounter 范围或提交接口。
- 不把完整题库/搜索索引存入 React 页面 state 或每个模式各建 Provider。
- 不重写 QuestionScopeDialog、多人建房设置或角色卡片视觉。

## 可能涉及的代码

- `apps/web/src/app/search/page.tsx`
- `apps/web/src/components/{SingleGamePage.tsx,GuessInputBar.tsx,RelayStageView.tsx}`
- `apps/web/src/multiplayer/modes/race/RaceMatchExperience.tsx`
- `apps/web/src/hooks/useCatalogSummary.ts`
- `apps/web/src/features/character-search/searchApi.ts`
- `apps/web/src/lib/puzzleApi.ts`
- 对应组件、多人模式和 E2E 测试

## 验收标准

- [ ] local-primary 下四个入口索引就绪后连续输入均不请求 `/api/characters/search`。
- [ ] remote 下四个入口继续发送原 sessionId 或 roomId+matchIndex，结果和当前 main 基线一致。
- [ ] 角色目录 `CatalogSummary.version` 缺失或无法验证时不加载未知索引，安全远程或显示可重试错误。
- [ ] 强制索引失败时四个入口自动远程可用，搜索词、过滤、排序和 total 不变。
- [ ] 单人和多人本地结果严格限制在 `selectedCharacterIds`，空/缺失范围不泄漏整表。
- [ ] `gameScopeMode=strict`/`full` 切换后，游戏入口分别保持 selected-ID 本地语义/完整快照远程语义；角色目录不受 full 限制。
- [ ] 切 daily difficulty、随机新局、multiplayer rematch/matchIndex 和 relay stage 时不展示旧上下文候选。
- [ ] 已猜角色过滤、键盘上下/Enter、点击提交、disabled/submitting 和焦点恢复在 local/remote 两种模式一致。
- [ ] 题局/棋盘先显示，冷索引加载不延迟计时开始或 WebSocket 状态处理。
- [ ] 页面不包含第二份搜索算法或直接读取索引 entries 的临时过滤代码。
- [ ] 加载文案准确区分题局准备和搜索索引加载。
- [ ] 四个入口在瞬时故障恢复、结构性熔断和用户显式 retry 时状态一致，不出现每分钟重复 loading、候选闪烁或页面私自绕过退避。

## 测试计划

- 扩展现有 Hook/SingleGamePage/GuessInputBar/Race/Relay 测试，分别注入 local、remote 和 fallback。
- Playwright 监听网络，断言本地模式没有逐词搜索请求，远程模式参数保持原样。
- 使用两个题库版本和两个 matchIndex 验证缓存/结果隔离；使用空 scope 验证 fail closed。
- 在 strict/full 配置之间切换，分别验证 local/remote parity 和没有范围扩大。
- 桌面和移动视口执行键盘与点击猜测流程，确认 UI 没有闪现上一上下文数据。
- 运行 Web 全量 Vitest、typecheck、build 和相关 multiplayer E2E。

## 依赖与后续

依赖 HSO-004 的混合路由和 HSO-005 的单人 session 输出。完成后 HSO-007 只负责跨模块缺陷收口、性能证据和发布演练，不新增模式特有搜索实现。
