# 音乐播放器架构与行为决策

本文记录所有播放器 Issue 共用的默认决策。MUS-001 需要通过最小技术试验核实这些结论；若试验推翻某项决策，应先更新本文，再开始依赖它的实现。

## 技术方案

### 推荐基线

- **媒体内核**：浏览器原生 `HTMLAudioElement`，由根级 React Provider 持有唯一实例。
- **界面**：项目内 React 组件；复用现有 `antd` 的 `Modal`、`Checkbox`、`Slider`、`Segmented`、`Tooltip` 和主题桥接，图标使用现有 `lucide-react`。
- **状态**：feature-local Context + reducer；不为单一全局组件引入新的全局状态库。
- **曲库**：`packages/data` 的独立 `@touhouflandre/data/music` 子入口，使用 JSON + Zod；音频和图片位于 `apps/web/public/music`。
- **持久化**：浏览器 `localStorage`，带 `schemaVersion` 和损坏数据回退。

### 候选方案与取舍

| 方案                    | 优点                                                                         | 当前不作为默认方案的原因                                             | MUS-001 验证项                                    |
| ----------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| `HTMLAudioElement`      | 无新依赖；原生支持 MP3、seek、volume、媒体事件和自动播放策略；最容易维持单例 | 需要自行实现状态同步和 UI                                            | Chromium/移动端事件顺序、Range seek、错误态       |
| Howler.js               | 成熟的跨浏览器音频抽象，提供 preload/volume/event API                        | 需求只有单音轨 MP3；会增加状态双写，UI 仍需自建                      | 只有原生方案出现可复现兼容问题时才采用            |
| `react-h5-audio-player` | 现成 React 控件和基础可访问性                                                | 固定布局与本项目的悬浮入口、环形进度和自定义对话框不匹配             | 记录许可证、React 19/Next 16 兼容性和样式覆盖成本 |
| APlayer                 | 自带播放列表和完整播放器界面                                                 | DOM/CSS 所有权较强，难与当前主题变量、根 Provider 和题库式对话框解耦 | 仅作为交互参考，不直接嵌入生产模块                |

技术试验不能只比较截图。必须比较许可证、最近维护状态、React 19 与 Next 16 兼容性、SSR 安全、压缩后体积、键盘语义以及在根布局中保持实例的能力。没有明确收益时保持原生方案。

## 模块所有权

`MusicPlayerProvider` 是运行时状态唯一所有者；UI 通过窄接口消费状态和命令：

```ts
type MusicPlayerViewState = {
  queue: readonly MusicTrack[];
  currentTrack: MusicTrack | null;
  status: "idle" | "loading" | "playing" | "paused" | "error";
  duration: number;
  currentTime: number;
  volume: number;
  muted: boolean;
  error: string | null;
};

type MusicPlayerCommands = {
  play(): Promise<void>;
  pause(): void;
  togglePlayback(): Promise<void>;
  previous(): void;
  next(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  applySelection(trackIds: readonly string[]): void;
};
```

最终类型可以调整命名，但必须保持以下边界：

- 只有 Provider/adapter 读写 `audio.currentTime`、`audio.volume`、`audio.muted` 和 `audio.src`。
- 悬浮按钮、卡片和对话框不得分别订阅原生媒体事件。
- 页面不得根据路由改变播放状态，也不得持有 Provider 的镜像状态。
- 组件 UI 的打开/关闭状态可以留在 `MusicPlayerRoot`，不写入播放 reducer 或持久化设置。

## 曲库模型

建议用两张静态表，避免在每条曲目中重复专辑资料：

```ts
type MusicAlbum = {
  id: string;
  title: string;
  titleJa?: string;
  artist?: string;
  releaseYear?: number;
  order: number;
  coverUrl: `/music/covers/${string}`;
  sourceRefs: string[];
};

type MusicTrack = {
  id: string;
  albumId: string;
  trackNumber: number;
  title: string;
  titleJa?: string;
  artists: string[];
  composer?: string;
  arranger?: string;
  audioUrl: `/music/tracks/${string}.mp3`;
  coverUrl?: `/music/covers/${string}`;
  sourceRefs: string[];
};
```

约束如下：

