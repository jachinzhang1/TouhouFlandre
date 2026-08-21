# 音乐播放器架构与行为决策

本文记录所有播放器 Issue 共用的冻结决策。MUS-001 已于 2026-08-20 通过最小技术试验核实本页结论；后续实现若发现可复现的反例，应先回到拥有该决策的 Issue 更新本文，不能在 UI 组件中建立另一套语义。

## 技术方案

### 冻结基线

- **媒体内核**：浏览器原生 `HTMLAudioElement`，由根级 React Provider 持有唯一实例；不新增音频依赖。
- **界面**：项目内 React 组件；复用现有 `antd` 的 `Modal`、`Checkbox`、`Slider`、`Segmented`、`Tooltip` 和主题桥接，图标使用现有 `lucide-react`。
- **状态**：feature-local Context + reducer；不为单一全局组件引入新的全局状态库。
- **曲库**：`packages/data` 的独立 `@touhouflandre/data/music` 子入口，使用 JSON + Zod；音频和图片位于 `apps/web/public/music`。
- **持久化**：浏览器 `localStorage`，带 `schemaVersion` 和损坏数据回退。

### 候选方案与取舍

以下数据于 2026-08-20 从 npm registry 的发布元数据、包内 manifest/LICENSE 和压缩后的发行文件核对。gzip 是入口发行文件的直接压缩估算，不等同于 Next.js 最终 chunk；候选包未安装，因此 `package.json` 和锁文件没有变化。

| 方案                    | 核对版本 / 许可证 / 最近发布                      |                                    gzip 估算 | React 19、Next 16 与 SSR                                                                                          | 样式、无障碍和状态所有权                                                                                       | 结论                                         |
| ----------------------- | ------------------------------------------------- | -------------------------------------------: | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `HTMLAudioElement`      | 浏览器平台能力，无第三方许可证                    |                                        0 KiB | 根布局 Client Component 在 Desktop Chromium 与 Pixel 7 项目通过软导航/刷新 Spike；服务端只输出稳定 `<audio>` 宿主 | 完全使用现有 CSS 变量和自有中文 accessible name；Provider 可独占状态                                           | **采用**                                     |
| Howler.js               | `howler@2.2.4`，MIT，2023-09-19                   |                              core 约 7.8 KiB | 框架无关，入口用 `typeof window` 防护导入；运行时仍必须留在客户端                                                 | 没有 UI/a11y 收益；内部 Howl 状态会与 Provider 形成第二层同步                                                  | 不采用；仅在原生媒体出现可复现兼容缺陷时重评 |
| `react-h5-audio-player` | `3.10.2`，MIT，2026-07-29；peer 显式包含 React 19 | JS + CSS 约 12.9 KiB，另依赖 Iconify runtime | React 19 peer 满足；可作为 Client Component 放入根布局，但不为导航生命周期提供额外保障                            | 自带 `<audio>`、内部 `forceUpdate`、英文默认 aria 文案和固定 DOM/CSS；无法保持本项目 Provider 为唯一状态所有者 | 不采用                                       |
| APlayer                 | `1.10.1`，MIT，2022-06-13                         |                         JS + CSS 约 15.9 KiB | UMD 入口顶层直接读取 `window`，SSR 必须 client-only 动态加载；没有 React 19 集成契约                              | 自带播放列表、图标、DOM 和主题样式，需再写 React adapter 且难由外部单例驱动                                    | 不采用，仅作交互参考                         |

原生方案已覆盖首版所需的 MP3、seek、volume、mute、媒体事件和自动播放 Promise 语义。第三方方案没有解决 Spike 中的可复现失败，却会增加状态同步或样式所有权，因此冻结为原生实现。

### MUS-001 技术试验记录

- 环境：WSL Ubuntu，Node `v24.13.0`，Next `16.3.0`，React `19.2.8`，Playwright `1.62.1`。
- 浏览器：Playwright `desktop-chromium` 与 `mobile-chromium`（Pixel 7）项目。
- 媒体：测试在浏览器内存中生成 8 秒 PCM WAV Blob；没有远程 URL、下载文件或仓库媒体资产。
- 软导航：首页播放后用站内 Link 进入 `/search` 并返回，`HTMLAudioElement` 引用、`currentSrc` 和播放状态不变，`currentTime` 单调前进，未增加 `loadstart` 或 `pause`。
- 硬刷新：`page.reload()` 后元素引用改变，`src` 为空、`paused=true`、`currentTime=0`，没有自动播放请求。
- 媒体事件：Chromium 中观测到 `loadstart` 先于 `loadedmetadata`，`loadedmetadata` 先于 `canplay`，`play` 先于后续 `timeupdate`；seek 与音量修改产生 `seeking`/`seeked` 和 `volumechange`。实现不依赖 `durationchange` 与 metadata 事件之间的绝对顺序。
- Promise 与失败：adapter 单元测试覆盖 `play()` resolve/reject；rejection 会清除播放意图并继续向 Provider 抛出，由 Provider 转换为可恢复错误。
- 注册与释放：adapter 使用具名闭包保存每种事件 handler，unsubscribe 精确移除同一引用；单元测试覆盖完整事件集合、换源重新绑定和释放后不再派发。

