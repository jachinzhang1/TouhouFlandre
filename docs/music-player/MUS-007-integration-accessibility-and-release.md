# MUS-007：集成、可访问性与发布验收

**类型**：集成/质量 Issue  
**优先级**：P0，发布前阻断  
**依赖**：MUS-004、MUS-005、MUS-006  
**建议标签**：`type:test` `area:web` `area:a11y` `area:performance` `area:release`
**状态**：已完成（2026-08-21）

## 要解决的问题

各子组件单独可用不代表播放器可以全站发布。固定定位可能与现有页面控件冲突，真实 MP3 的加载/Range seek 可能与测试 mock 不一致，主题切换和长标题可能造成视觉回归，路由导航、媒体错误、localStorage 和弹层焦点也需要在一个完整流程中验证。

本 Issue 不新增产品能力，只收口跨模块行为、可访问性、性能和发布证据。

## 目标

1. 验证完整用户流程：选择曲库、播放、seek、音量、静音、循环切歌、跨页面继续播放、刷新后恢复设置但不续播。
2. 验证播放器与首页、搜索、单人、多人、统计、公告页及现有浮层/底栏共存。
3. 覆盖桌面与移动端、深浅色、六种主题色、长标题、封面/音频失败和 reduced motion。
4. 验证静态音频在开发和生产形态下的 MIME、byte-range、缓存与首屏加载策略。
5. 完成发布清单、文档链接和素材归属复核。

## 属于本 Issue

- 跨 Issue 集成修复，但不改变已冻结的曲库/播放语义。
- 补齐 Vitest、Testing Library 与 Playwright 的测试空白。
- 桌面 Chromium、Pixel 7 截图和像素/overflow 检查。
- 键盘、焦点、accessible name、对话框 modal 行为和 reduced motion 验收。
- 静态 MP3 的 `Content-Type: audio/mpeg`、`Accept-Ranges`/206、seek 和缓存头检查。
- 确认默认只 `preload="metadata"`，未在首屏并行下载全部歌曲主体。
- 对封面 404/解码失败、音频 404/解码失败、`play()` rejection、storage exception 做完整恢复测试。
- 检查 `THIRD_PARTY_ASSETS.md` 的音乐目录级声明、音乐 JSON 的逐项 `sourceRefs`、音乐目录用途 README、站点功能文档与发布说明。
- 执行并填写[发布验收闸门](./release-gate.md)。

## 不属于本 Issue

- 不临时加入随机播放、歌词、Media Session、拖拽排序、导入导出等新需求。
- 不重写 Provider、替换播放器库或改变数据 schema；发现基础缺陷时回到拥有它的 Issue 修复。
- 不修改与播放器无关的页面视觉或游戏行为。
- 不以提高 `z-index` 的局部补丁掩盖层级设计问题。
- 不把外部 CDN/对象存储作为发布临时方案。

## 可能涉及的代码与文档

- `apps/web/src/features/music-player/**`
- `apps/web/src/app/layout.tsx`、必要的 feature/global theme 样式
- `apps/web/e2e/music-player-*.spec.ts`
- `apps/web/playwright.config.ts`（仅必要的测试配置）
- `docs/features.md`
- `docs/deployment.md`（若部署对 Range/MIME 需要明确配置）
- `THIRD_PARTY_ASSETS.md`
- `docs/music-player/release-gate.md`

## 必测流程

### 全站连续播放

1. 在首页展开播放器并点击播放。
2. 等待播放时间明显前进，记录 `currentSrc`、曲目 ID、音量和 `currentTime`。
3. 使用站内链接依次进入 `/search`、`/single`、`/multi`、`/stats`，途中展开/收起卡片。
4. 确认同一音频元素仍存在，`currentSrc`/曲目未被路由改写，时间持续前进且没有无因暂停。
5. 刷新页面，确认恢复曲目、选择、音量和静音，但状态为暂停、时间为 0，不发生自动播放请求。

### 列表与错误恢复

- 在最后一首点击下一首回到第一首；在第一首点击上一首回到最后一首；自然结束也回到下一首。
- 播放中从设置里移除当前曲目，应用后切到新列表第一首并继续播放意图。
- 拦截封面请求，确认占位图出现且布局不变。
- 拦截/损坏当前 MP3，确认不无限跳曲、不产生未处理 rejection，仍能切到有效曲目。
- 让 localStorage 抛异常或填入坏 JSON，确认播放器可用并给出合理的非阻断反馈。

### 主题与布局

