# MUS-004：右上悬浮入口与环形播放进度

**类型**：功能/前端 UI Issue  
**优先级**：P1  
**依赖**：MUS-003  
**建议标签**：`type:feature` `area:web` `area:design` `area:a11y`

## 要解决的问题

播放器需要在所有页面都有稳定入口，又不能侵入页面布局或遮挡现有导航。入口还承担当前曲目进度的快速反馈：从 12 点方向开始，播放到结尾恰好完成一圈，并在主题色变化时即时更新。

本 Issue 只交付悬浮按钮、环形进度和卡片开关，不承载完整播放控制。

## 目标

1. 在桌面和移动端右上角显示尺寸稳定的圆形按钮。
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

- `apps/web/src/features/music-player/components/FloatingPlayerButton.tsx`
- `apps/web/src/features/music-player/MusicPlayerRoot.tsx`
- feature-local 样式或 `apps/web/src/app/globals.css` 中最小的主题 token
- 同目录组件测试
- `apps/web/e2e/music-player-visual.spec.ts`

## 环形进度规范

建议使用两个同心 SVG circle：底圈使用 `--line-strong`，进度圈使用 `--accent`。

```text
progress = validDuration ? clamp(currentTime / duration, 0, 1) : 0
circumference = 2 * PI * radius
dashOffset = circumference * (1 - progress)
```

- SVG 坐标系或进度 circle 旋转 `-90deg`，使 0 位于 12 点。
- `progress=0` 时进度为空；`progress=1` 时无缝闭合一圈。
- 宽度、半径和 stroke 均固定，切换图标/状态不改变按钮外框。
- 不用每一帧 React 重建 SVG；消费内核节流后的时间状态或更新一个 CSS 变量。
- 颜色只由 CSS variable 决定；主题切换后不等待下一次 `timeupdate`。

## 定位与层级

- 锚点为 viewport 右上角，包含 `env(safe-area-inset-top/right)`。
- 桌面必须检查与 `SiteNav` 右侧交互区的碰撞；必要时按实测导航高度下移，但保持“右上悬浮”认知。
- 移动端仍锚定右上，不改到底部，以避免 `z-40` 的 68px 导航和输入条。
- 入口/卡片层级应低于当前 `z-50` 全屏弹层；全屏弹层出现时播放器不能抢点击。
- 与右下 `AppearanceSwitcher`、左下/底部 `ChatDock` 形成不同角落的固定布局，不通过页面 padding 耦合。

## 交互与动效

- 点击或按 Enter/Space 切换卡片；按钮本身不直接播放/暂停，避免一个控件承担两个动作。
- 打开时 `aria-expanded=true` 并关联卡片 ID；关闭时恢复焦点策略由 MUS-005 完成。
- hover/focus 可以有轻微抬升或阴影变化，但不能让按钮尺寸或圆环位置跳动。
- 播放状态可让中心图标有克制变化，但禁止依赖持续旋转表达“正在播放”；进度圈已经提供动态反馈。

## 验收标准

- [ ] 所有 App Router 页面都有且只有一个播放器入口。
- [ ] 0%、25%、50%、75%、100% 的圆环位置准确，0 从 12 点开始，100% 完整闭合。
- [ ] `duration` 为 0/NaN/Infinity 或无曲目时圆环稳定为空，不生成 React/CSS 警告。
- [ ] 六种主题色切换后圆环的计算颜色即时等于 `--accent`；深浅模式切换后按钮背景和文本保持对比。
- [ ] 按钮在 320px、Pixel 7、1024px 和宽屏下不遮挡主要导航、不引起横向滚动。
- [ ] 全屏游戏/结果弹层覆盖播放器并阻止其接收指针；曲库设置对话框稍后可覆盖播放器卡片。
- [ ] 键盘可操作，focus 清晰；accessible name 至少包含“音乐播放器”和当前状态。
- [ ] `prefers-reduced-motion` 下没有不必要的循环/位移动画。

## 测试计划

- 纯函数测试 progress clamp 与 dash offset。
- Testing Library 验证 `aria-expanded`、`aria-controls`、键盘和无曲目状态。
- Playwright 逐个切换 `data-theme-color` 与深浅模式，断言计算样式。
- 桌面/Pixel 7 截图覆盖收起、展开锚点和全屏 overlay 共存。

## 依赖与后续

只依赖 MUS-003 的只读播放状态。可以与 MUS-005、006 并行；MUS-005 负责提供按钮所展开的实际卡片，不得反向改写圆环状态算法。
