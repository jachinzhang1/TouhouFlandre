# MUS-003：常驻播放内核与状态机

**类型**：功能/前端基础 Issue  
**优先级**：P0  
**依赖**：MUS-001、MUS-002  
**建议标签**：`type:feature` `area:web` `area:architecture` `area:test`

## 要解决的问题

当前站点没有常驻媒体对象。若播放逻辑放在展开卡片或具体页面中，收起卡片、切换路由、打开设置或 React 重渲染都可能销毁音频、重置进度或重复注册事件。上/下一首、自然结束、播放失败和曲库更新也需要共用一套确定性状态机。

本 Issue 只建立可靠播放能力和根布局生命周期，为所有 UI 提供窄接口。

## 目标

1. 在 `RootLayout` 下挂载唯一 `MusicPlayerRoot`/Provider 和唯一 `<audio preload="metadata">`。
2. 实现目录到有效队列的派生、当前曲目选择、播放/暂停、seek、上/下一首和自然结束循环。
3. 实现音量分段、静音/取消静音和最近非零音量恢复。
4. 将原生媒体事件归一化为可测试状态，正确处理快速切歌、旧事件、`play()` 拒绝和媒体错误。
5. 用单元测试和最小 Playwright 用例证明站内软导航不打断播放。

## 属于本 Issue

- `MusicPlayerProvider`、reducer、audio adapter、catalog adapter 和公开 hook。
- 根布局的一次性挂载；Provider 不依赖 `pathname`、游戏 session 或页面 props。
- 媒体事件监听、清理、source 切换和过期事件防护。
- `currentTime`/`duration` 的有限数值校验与 clamp。
- 队列首尾循环；自然结束自动下一首并继续播放。
- 用户主动切歌时延续切歌前的播放意图。
- 播放错误状态和可恢复命令；失败曲目不自动无限跳过。
- 音量、muted、`lastNonZeroVolume` 的统一命令路径。
- 供 UI 使用的格式化无关原始状态；时间文本格式化可以作为纯函数放在 feature 内。
- React Strict Mode、测试重复 mount 和 HMR 下不重复订阅事件。

## 不属于本 Issue

- 不实现最终圆形按钮、环形 SVG、卡片布局或曲库对话框。
- 不在此 Issue 完成本地设置 UI；持久化的完整提交语义由 MUS-006 实现。为测试队列可提供内存命令。
- 不保存播放秒数或自动恢复播放。
- 不实现随机播放、单曲循环、队列拖拽、歌词、媒体快捷键或 Media Session API。
- 不处理跨浏览器标签页同步，也不尝试在页面关闭后继续播放。

## 可能涉及的代码

- `apps/web/src/app/layout.tsx`
- `apps/web/src/features/music-player/MusicPlayerRoot.tsx`
- `apps/web/src/features/music-player/MusicPlayerProvider.tsx`
- `apps/web/src/features/music-player/playerReducer.ts`
- `apps/web/src/features/music-player/audioAdapter.ts`
- `apps/web/src/features/music-player/catalog.ts`
- 同目录 `*.test.ts(x)`
- `apps/web/e2e/music-player-lifecycle.spec.ts`

## 状态与事件要求

### 单例生命周期

- `<audio>` 始终由 Provider 渲染，卡片收起时仍存在。
- `src` 只在 `currentTrack.id` 真正变化时更新；普通 render 不调用 `load()`。
- effect cleanup 精确移除同一组 listener，不能用匿名函数导致泄漏。
- 事件处理携带当前 source/token；快速点击“下一首”时，旧 source 的 `loadedmetadata`/`error` 不覆盖新曲状态。

### 播放意图

状态需要区分“媒体当前是否 playing”和“切歌完成后是否应继续播放”。例如播放中点击下一首：先设置新 source，进入 loading；metadata/canplay 后尝试 `play()`；若 Promise 拒绝，清除继续播放意图并向 UI 暴露错误。

暂停状态切换曲目只加载 metadata，不应突然播放。首次访问与刷新后也不自动播放。

### seek

- `duration` 非有限数、`<= 0` 或 metadata 未就绪时禁用 seek。
- adapter 接收秒数并 clamp 到 `[0, duration]`。
- UI 拖动中的草稿属于 MUS-005；内核只处理已提交 seek 和 `seeking/seeked` 状态。

### 队列变化

- 队列按目录固定顺序派生，不按用户提交 ID 的顺序排列。
- 当前曲目仍在新队列时保持 source 和时间。
- 当前曲目被移除时切到队列第一首；若此前播放中则尝试继续播放。
- 非法空队列输入由边界层拒绝；内核仍应能安全表达 `currentTrack=null`，避免异常崩溃。

## 验收标准

- [ ] 根布局内始终只有一个音频元素；打开/关闭任何播放器 UI 不改变其引用。
- [ ] 首页播放后通过 `Link` 依次进入至少两个其他页面，`currentSrc` 不变、时间继续前进且没有额外暂停。
- [ ] 刷新后保持曲目/音量偏好但处于暂停，不调用自动播放。
- [ ] 上一首在首项回到末项，下一首在末项回到首项，`ended` 与下一首使用同一循环逻辑。
- [ ] 暂停时切歌仍暂停；播放时切歌在允许的情况下继续播放。
- [ ] 快速连续切歌不会被旧曲目的 metadata/error 事件回滚。
- [ ] `duration=NaN/Infinity/0`、越界 seek 和加载失败均不会产生异常或无效 CSS 数值。
- [ ] 播放失败后状态与实际 audio 一致，用户仍可暂停、重试、切歌或打开设置。
- [ ] 音量图标所需等级由纯函数派生；静音前后的音量恢复符合决策文档。
- [ ] 单元测试不依赖真实网络；真实媒体和导航连续性由 Playwright 覆盖。

## 测试计划

Vitest 至少覆盖：

- reducer 的播放、暂停、loading、error 状态转换；
- 3 首队列的 prev/next/ended 首尾循环；
- 当前曲目被保留/移除时的队列更新；
- metadata 无效、seek clamp、旧 source 事件忽略；
- `play()` resolve/reject；
- 音量 0、阈值边界、mute 和恢复默认值；
- listener 注册/清理数量。

Playwright 至少覆盖真实 MP3 开始播放、软导航、返回、硬刷新和无控制台未处理 Promise rejection。

## 依赖与后续

依赖 MUS-001 的技术契约和 MUS-002 的有效目录。完成后 MUS-004、005、006 可以只使用公开 hook 并行实现；若它们需要新增内核能力，应回到本 Issue 扩充契约，而不是直接拿 audio ref。
