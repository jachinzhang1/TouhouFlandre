# 音乐播放器发布验收闸门

此清单由 MUS-007 执行。每次准备首次发布或修改播放内核、持久化 schema、曲库路径时，都应重新核对受影响项，并在 PR 中记录命令、环境和结果。没有证据的勾选不算通过。

## 1. 范围与代码所有权

- [x] `MusicPlayerRoot` 只在 `apps/web/src/app/layout.tsx` 挂载一次。
- [x] 页面、游戏、多人、题库和统计模块没有持有播放器状态或 audio ref。
- [x] 展开/收起卡片、打开/关闭设置、客户端导航不会创建第二个 `<audio>`。
- [x] 本次变更没有触及无关 API、数据库、协议或游戏规则。
- [x] 新依赖均有用途、许可证和替代方案记录；无收益的试验依赖已移除。

## 2. 曲库与素材

- [x] 专辑/曲目 JSON 通过 schema 与跨记录校验。
- [x] 所有 `audioUrl`、封面和占位图映射到已跟踪的 `apps/web/public/music` 文件。
- [x] 默认排序为专辑 order + trackNumber + track ID，ID 稳定且唯一。
- [x] 3 首测试 MP3 均可读取 metadata、播放和 seek。
- [x] 首批 MP3 总大小与单张封面大小符合 MUS-002 预算，或有明确获批的替代方案。
- [x] `THIRD_PARTY_ASSETS.md` 提供覆盖音乐目录的授权声明，专辑/曲目 JSON 的 `sourceRefs` 记录逐项来源页面和实际本地化地址，URL 字段约束运行时仓库路径；音乐目录 README 仅说明目录用途。
- [x] 没有远程热链、临时下载、未引用封面、重复转码或来源不明文件。

## 3. 播放行为

- [x] 初次访问保持暂停；播放只能从用户手势开始。
- [x] 播放/暂停状态与真实 audio 一致，`play()` rejection 可见且可恢复。
- [x] 第一首 previous 回末首，末首 next 回第一首，自然 ended 进入下一首并保持列表循环。
- [x] 暂停时切歌不自动播放；播放时切歌延续播放意图。
- [x] seek clamp 正确，metadata 未就绪时控件禁用，拖动不被 `timeupdate` 抢回。
- [x] 快速连续切歌时旧 source 事件不会覆盖当前曲目。
- [x] 当前音频失败时不无限自动跳曲，其他控制仍可用。

## 4. 导航与持久化

- [x] 播放中通过站内链接跨至少三个 route，audio 引用和 `currentSrc` 不变，`currentTime` 继续前进。
- [x] 浏览器刷新后选择、当前曲目、音量和静音恢复，但保持暂停并从 0 秒开始。
- [x] localStorage schema 带版本，坏 JSON、未知版本/ID、重复 ID 和越界音量有测试。
- [x] 当前曲目仍在新选择中时 source/time 不变；被移除时按约定切换。
- [x] 首次访问默认全选；已自定义列表不会自动加入后续新增曲目。
- [x] 不持久化 playing、currentTime、duration、UI 打开状态或错误。

## 5. 视觉与主题

- [x] 悬浮按钮在右上角，进度从 12 点开始，0/25/50/75/100% 映射准确。
- [x] 按钮底色随深浅模式变化，圆环、歌曲进度和音量填充实时使用 `--accent`。
- [x] 六种主题色均有计算样式断言；浅色/深色关键视图均有截图。
- [x] 封面失败使用占位图，图片状态变化不改变布局。
- [x] 只有溢出的标题启用跑马灯；短标题静止，reduced motion 下自动移动关闭。
- [x] 卡片展开/收起平滑且不移动入口；隐藏后控件不可聚焦。
- [x] 320px、Pixel 7、1024px、宽屏无横向 overflow、文字/按钮重叠或截断命令。
- [x] 与移动底栏、固定输入、聊天、主题控件、题库 dialog、倒计时/结果 overlay 层级正确。

## 6. 曲库设置