## 模块所有权

`MusicPlayerProvider` 是运行时状态唯一所有者；UI 通过窄接口消费状态和命令：

```ts
type MusicPlayerViewState = {
  queue: readonly MusicTrack[];
  currentTrack: MusicTrack | null;
  status: "idle" | "loading" | "playing" | "paused" | "error";
  isSeeking: boolean;
  duration: number;
  currentTime: number;
  volume: number;
  muted: boolean;
  error: string | null;
};

type MusicPlayerRuntimeState = MusicPlayerViewState & {
  playbackIntent: "paused" | "playing";
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
- `playbackIntent` 是 reducer 内部状态，不通过公开 hook 暴露；UI 只显示真实媒体归一化后的 `status`。
- 悬浮按钮、卡片和对话框不得分别订阅原生媒体事件。
- 页面不得根据路由改变播放状态，也不得持有 Provider 的镜像状态。
- 组件 UI 的打开/关闭状态可以留在 `MusicPlayerRoot`，不写入播放 reducer 或持久化设置。

冻结文件边界：

```text
apps/web/src/features/music-player/
  contracts.ts             # UI 可见状态、命令和目录结构类型
  audioAdapter.ts          # 唯一允许读写 HTMLAudioElement 的边界
  MusicPlayerRoot.tsx      # 根布局稳定宿主；MUS-003 在此接入 Provider
  MusicPlayerProvider.tsx  # MUS-003 实现状态机和公开 hook
  playerReducer.ts         # MUS-003 实现运行时状态转换
  storage.ts               # MUS-006 实现版本化偏好
  components/              # MUS-004 至 006，只消费公开 hook
