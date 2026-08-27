# MUS-004：右上悬浮入口与环形播放进度

**类型**：功能/前端 UI Issue  
**优先级**：P1  
**依赖**：MUS-003  
**建议标签**：`type:feature` `area:web` `area:design` `area:a11y`
**状态**：已完成（2026-08-21）

## 要解决的问题

播放器需要在所有页面都有稳定入口，又不能侵入页面布局或遮挡现有导航。入口还承担当前曲目进度的快速反馈：从 12 点方向开始，播放到结尾恰好完成一圈，并在主题色变化时即时更新。

本 Issue 只交付悬浮按钮、环形进度和卡片开关，不承载完整播放控制。

## 目标

1. 在桌面和移动端右上角显示 56px 尺寸稳定的圆形按钮，中央固定使用 `Music2` 音符图标。
2. 按钮表面随深/浅色模式变亮/变暗，环形进度始终使用当前 `--accent`。
3. 用准确且可测试的 SVG 圆环表示 `currentTime / duration`，起点为 12 点。
4. 点击按钮切换展开卡片；展开状态、加载/播放/错误状态都有可访问名称。
5. 与顶部导航、移动底栏、聊天、主题按钮和全屏游戏弹层形成明确层级。

## 属于本 Issue

- `FloatingPlayerButton` 及环形进度纯组件。
- 入口位置、尺寸、点击/键盘状态、focus ring 和 tooltip。
- `aria-expanded`、`aria-controls`、当前曲目名称与时间/百分比的可访问文本。
- 展开/收起命令和打开状态；实际卡片内容由 MUS-005 提供。
- `duration` 无效、当前无曲目、loading 和 error 的视觉降级。
- safe-area、320px 最小宽度、常用桌面宽度和 Pixel 7 布局。
- `prefers-reduced-motion` 下的按钮/圆环状态变化。

## 不属于本 Issue

- 不实现播放/暂停、上一首/下一首、seek 或音量逻辑。
- 不新增第二个音频元素或缓存播放状态。
- 不把按钮放入 `SiteNav`，也不要求各页面为播放器预留 DOM 插槽。
- 不实现拖动圆环 seek；圆环首版只读。
- 不在按钮内塞入歌曲标题等容易改变尺寸的文本。

## 可能涉及的代码

- `apps/web/src/features/music-player/FloatingPlayerButton.tsx`
- `apps/web/src/features/music-player/MusicPlayerRoot.tsx`
- `apps/web/src/app/globals.css` 中的 feature-local 样式
- `apps/web/src/features/music-player/FloatingPlayerButton.test.tsx`
- `apps/web/e2e/music-player-launcher.spec.ts`

## 环形进度规范

实际使用两个同心 SVG circle：底圈使用 `--line-strong`，进度圈使用 `--accent`。

```text
progress = validDuration ? clamp(currentTime / duration, 0, 1) : 0
circumference = 2 * PI * radius
dashOffset = circumference * (1 - progress)
```

- SVG 坐标系或进度 circle 旋转 `-90deg`，使 0 位于 12 点。
- `progress=0` 时进度为空；`progress=1` 时无缝闭合一圈。
- 按钮固定为 56px，圆环半径为 24px、stroke 为 3px；切换图标/状态不改变按钮外框。
- 不用每一帧 React 重建 SVG；消费内核节流后的时间状态或更新一个 CSS 变量。
- 颜色只由 CSS variable 决定；主题切换后不等待下一次 `timeupdate`。
- 中央固定渲染 `Music2`，loading 通过静态透明度、error 通过静态边框表达，不使用持续旋转。

## 定位与层级