- 深/浅模式各覆盖至少一个完整卡片和 dialog 截图。
- 对六种 `data-theme-color` 断言圆环、歌曲 Slider 和音量 Slider 的填充计算色来自当前 `--accent`。
- 检查 320px、Pixel 7、1024px 和宽屏：无横向溢出、标题/按钮重叠，悬浮入口不遮挡主要导航。
- 与 `QuestionScopeDialog`、倒计时/结果 overlay、移动端导航、固定猜测输入、`AppearanceSwitcher`、`ChatDock` 分别共存。

### 可访问性

- 仅用键盘完成打开、播放、切歌、seek、调整音量、静音、打开设置、切换视图、选择和应用。
- 卡片关闭后焦点返回悬浮入口；设置关闭后返回曲库按钮；modal 打开时焦点不逃到背景。
- 图标按钮、Slider、Checkbox、Segmented 均有准确中文名称/值；播放状态不只靠颜色或动画表达。
- 200% 页面缩放后仍可操作；reduced motion 下没有展开位移、缩放或自动跑马灯。

## 性能与交付约束

- 首屏不下载 3 个完整 MP3；网络面板只允许当前曲目的 metadata/range 请求。
- `timeupdate` 不应让整个站点页面重渲染；React Profiler 或受控计数证明更新范围留在播放器 feature。
- 切换曲目后旧 source 请求/事件不会写回当前状态。
- cover 设置合理尺寸或响应式属性，不解码远超展示需要的图片版本。
- 生产反向代理/CDN 保留 Range；从非零 byte 请求返回 206 和正确 `Content-Range`，实际拖动可继续播放。
- 若普通 Git 中首批素材超出 MUS-002 预算，发布阻断，不能在本 Issue 静默放宽。

## 验收标准

- [x] [发布验收闸门](./release-gate.md)全部通过并记录日期/环境。
- [x] 软导航期间音频对象、source 和时间连续；刷新后的暂停恢复行为符合约定。
- [x] 真实媒体首尾循环、seek、音量、mute、列表应用均通过 desktop/mobile Chromium。
- [x] 六种主题色与深浅模式都通过计算样式测试，关键视图截图无未解释差异。
- [x] 封面、音频、storage 和 `play()` 失败均可恢复，没有无限循环或未处理 Promise rejection。
- [x] 全部交互可用键盘完成，焦点返回与 modal trap 正确，reduced motion 有覆盖。
- [x] 首页只预加载当前曲目 metadata，生产静态服务支持 MP3 MIME 和 byte-range seek。
- [x] 所有新增素材都有 JSON `sourceRefs` 和音乐目录级授权声明，Git 中没有未引用或超预算文件。
- [x] `docs/features.md` 已描述播放器的用户行为边界；部署侧 MIME/Range 说明已同步。

## 完成记录

- **完成日期**：2026-08-21
- **集成测试**：新增 `music-player-integration.spec.ts`，覆盖五个站内路由的单音频实例连续播放、刷新暂停边界、音频失败、`play()` rejection 和 localStorage 不可用；Desktop Chromium/Pixel 7 共 8/8 通过。
- **无障碍测试**：新增 `music-player-accessibility.spec.ts`，覆盖键盘播放/seek/音量/设置流程、Modal accessible name/focus trap/focus return、reduced motion、320px overflow 与截图输出；Desktop Chromium/Pixel 7 共 4/4 通过。
- **最小回修**：PlaylistDialog 使用 Ant Design Modal 的语义标题并将重复视觉标题隐藏，确保实际 `role="dialog"` 有可访问名称；未改变曲库或播放状态契约。
- **文档与发布**：`docs/features.md` 增加播放器行为边界，`docs/deployment.md` 增加 MP3 MIME/Range/缓存检查，`release-gate.md` 已填写通过项。
- **验证结果**：data typecheck/validate/test（33 tests）、Web typecheck/test（191 tests）和 production build 通过；播放器 Playwright 全量 42/42 通过；production standalone 本地 MP3 MIME/Range/metadata 2/2 通过。
- **已知非阻断信息**：storage 不可用测试会触发 Ant Design static `message` 的 context warning，但无 page error、未处理 Promise rejection 或状态中断；该 warning 不影响用户设置的内存态生效。

## 依赖与回修原则

MUS-004、005、006 全部完成后开始。发现问题时按所有权回修：数据/资产回 MUS-002，播放与路由生命周期回 MUS-003，圆环/定位回 MUS-004，卡片/控制回 MUS-005，选择/持久化回 MUS-006。MUS-007 只接受跨模块粘合和验收测试。
