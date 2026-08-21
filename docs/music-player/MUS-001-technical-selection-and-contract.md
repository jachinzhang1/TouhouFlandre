# MUS-001：技术选型与模块契约

**类型**：设计/技术验证 Issue  
**优先级**：P0，所有播放器实现的前置  
**依赖**：无  
**建议标签**：`type:design` `area:web` `area:architecture` `area:a11y`

## 要解决的问题

播放器需要跨 App Router 页面持续播放，同时提供高度定制的悬浮入口、环形进度、主题联动和曲库对话框。若先挑一个完整播放器库再强行覆盖样式，可能把第三方 DOM、内部播放状态和页面生命周期一起引入；若完全自行实现而没有验证浏览器媒体行为，又容易在 seek、自动播放、移动端和错误恢复上留下缺口。

本 Issue 先冻结“谁持有音频、谁持有状态、UI 能调用什么、哪些开源组件复用”的契约，使后续三个 UI Issue 可以并行而不各自建立播放器。

## 目标

1. 用最小试验确认根布局中的唯一 `HTMLAudioElement` 能跨站内客户端导航保持 `currentSrc`、暂停/播放状态和 `currentTime`。
2. 比较原生音频、Howler.js、`react-h5-audio-player` 与 APlayer，记录许可证、兼容性、包体积、SSR 和样式所有权；冻结生产方案。
3. 定义 Provider 的视图状态、命令接口、媒体事件映射和 UI 打开状态边界。
4. 定义浏览器支持范围、自动播放策略、媒体错误语义和测试方式。
5. 更新[架构与行为决策](./decisions.md)，确保后续 Issue 只引用一套结论。

## 属于本 Issue

- 建立不进入生产 UI 的最小 spike，验证 `play()` Promise、`loadedmetadata`、`durationchange`、`timeupdate`、`seeking/seeked`、`ended`、`volumechange`、`error` 的顺序和清理方式。
- 验证 Next.js 软导航与硬刷新边界，确认根布局挂载点。
- 确定是否需要新增音频依赖；若需要，说明原生方案的具体失败、替代库的许可证和锁文件影响。
- 确定 `MusicPlayerProvider`/adapter/组件目录和公开 hook 的最小接口。
- 确定状态机枚举、播放意图与实际播放状态的区别，以及切歌期间如何延续播放意图。
- 确定浮层层级基线，列出现有 `SiteNav`、移动端底栏、`AppearanceSwitcher`、`ChatDock` 和 `z-50` 全屏弹层。
- 写出测试替身策略：Vitest 中 mock media methods，Playwright 中使用真实本地 MP3 验证浏览器行为。

## 不属于本 Issue

- 不下载或提交歌曲、封面、占位图。
- 不实现最终播放器卡片、悬浮按钮或曲库对话框。
- 不修改 API、数据库、WebSocket、统计或游戏状态。
- 不实现 Media Session API、波形图、均衡器、歌词或跨标签页同步。
- 不以 spike 代码替代可维护的生产模块；无用试验代码在结论记录后删除。

## 可能涉及的代码

- `docs/music-player/decisions.md`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/features/music-player/`（只允许契约骨架或测试夹具）
- `apps/web/e2e/`（最小导航生命周期验证）
- `apps/web/package.json`、`pnpm-lock.yaml`（仅在选型明确需要新依赖时）

## 关键验证

### 生命周期

从首页点击播放，记录音频元素引用、`currentSrc` 和 `currentTime`，通过站内 `Link` 进入 `/search`、`/single`、`/multi`，确认：

- 元素引用未变化；
- 没有额外 `pause`/`load` 事件；
- 播放时间单调前进；
- 返回首页后仍由同一个 Provider 控制。

随后执行 `page.reload()`，确认文档被销毁、播放器恢复为暂停且不自动续播。硬刷新不属于“页面内部变化”。

### 选型记录

每个候选至少记录：包名/版本、许可证来源、维护状态检查日期、React 19/Next 16 兼容结果、gzip 体积估算、是否能使用现有 CSS 变量、是否暴露无障碍名称、能否由外部单例状态驱动。只因为 demo 好看不能成为采用理由。

### 状态所有权

契约必须能够表达：未初始化、metadata 加载中、暂停、播放、seek 中和不可播放错误；并说明哪些是持久状态、哪些是瞬时状态。UI 不直接持有 `isPlaying` 副本。

## 验收标准

- [x] `decisions.md` 中的技术表已根据实际 spike 更新，不再保留影响实现的待定项。
- [x] 根布局常驻和硬刷新边界有 Playwright 证据，而不是只基于 React 文档推断。
- [x] 最终方案默认使用原生 `HTMLAudioElement`，未发现需要第三方内核解决的可复现问题。
- [x] 未新增依赖，`apps/web/package.json` 与锁文件无需变化；候选许可证和放弃原因已记录。
- [x] Provider 的 state/commands 契约足以支持 MUS-004、005、006，且不暴露原生 audio 元素。
- [x] 已定义媒体事件监听的注册/释放规则；adapter 测试覆盖重复换源与精确 cleanup。
- [x] 已定义播放器层级和现有固定控件的碰撞清单。
- [x] 没有把 spike 的临时代码、远程音频 URL 或测试下载文件留在生产目录。

## 完成记录

- **完成日期**：2026-08-20
- **冻结方案**：根布局唯一原生 `HTMLAudioElement` + feature-local Context/reducer + 窄命令接口。
- **代码契约**：`apps/web/src/features/music-player/contracts.ts`、`audioAdapter.ts`、`MusicPlayerRoot.tsx`。
- **自动化证据**：adapter/契约 Vitest，以及 `apps/web/e2e/music-player-contract.spec.ts` 的 Desktop Chromium、Pixel 7 软导航和硬刷新验证。
- **依赖结果**：未新增 npm 依赖，未修改锁文件。

## 依赖与后续

此 Issue 没有依赖。MUS-002 和 MUS-003 依赖其结论；MUS-004 至 006 不得在 MUS-001 未冻结前自行选择另一套播放器内核。