- `id` 使用发布后不因翻译变化而修改的 ASCII 稳定 ID。
- 默认播放顺序为 `album.order`、`trackNumber`、`track.id`；用户首版只能筛选，不能重排。
- 曲目封面解析为 `track.coverUrl ?? album.coverUrl`，仍失败时由 `TrackCover` 切换到 `/music/placeholder-cover.png`。
- 曲长以浏览器读取的媒体 metadata 为准，不在 JSON 中维护容易漂移的 `duration`。
- `sourceRefs` 是资料来源，不是运行时媒体 URL；生产页面不得热链这些地址。
- 数据校验应拒绝重复 ID、重复专辑顺序、重复专辑内曲号、失效 album 引用、越出 `/music/` 的路径和缺失文件。

音乐目录暂不进入 Postgres、OpenAPI 或 Go seed。它是随 Web 构建发布的小型静态目录；未来只有出现远程管理、权限、跨客户端同步或超大规模曲库时，才另行设计服务端目录。

## 播放与队列语义

| 事件         | 行为                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| 初次进入网站 | 加载已保存筛选和当前曲目，但保持暂停；`preload="metadata"`，不预取整个列表。                         |
| 点击播放     | 调用当前音频实例的 `play()`；Promise 成功后进入 playing，失败则回到 paused/error 并提示用户。        |
| 点击暂停     | 立即 `pause()`，不清空 `currentTime`。                                                               |
| 点击下一首   | 从当前启用队列移动到下一项；末项回到首项。若切换前正在播放，新曲 metadata 就绪后继续播放。           |
| 点击上一首   | 从当前启用队列移动到上一项；首项回到末项。首版不实现“播放超过 N 秒先回到曲首”的另一套语义。          |
| 曲目自然结束 | 等同 `next()`，包括末项回到首项，并延续播放意图。                                                    |
| 拖动进度条   | 在有效 `duration` 内 clamp；拖动期间 UI 显示草稿时间，提交后一次写入 `currentTime`。                 |
| 应用新曲库   | 保持曲库定义顺序。当前曲目仍被选择时不换歌；若被移除，则切到新队列第一首。这个中断来自用户主动操作。 |
| 音频加载失败 | 当前曲目进入 error，不自动连续跳过，避免所有资源失效时形成循环；上一首/下一首和曲库设置仍可用。      |
| 列表为空     | 对话框不允许提交；若本地旧数据归一化后为空，回退为当前目录全部曲目。                                 |

切歌必须保留用户的播放意图，但不能把 `autoplay` 属性作为绕过策略。初次加载或硬刷新后没有播放意图，必须保持暂停。

## 音量与静音

- 音量范围为 `0..1`，默认 `0.7`。
- 图标分段：muted 或 `0` 使用 `VolumeX`；`(0, 0.34)` 使用 `Volume`；`[0.34, 0.67)` 使用 `Volume1`；`[0.67, 1]` 使用 `Volume2`。
- 点击图标切换静音。静音前记录最近一次非零音量；取消静音恢复该值，无记录时恢复 `0.7`。
- 拖动音量到 `0` 后展示静音图标；再次提高滑块自动取消静音。
- UI 状态、`audio.volume`、`audio.muted` 和持久化设置由一个命令路径同步，不能出现四处分别更新。

## 本地持久化

存储键建议为 `touhoufriberg:music-player`：

```ts
type StoredMusicPlayerSettingsV1 = {
  schemaVersion: 1;
  selectedTrackIds: string[];
  currentTrackId?: string;
  volume: number;
  muted: boolean;
  lastNonZeroVolume?: number;
};
```

加载时执行 schema 校验和目录归一化：删除未知/重复 ID，按目录顺序重排，校正音量，确认当前曲目仍在队列中。解析失败、版本未知或归一化后无曲目时使用安全默认值并覆盖坏数据。新加入目录的曲目不应无提示地进入一个已由用户自定义的列表；首次访问才默认全选。

不保存以下状态：

- `isPlaying` 或待播放意图；
- `currentTime`、`duration` 和 buffering 状态；
- 卡片/对话框是否打开；
- 媒体错误文本。

因此浏览器刷新会停止并回到暂停，符合“只在整页刷新/关闭或用户操作时影响播放”的边界，也不会触发自动播放限制。

## 根布局与导航连续性

`MusicPlayerRoot` 作为 Client Component 由 `apps/web/src/app/layout.tsx` 挂载一次，位置在页面内容容器之外、`</body>` 之前。它不能：

