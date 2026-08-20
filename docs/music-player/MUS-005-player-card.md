# MUS-005：展开播放器卡片与完整播放控制

**类型**：功能/前端 UI Issue  
**优先级**：P1  
**依赖**：MUS-002、MUS-003  
**建议标签**：`type:feature` `area:web` `area:design` `area:a11y`

## 要解决的问题

用户需要在紧凑卡片中看清当前歌曲、控制播放位置与音量，并能从悬浮入口自然展开/收起。附件只给出信息层级，没有规定真实比例；实现必须结合本站安静、紧凑的视觉语言和移动端空间，而不是照搬示意图尺寸。

## 目标

1. 提供封面、标题、专辑/艺人等元信息和封面失败占位。
2. 提供歌曲进度条、当前/总时长、上一首、播放/暂停、下一首、曲库设置、音量滑块和点击静音。
3. 仅在标题实际溢出时启用左右循环展示。
4. 展开/收起具有顺畅过渡，深浅色和主题色即时同步。
5. 桌面紧凑、移动端不溢出，键盘与屏幕阅读器语义完整。

## 属于本 Issue

- `PlayerCard`、`TrackCover`、标题跑马灯和各控制子组件。
- 从 Provider 读取状态、调用命令；不直接访问原生 `<audio>`。
- 加载、暂停、播放、错误和无可用曲目状态。
- 进度 Slider 拖动草稿、提交 seek、时间格式化。
- 音量 Slider、四档 Lucide 音量图标和图标静音切换。
- 点击曲库按钮触发 MUS-006 提供的对话框开关接口；在 MUS-006 合并前可以使用无状态占位回调。
- 点击外部、Escape、再次点击入口关闭；关闭后焦点回到入口。
- 展开/收起 transition、transform origin 和 reduced motion。

## 不属于本 Issue

- 不创建曲库数据、下载素材或修改授权清单。
- 不实现曲库复选逻辑与 localStorage schema。
- 不增加拖拽排序、随机/单曲循环、歌词、波形、均衡器、收藏、下载按钮或分享按钮。
- 不在卡片中展示冗长来源链接或所有元数据字段。
- 不复制题库 Dialog 代码到卡片。

## 可能涉及的代码

- `apps/web/src/features/music-player/components/PlayerCard.tsx`
- `apps/web/src/features/music-player/components/TrackCover.tsx`
- `apps/web/src/features/music-player/components/MarqueeTitle.tsx`
- `apps/web/src/features/music-player/MusicPlayerRoot.tsx`
- feature-local 样式、组件测试和视觉 e2e

## 推荐布局

卡片锚定悬浮按钮下方并右对齐。桌面建议采用“左侧正方形封面 + 右侧信息/控制”的两列结构；窄屏可以缩小封面或改为上方信息、下方控制，但所有交互目标至少保持 40px 左右的稳定点击区域。

信息优先级：

1. 完整歌曲名；
2. 艺人/作曲信息与专辑名；
3. 歌曲进度条和时间；
4. 上一首、播放/暂停、下一首；
5. 曲库设置与音量。

不要把卡片再拆成多个装饰卡片。封面、信息和控制属于一个播放器表面。

## 关键交互

### 封面

- 容器固定 `aspect-ratio: 1`，loading/error 不改变布局。
- 使用曲目覆盖图或专辑封面，`onError` 只切换一次本地占位图。
- 占位图仍失败时显示主题表面和 `Music2` 图标；alt 文本使用“《曲名》封面”，装饰性重复场景可用空 alt。

### 长标题

- mount、曲目变化和容器 resize 后比较 `scrollWidth/clientWidth`。
- 只有溢出才生成循环副本并播放横向动画，短标题保持静止。
- 动画速度按文本实际宽度计算，避免长标题过快、刚溢出标题过慢。
- hover/focus 暂停；可访问树只包含一份标题；reduced motion 下取消自动滚动并以 tooltip/完整可访问名称补足。

### 歌曲进度

- 显示 `m:ss / m:ss`；duration 未知时总时长为 `--:--`。
- 拖动时用草稿值更新视觉和当前时间文本，不让 `timeupdate` 抢回 thumb。
- pointer/key commit 后调用一次 `seek`；禁用状态不响应。
- Slider 已播放填充使用 `--accent`，轨道使用 `--line-strong`，焦点不能只靠颜色。

### 播放控制

- 使用 `SkipBack`、`Play`/`Pause`、`SkipForward`、`ListMusic` 等 Lucide 图标和 tooltip。
- 中央播放按钮尺寸最大，但不改变工具栏高度；loading 可展示 `LoaderCircle` 且仍保留稳定占位。
- 所有图标按钮都有中文 accessible name；不可只依赖 `title`。

### 音量

- 图标按决策文档四档切换，点击执行 mute/unmute。
- Slider `aria-label="音量"`，范围与显示百分比一致；拖到 0、解除静音和恢复最近非零值行为一致。
- 已填充部分使用 `--accent`，不写死某个主题色。

## 视觉与动画

- 卡片使用 `--surface`/`--paper`、`--ink`、`--line` 和现有阴影，不使用独立紫/蓝/深色播放器皮肤。
- 圆角不超过 8px，与站点页面和题库对话框保持一致。
- 展开动画建议 160--220ms：右上 transform-origin、`opacity`、小距离 `translateY` 和轻微 `scale`；收起后设为 inert/hidden，不能留下可聚焦控件。
- 动画不得影响悬浮按钮位置，也不能让卡片宽高在图标/标题变化时跳动。

## 验收标准

- [ ] 卡片包含需求列出的全部信息与控制，且没有创建第二套播放状态或 audio 元素。
- [ ] 3 首测试曲目都显示正确标题、专辑/艺人和封面；模拟封面失败时一次回退占位图。
- [ ] 短标题静止，长标题仅在溢出时循环；resize/换歌后判定更新，屏幕阅读器不重复朗读。
- [ ] 进度拖动不会被 `timeupdate` 抢回；键盘方向键也可 seek。
- [ ] 上/下一首、播放/暂停和媒体错误状态与 Provider 一致。
- [ ] 音量图标在 0、低、中、高和 muted 时正确，点击图标能恢复静音前音量。
- [ ] 切换六种主题色与深/浅模式时，卡片、歌曲进度和音量填充即时更新。
- [ ] 展开/收起、外部点击和 Escape 行为确定，关闭后焦点回到入口。
- [ ] 320px 和 Pixel 7 下无横向溢出、文本遮挡或小于合理触控尺寸的主要按钮。
- [ ] reduced motion 下无位移/缩放和自动跑马灯，但所有功能仍可使用。

## 测试计划

- Testing Library：封面回退、标题溢出 mock、状态图标、按钮命令、seek 草稿、音量阈值、Escape/focus。
- Playwright：真实 MP3 控制、长标题、主题切换、桌面/移动截图、无横向 overflow。
- 手工检查：中英文混排标题、200% 缩放、键盘顺序、屏幕阅读器可访问名称。

## 依赖与后续

依赖 MUS-002 的曲库/封面解析和 MUS-003 的状态/命令。可与 MUS-004、006 并行；合并时只通过 `MusicPlayerRoot` 协调打开状态。