```

`MusicAudioEvent` 必须携带 source generation。Provider 保存 `setSource()` 返回的 generation，只接受当前 generation 的事件；快速换歌产生的旧 metadata/error 不得回写。监听器只在 adapter 订阅时注册，在 unsubscribe 时用原 handler 引用逐一释放；React effect cleanup 必须调用 unsubscribe。

## 媒体事件映射

浏览器事件可能因缓存、解码器和 source 切换而交错，因此只冻结状态映射和必要偏序，不冻结完整全序：

| 来源                                | Provider 行为                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| 设置新 source / `loadstart`         | 清空瞬时时间与错误，进入 `loading`；保留 reducer 内的播放意图                 |
| `loadedmetadata` / `durationchange` | 仅接收有限且 `> 0` 的 duration；不自行开始播放                                |
| `canplay`                           | 若播放意图为 `playing`，调用一次 `play()`；否则进入 `paused`                  |
| `play`                              | 将实际状态置为 `playing`                                                      |
| `pause`                             | 媒体未 ended 时置为 `paused`；用户 pause 命令同时清除播放意图                 |
| `timeupdate`                        | clamp 后更新 `currentTime`；更新范围限制在播放器 feature                      |
| `seeking` / `seeked`                | 切换 `isSeeking`；UI 拖动草稿仍由 MUS-005 局部持有                            |
| `ended`                             | 走与 `next()` 相同的列表循环路径，并保留播放意图                              |
| `volumechange`                      | 从 audio 回读并归一化 `volume`/`muted`，不让 UI 维护副本                      |
| `error`                             | 当前曲目进入可恢复 `error`，清除继续播放意图，不自动跳过                      |
| `play()` rejection                  | 捕获 Promise，清除播放意图，映射为暂停/错误反馈；不得留下 unhandled rejection |

必要偏序只有：`loadstart` 在当前 source 的 metadata/canplay 前，成功的 `play()` 调用在 `play`/后续 `timeupdate` 前，`seeking` 在对应 `seeked` 前。reducer 必须允许重复的 metadata/duration/timeupdate，并忽略旧 generation。

## 浏览器与测试基线

- 发布阻断自动化基线为当前 Playwright 的 Desktop Chromium 与 Pixel 7 Chromium。
- Chromium 对 MP3 解码、MIME 和 byte-range 的真实验证在 MUS-002 提供本地 MP3 后由 MUS-003/MUS-007 完成；MUS-001 的 WAV Blob 只验证媒体和文档生命周期。
- Safari 与 Firefox 首版不列为自动化发布阻断环境；实现保持标准媒体 API，不承诺尚未执行的浏览器专项结果。
- Vitest 使用可编程 `HTMLAudioElement` 替身，mock `play`/`pause`/`load` 并显式派发事件；MUS-001 已覆盖 Promise 失败、generation 和 listener cleanup，MUS-003 再用同一策略覆盖 reducer，不模拟真实解码或自动播放策略。
- Playwright 不 mock 媒体方法，负责真实浏览器事件、播放推进、客户端导航和刷新边界。
- 自动播放只允许由用户手势调用 `play()`；不得使用 `autoplay`、持久化 playing 或挂载时自动重试绕过浏览器策略。

## 固定定位与层级基线

2026-08-20 的代码盘点如下。播放器入口/卡片冻结为独立 `z-index: 30` stacking context；它高于普通导航内容，但低于移动导航、聊天和全屏交互层。曲库 Modal 使用 Ant Design portal 的统一层级，不复用播放器 stacking context。

| 控件                                    |         当前层级 | 碰撞约束                                                  |
| --------------------------------------- | ---------------: | --------------------------------------------------------- |
| `SiteNav` 桌面内容                      |           `z-20` | 播放器右上定位需按实测导航高度下移，不能遮挡链接          |
| 播放器入口 / 卡片                       |           `z-30` | feature 内唯一 stacking context；不得局部递增到全屏层以上 |
| 移动底栏、`GuessInputBar`               |           `z-40` | 播放器保持右上并避开 safe area，不迁移到底部              |
| `ChatDock`                              |           `z-45` | 位于左下/底部，播放器不得改变页面 padding 与其耦合        |
| `QuestionScopeDialog`、倒计时、结果弹层 |           `z-50` | 全屏弹层覆盖播放器并阻止其接收指针                        |
| `AppearanceSwitcher`                    |           `z-60` | 位于右下，与播放器使用不同角落                            |
| 反馈 tooltip / 搜索建议                 | `z-80` / `z-100` | 瞬时 portal/提示保持可见，不作为播放器提层依据            |

若后续 Ant Design token 的默认 modal 层级与站点全屏层冲突，只能在统一 modal 主题配置中调整，不能在 `PlaylistDialog` 内写零散高值。

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
- MUS-002 当前目录不设置曲目级 `coverUrl`，因此曲目封面统一解析为所属专辑的 `album.coverUrl`；仍失败时由 `TrackCover` 切换到 `/music/placeholder-cover.png`。契约保留可选字段以兼容后续数据扩展。
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
  selectionMode: "default" | "custom";
  selectedTrackIds: string[];
  currentTrackId?: string;
  volume: number;
  muted: boolean;
  lastNonZeroVolume?: number;
};
```

`selectionMode` 用于区分首次访问的默认全选和用户明确提交过的列表。`default` 模式加载当前完整曲库，`custom` 模式只保留已知 ID，因此新加入目录的曲目不会自动进入已自定义列表。加载时执行 schema 校验和目录归一化：删除未知/重复 ID，按目录顺序重排，校正音量，确认当前曲目仍在队列中。解析失败、旧格式或归一化后无曲目时使用安全默认值并覆盖坏数据；没有存储记录的首次访问不预写默认值。未知新版本不能由旧代码覆盖成 v1，运行时使用默认值并保留原记录。旧的 v1 记录若缺少 `selectionMode`，按 `custom` 迁移以避免扩大用户已有选择。

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

MUS-002 可以从用户指定的 THBWiki 官方音乐 CD 页面选择 3 首实验曲目，但“页面可访问”不等于“允许仓库再分发”。每项资产的来源页面和实际本地化地址写入 `packages/data/src/music` 的曲库 JSON 与 `sourceRefs`，`THIRD_PARTY_ASSETS.md` 只提供覆盖整个音乐目录的授权声明，`apps/web/public/music/README.md` 只说明目录用途和布局。

首批资产直接进入普通 Git，保持部署链简单；当前仓库没有 Git LFS 配置。建议首批 3 个 MP3 总计不超过 50 MiB、单张封面不超过 2 MiB。若合法来源文件超出预算，应在 MUS-002 先记录压缩、LFS 或外部对象存储的取舍，不能绕过预算直接提交，也不能以外链代替本地资产。

生产发布必须确认静态服务支持 MP3 的正确 `Content-Type` 与 byte-range 请求，否则拖动进度会退化或失败。这个检查属于 MUS-007 和发布闸门，而不是播放器内核用 JavaScript 补救的内容。
