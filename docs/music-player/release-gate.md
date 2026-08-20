# 音乐播放器发布验收闸门

此清单由 MUS-007 执行。每次准备首次发布或修改播放内核、持久化 schema、曲库路径时，都应重新核对受影响项，并在 PR 中记录命令、环境和结果。没有证据的勾选不算通过。

## 1. 范围与代码所有权

- [ ] `MusicPlayerRoot` 只在 `apps/web/src/app/layout.tsx` 挂载一次。
- [ ] 页面、游戏、多人、题库和统计模块没有持有播放器状态或 audio ref。
- [ ] 展开/收起卡片、打开/关闭设置、客户端导航不会创建第二个 `<audio>`。
- [ ] 本次变更没有触及无关 API、数据库、协议或游戏规则。
- [ ] 新依赖均有用途、许可证和替代方案记录；无收益的试验依赖已移除。

## 2. 曲库与素材

- [ ] 专辑/曲目 JSON 通过 schema 与跨记录校验。
- [ ] 所有 `audioUrl`、封面和占位图映射到已跟踪的 `apps/web/public/music` 文件。
- [ ] 默认排序为专辑 order + trackNumber + track ID，ID 稳定且唯一。
- [ ] 3 首测试 MP3 均可读取 metadata、播放和 seek。
- [ ] 首批 MP3 总大小与单张封面大小符合 MUS-002 预算，或有明确获批的替代方案。
- [ ] `THIRD_PARTY_ASSETS.md` 和音乐目录 README 记录来源、权利/使用说明、获取日期、路径与用途。
- [ ] 没有远程热链、临时下载、未引用封面、重复转码或来源不明文件。

## 3. 播放行为

- [ ] 初次访问保持暂停；播放只能从用户手势开始。
- [ ] 播放/暂停状态与真实 audio 一致，`play()` rejection 可见且可恢复。
- [ ] 第一首 previous 回末首，末首 next 回第一首，自然 ended 进入下一首并保持列表循环。
- [ ] 暂停时切歌不自动播放；播放时切歌延续播放意图。
- [ ] seek clamp 正确，metadata 未就绪时控件禁用，拖动不被 `timeupdate` 抢回。
- [ ] 快速连续切歌时旧 source 事件不会覆盖当前曲目。
- [ ] 当前音频失败时不无限自动跳曲，其他控制仍可用。

## 4. 导航与持久化

- [ ] 播放中通过站内链接跨至少三个 route，audio 引用和 `currentSrc` 不变，`currentTime` 继续前进。
- [ ] 浏览器刷新后选择、当前曲目、音量和静音恢复，但保持暂停并从 0 秒开始。
- [ ] localStorage schema 带版本，坏 JSON、未知版本/ID、重复 ID 和越界音量有测试。
- [ ] 当前曲目仍在新选择中时 source/time 不变；被移除时按约定切换。
- [ ] 首次访问默认全选；已自定义列表不会自动加入后续新增曲目。
- [ ] 不持久化 playing、currentTime、duration、UI 打开状态或错误。

## 5. 视觉与主题

- [ ] 悬浮按钮在右上角，进度从 12 点开始，0/25/50/75/100% 映射准确。
- [ ] 按钮底色随深浅模式变化，圆环、歌曲进度和音量填充实时使用 `--accent`。
- [ ] 六种主题色均有计算样式断言；浅色/深色关键视图均有截图。
- [ ] 封面失败使用占位图，图片状态变化不改变布局。
- [ ] 只有溢出的标题启用跑马灯；短标题静止，reduced motion 下自动移动关闭。
- [ ] 卡片展开/收起平滑且不移动入口；隐藏后控件不可聚焦。
- [ ] 320px、Pixel 7、1024px、宽屏无横向 overflow、文字/按钮重叠或截断命令。
- [ ] 与移动底栏、固定输入、聊天、主题控件、题库 dialog、倒计时/结果 overlay 层级正确。

## 6. 曲库设置

- [ ] “按专辑 / 按曲目”共享同一 draft；专辑三态 Checkbox 正确。
- [ ] 每个曲目卡片显示对应封面、标题、专辑和艺人。
- [ ] Cancel、Escape、遮罩关闭不改变生效列表或持久化数据。
- [ ] 至少选择一首才可 Apply；提交后队列和 localStorage 一次更新。
- [ ] 设置 dialog 可滚动，header/footer 和主要操作在 Pixel 7 上可达。
- [ ] 首版没有导入/导出、上传、拖拽排序或远程同步入口。

## 7. 可访问性

- [ ] 仅用键盘可完成完整播放与曲库设置流程。
- [ ] 所有图标按钮有准确 accessible name，Slider 暴露名称和值，Checkbox 状态不只靠颜色。
- [ ] `aria-expanded`/`aria-controls` 正确；设置 dialog 有名称、modal 语义和焦点约束。
- [ ] 卡片/对话框关闭后焦点返回触发按钮。
- [ ] 错误、loading、playing/paused 有文本或语义状态，不只依赖图标动画。
- [ ] 200% 缩放和 `prefers-reduced-motion` 检查通过。

## 8. 网络与性能

- [ ] 开发和生产静态 URL 返回 `Content-Type: audio/mpeg`。
- [ ] 非零 byte Range 请求返回 206 与正确 `Content-Range`，实际拖动后可继续播放。
- [ ] 默认 `preload="metadata"`，首屏没有并行下载全部 MP3 主体。
- [ ] `timeupdate` 更新范围局限于播放器，不触发页面主体重复渲染。
- [ ] 切歌后旧请求/监听器可释放，没有成倍增长的 listener 或 network fetch。
- [ ] 控制台没有 hydration mismatch、未处理 media Promise rejection 或 React key 警告。

## 9. 自动化命令

- [ ] `pnpm --filter @touhouflandre/data typecheck`
- [ ] `pnpm --filter @touhouflandre/data validate`
- [ ] `pnpm --filter @touhouflandre/data test`
- [ ] `pnpm --filter @touhouflandre/web typecheck`
- [ ] `pnpm --filter @touhouflandre/web test`
- [ ] `pnpm --filter @touhouflandre/web build`
- [ ] 播放器 Playwright desktop Chromium 全部通过。
- [ ] 播放器 Playwright Pixel 7 全部通过。
- [ ] 截图差异已人工检查，无空白媒体、遮挡或布局漂移。

## 10. 发布与回滚

- [ ] `docs/features.md` 记录功能、软导航/硬刷新边界和本地设置范围。
- [ ] 若生产代理需要 Range/MIME 配置，`docs/deployment.md` 已同步。
- [ ] 禁用入口即可停止用户访问播放器，且不影响站点其他页面。
- [ ] 回滚代码时同时回滚目录引用；已发布静态资产可暂时保留，避免旧缓存页面 404。
- [ ] 发布后抽查第一首播放、下一首循环、主题切换、设置恢复和一个非零 Range 请求。

## 验收记录模板

```markdown
### MUS-007 验收记录

- 日期：
- 提交：
- 环境：本地开发 / production standalone / 反向代理
- Chromium：
- Pixel 7：
- 数据校验：
- Web typecheck/test/build：
- MIME/Range：
- 素材与授权复核：
- 已知限制：
- 回滚演练：
```