- [x] “按专辑 / 按曲目”共享同一 draft；专辑三态 Checkbox 正确。
- [x] 每个曲目卡片显示对应封面、标题、专辑和艺人。
- [x] Cancel、Escape、遮罩关闭不改变生效列表或持久化数据。
- [x] 至少选择一首才可 Apply；提交后队列和 localStorage 一次更新。
- [x] 设置 dialog 可滚动，header/footer 和主要操作在 Pixel 7 上可达。
- [x] 首版没有导入/导出、上传、拖拽排序或远程同步入口。

## 7. 可访问性

- [x] 仅用键盘可完成完整播放与曲库设置流程。
- [x] 所有图标按钮有准确 accessible name，Slider 暴露名称和值，Checkbox 状态不只靠颜色。
- [x] `aria-expanded`/`aria-controls` 正确；设置 dialog 有名称、modal 语义和焦点约束。
- [x] 卡片/对话框关闭后焦点返回触发按钮。
- [x] 错误、loading、playing/paused 有文本或语义状态，不只依赖图标动画。
- [x] 200% 缩放和 `prefers-reduced-motion` 检查通过。

## 8. 网络与性能

- [x] 开发和生产静态 URL 返回 `Content-Type: audio/mpeg`。
- [x] 非零 byte Range 请求返回 206 与正确 `Content-Range`，实际拖动后可继续播放。
- [x] 默认 `preload="metadata"`，首屏没有并行下载全部 MP3 主体。
- [x] `timeupdate` 更新范围局限于播放器，不触发页面主体重复渲染。
- [x] 切歌后旧请求/监听器可释放，没有成倍增长的 listener 或 network fetch。
- [x] 控制台没有 hydration mismatch、未处理 media Promise rejection 或 React key 警告。

## 9. 自动化命令

- [x] `pnpm --filter @touhouflandre/data typecheck`
- [x] `pnpm --filter @touhouflandre/data validate`
- [x] `pnpm --filter @touhouflandre/data test`
- [x] `pnpm --filter @touhouflandre/web typecheck`
- [x] `pnpm --filter @touhouflandre/web test`
- [x] `pnpm --filter @touhouflandre/web build`
- [x] 播放器 Playwright desktop Chromium 全部通过。
- [x] 播放器 Playwright Pixel 7 全部通过。
- [x] 截图差异已人工检查，无空白媒体、遮挡或布局漂移。

## 10. 发布与回滚

- [x] `docs/features.md` 记录功能、软导航/硬刷新边界和本地设置范围。
- [x] 若生产代理需要 Range/MIME 配置，`docs/deployment.md` 已同步。
- [x] 禁用入口即可停止用户访问播放器，且不影响站点其他页面。
- [x] 回滚代码时同时回滚目录引用；已发布静态资产可暂时保留，避免旧缓存页面 404。
- [x] 发布后抽查第一首播放、下一首循环、主题切换、设置恢复和一个非零 Range 请求。

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

## MUS-007 验收记录（2026-08-21）

- 提交：工作树验收，尚未创建提交
- 环境：WSL 本地开发服务器；production standalone 本地 server（按 `apps/web/Dockerfile` 补齐 `public` 资源）
- Chromium：Desktop Chromium 与 Pixel 7 播放器全量 42/42 通过
- 数据校验：data typecheck、validate、test 通过（33 tests）
- Web typecheck/test/build：通过（Web 191 tests）
- MIME/Range：standalone MP3 资产 Desktop/Pixel 7 2/2 通过，`audio/mpeg`、206 Range、metadata 和 seek 可用
- 素材与授权复核：音乐目录资产、大小预算、`THIRD_PARTY_ASSETS.md` 和曲库 JSON `sourceRefs` 已存在且未新增未引用文件
- 已知限制：未连接外部反向代理；storage 不可用路径会产生 Ant Design static message context warning，但无 page error 或未处理媒体 Promise rejection
- 回滚演练：播放器由 `layout.tsx` 单点挂载，移除该节点即可停止入口；静态音乐资产保留以避免旧缓存 404