- 锚点为 viewport 右上角，包含 `env(safe-area-inset-top/right)`；桌面位置按 76px `SiteNav` 高度下移 12px，移动端按 62px 顶部导航下移 10px。
- 已通过 320px、1024px 和 1440px viewport 检查与 `SiteNav` 的碰撞及页面横向溢出。
- 移动端仍锚定右上，不改到底部，以避免 `z-40` 的 68px 导航和输入条。
- 入口/卡片层级应低于当前 `z-50` 全屏弹层；全屏弹层出现时播放器不能抢点击。
- 与右下 `AppearanceSwitcher`、左下/底部 `ChatDock` 形成不同角落的固定布局，不通过页面 padding 耦合。

## 交互与动效

- 点击或按 Enter/Space 切换卡片；按钮本身不直接播放/暂停，避免一个控件承担两个动作。
- 打开时 `aria-expanded=true` 并关联卡片 ID；关闭时恢复焦点策略由 MUS-005 完成。
- hover/focus 可以有轻微抬升或阴影变化，但不能让按钮尺寸或圆环位置跳动。
- 中心 `Music2` 图标不承担播放/暂停动作；播放状态通过 accessible name、进度圈和静态状态样式表达，禁止持续旋转。

## 验收标准

- [x] 所有 App Router 页面都有且只有一个播放器入口。
- [x] 0%、25%、50%、75%、100% 的圆环位置准确，0 从 12 点开始，100% 完整闭合。
- [x] `duration` 为 0/NaN/Infinity 或无曲目时圆环稳定为空，不生成 React/CSS 警告。
- [x] 六种主题色切换后圆环的计算颜色即时等于 `--accent`；深浅模式切换后按钮背景和文本保持对比。
- [x] 按钮在 320px、Pixel 7、1024px 和宽屏下不遮挡主要导航、不引起横向滚动。
- [x] 播放器使用 `z-30`，低于现有 `z-50` 全屏游戏/结果弹层；曲库设置对话框覆盖卡片的最终集成由 MUS-006/MUS-007 验证。
- [x] 键盘可操作，focus 清晰；accessible name 至少包含“音乐播放器”和当前状态，并通过 `aria-describedby` 提供时间/百分比。
- [x] `prefers-reduced-motion` 下没有不必要的循环/位移动画。

## 测试计划

- `FloatingPlayerButton.test.tsx` 覆盖 progress clamp、dash offset、中央音符、`aria-expanded`、`aria-controls`、键盘和无曲目/loading 状态，共 4 个测试。
- `music-player-launcher.spec.ts` 在 Desktop Chromium 与 Pixel 7 上覆盖入口唯一性、键盘开关、六种 `data-theme-color` 的计算色、320px/1024px/1440px 定位和横向溢出。
- 视觉截图、全屏 overlay 与 MUS-006 dialog 的跨模块回归留给 MUS-007；本 Issue 已验证 `z-30` 层级基线。

## 完成记录

- **完成日期**：2026-08-21
- **入口实现**：新增 `FloatingPlayerButton`，固定 56px 圆形入口，中央使用 `Music2`，消费 `useMusicPlayer` 的只读状态，不访问原生 audio。
- **进度实现**：纯函数 clamp 有效 duration，使用半径 24px、stroke 3px 的 SVG 圆环，从 12 点开始映射播放进度。
- **宿主与层级**：`MusicPlayerRoot` 内部维护卡片打开状态；入口/预留卡片宿主为 `z-30`，桌面和移动端均避开顶部导航与 safe-area。
- **可访问性**：支持中文 accessible name、`aria-expanded`、`aria-controls`、`aria-busy`、进度描述和 Tooltip；按钮不承担播放/暂停。
- **自动化证据**：Web 全量 38 个测试文件、172 个测试、typecheck、production build 通过；MUS-004 Playwright Desktop Chromium 与 Pixel 7 各 3/3 通过。

## 依赖与后续

只依赖 MUS-003 的只读播放状态。本 Issue 已完成；MUS-005 继续提供按钮所展开的实际卡片，MUS-006/MUS-007 负责 dialog 和跨模块层级/视觉回归，不得反向改写圆环状态算法。