- 带有与 `pathname`、页面参数或游戏 session 绑定的 React `key`；
- 被放进 `page.tsx`、具体 route layout 或会在导航时切换的 Suspense fallback；
- 在卡片收起时条件卸载 Provider 或 `<audio>`；
- 使用模块级浏览器单例掩盖错误挂载，因为这会污染 HMR 和测试。

验收所称“页面变化不中断”只保证站内 `Link`/`router.push` 产生的客户端导航。地址栏输入、浏览器刷新、关闭标签页和离站导航本来就会销毁文档，不承诺跨文档继续播放。

## 主题、布局与动效

- 按钮和卡片的背景/文本/边框使用 `--surface`、`--paper`、`--ink`、`--ink-soft`、`--line`。
- 圆环、线性进度和音量填充使用 `--accent`；对比文本使用 `--accent-contrast`。
- 深浅模式和主题色变更通过 CSS 自定义属性自动生效，播放器不监听或复制 `AppearanceSwitcher` 状态。
- 环形进度使用 SVG circle；通过 `transform: rotate(-90deg)` 从 12 点开始，`stroke-dashoffset` 映射 `currentTime / duration`。无有效 duration 时显示 0%，不能产生 `NaN` 样式。
- 展开卡片使用短距离位移、透明度和轻微缩放，变换原点位于右上按钮；收起后不可聚焦、不可点击。
- `prefers-reduced-motion: reduce` 下关闭位移/缩放和标题自动跑马灯，保留状态即时变化；完整标题仍可通过可访问名称和 tooltip 获取。

播放器需要自己的 stacking context。建议浮动入口/卡片低于当前 `z-50` 的全屏游戏弹层，曲库对话框使用 Ant Design portal 的统一 modal 层级。移动端必须同时避开 68px 底部导航和 safe-area，但播放器仍保持右上锚点。

## 标题与封面

- 封面容器使用稳定正方形尺寸和 `object-fit: cover`，加载中、成功和失败不能改变卡片布局。
- `TrackCover` 在 `onError` 时只回退一次，防止占位图本身失效造成事件循环；占位图失效时再使用纯色背景和音乐图标。
- 标题只有 `scrollWidth > clientWidth` 时才启用横向循环；短标题不动。
- 跑马灯首尾之间保留可读间隔，鼠标悬停或键盘聚焦时可暂停；屏幕阅读器只读取一次完整标题。
- 元信息优先显示艺人/作曲与专辑名，不把所有数据字段堆进紧凑卡片。

## 曲库设置对话框

- 对话框借鉴 `QuestionScopeDialog` 的尺寸、标题栏、卡片密度、深浅色 token 和移动端行为，但作为 feature-local 组件实现。
- 使用“按专辑 / 按曲目”分段控件。专辑视图展示封面、专辑名和已选数量，复选框支持 `checked/indeterminate/unchecked`；曲目视图展示每首曲目的封面、标题、专辑和艺人。
- 两个视图编辑同一份草稿；切换视图不会提交。
- 打开时从当前生效选择复制草稿；取消、Escape 或关闭只丢弃草稿；应用时校验至少一首、一次提交并持久化。
- 首版不提供导入、导出、上传音频、拖拽排序、搜索、远程同步或专辑播放模式。

## 素材与发布约束

MUS-002 可以从用户指定的 THBWiki 官方音乐 CD 页面选择 3 首实验曲目，但“页面可访问”不等于“允许仓库再分发”。每项资产都需要记录专辑、曲号、来源页、实际下载地址、获取日期、权利/使用说明、仓库路径和站内用途；信息写入 `THIRD_PARTY_ASSETS.md` 与 `apps/web/public/music/README.md`。

首批资产直接进入普通 Git，保持部署链简单；当前仓库没有 Git LFS 配置。建议首批 3 个 MP3 总计不超过 50 MiB、单张封面不超过 2 MiB。若合法来源文件超出预算，应在 MUS-002 先记录压缩、LFS 或外部对象存储的取舍，不能绕过预算直接提交，也不能以外链代替本地资产。

生产发布必须确认静态服务支持 MP3 的正确 `Content-Type` 与 byte-range 请求，否则拖动进度会退化或失败。这个检查属于 MUS-007 和发布闸门，而不是播放器内核用 JavaScript 补救的内容。
