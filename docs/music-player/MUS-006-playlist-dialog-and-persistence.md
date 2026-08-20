# MUS-006：曲库设置对话框与本地持久化

**类型**：功能/前端设置 Issue  
**优先级**：P1  
**依赖**：MUS-002、MUS-003  
**建议标签**：`type:feature` `area:web` `area:data` `area:a11y`

## 要解决的问题

用户需要按专辑或单曲决定哪些音乐进入播放列表，并让选择在下次打开网站时保留。设置过程必须可以取消、能处理曲库升级和损坏的 localStorage，也不能因为取消或切换筛选视图而中断当前播放。

## 目标

1. 实现参考 `QuestionScopeDialog` 信息密度和交互方式的曲库设置对话框。
2. 通过“按专辑 / 按曲目”分段视图编辑同一份选择草稿。
3. 专辑复选支持全选、部分选择和全不选；曲目卡片带对应封面和元信息。
4. 应用时一次更新队列并持久化；取消不产生副作用。
5. 版本化保存曲目选择、当前曲目、音量和静音偏好，安全处理目录变化和坏数据。

## 属于本 Issue

- `PlaylistDialog`、专辑卡片、曲目卡片、三态专辑选择和选择计数。
- Ant Design `Modal`、`Segmented`、`Checkbox`、必要的 `ConfigProvider` 主题 token；图标使用 Lucide。
- 打开时从生效状态复制 draft；Apply/Cancel/Escape/遮罩关闭语义。
- 至少一首曲目的校验、错误文案和应用按钮 disabled 状态。
- `storage.ts` 的 v1 schema、解析、归一化、读取/写入和单元测试。
- 曲库版本变化：删除未知 ID、去重、按目录顺序重排、修正 currentTrack、音量 clamp。
- 当前曲目被取消选择后的确定行为：应用时切到新队列第一首，并按应用前播放意图决定是否继续。
- 首次访问默认全选；已经自定义过的列表在新增目录曲目时不自动加入新曲目。

## 不属于本 Issue

- 不实现导入/导出、上传文件、远程账户同步或跨设备同步。
- 不支持拖拽排序；曲目顺序来自曲库。
- 不修改曲库 schema 或提交新的 MP3/封面，除非发现 MUS-002 的数据契约缺陷并先回修。
- 不把设置写入 API、cookie、IndexedDB 或服务端数据库。
- 不持久化播放/暂停状态、当前秒数、dialog/card 打开状态或错误消息。
- 不增加搜索、标签、收藏、播放历史或“最近播放”列表。

## 可能涉及的代码

- `apps/web/src/features/music-player/components/PlaylistDialog.tsx`
- `apps/web/src/features/music-player/storage.ts`
- `apps/web/src/features/music-player/MusicPlayerRoot.tsx`
- `apps/web/src/features/music-player/MusicPlayerProvider.tsx`（只接入已定义的 `applySelection`）
- 同目录测试和 `apps/web/e2e/music-player-settings.spec.ts`

## 对话框结构

### 标题区

- 标题“调整曲目列表”；副文本显示“已选择 X / Y 首”。
- 关闭按钮使用 `X` 图标和 accessible name。
- 不在对话框里解释播放器功能或展示教程段落。

### 分段视图

- `Segmented` 选项为“按专辑”“按曲目”，两者共享一个 `Set<trackId>` draft。
- 专辑卡片显示封面、名称和 `selected / total`；Checkbox 根据数量呈现 checked/indeterminate/unchecked，点击卡片切换整张专辑。
- 曲目卡片显示解析后的曲目封面、标题、专辑和艺人；使用真实 Checkbox，不用纯颜色模拟选中。
- 每个视图可以提供“全选/全不选”命令，但全不选后应用按钮禁用并说明至少选择一首。
- 专辑卡片与曲目卡片分别是可重复卡片；不要把曲目卡片嵌套在专辑卡片里。

### 提交区

- “取消”丢弃 draft；“应用”先归一化再通过一个 Provider 命令提交。
- 保存 localStorage 失败时不能假装成功：内存选择可以继续生效，但提示本次设置可能无法在下次打开时保留。
- 应用后关闭并把焦点返回卡片中的曲库按钮；关闭播放器卡片后则返回悬浮入口。

## 持久化与迁移

使用 `touhoufriberg:music-player` 和[决策文档中的 v1 结构](./decisions.md#本地持久化)。禁止直接 `JSON.parse` 后断言类型；读取流程为：

1. 捕获 storage 不可用/读取异常；
2. JSON parse；
3. schemaVersion 分派；
4. 类型与范围校验；
5. 对当前 catalog 做 ID 清理、去重和排序；
6. currentTrack/volume/mute 修正；
7. 必要时写回修正结果。

未来增加 v2 时应提供显式 `v1 -> v2` 函数和测试。未知新版本不能由旧代码覆盖成 v1，以免降级访问破坏用户数据；旧/损坏无版本数据可以回退默认并记录一次开发态诊断。

## 验收标准

- [ ] 专辑视图和曲目视图编辑同一 draft，来回切换不丢选择也不提前影响播放。
- [ ] 专辑 Checkbox 在全选、部分、全不选时语义和视觉均正确。
- [ ] 每个曲目卡片显示对应封面，并复用 MUS-005 的 `TrackCover` 回退逻辑。
- [ ] 取消、Escape 和遮罩关闭均不修改有效队列或 localStorage。
- [ ] 至少选择一首才可应用；不存在空队列导致播放器崩溃的路径。
- [ ] 应用保留仍选中的当前曲目及其播放时间；移除当前曲目时切到第一首，并视为用户主动导致的切歌。
- [ ] 刷新后选择、当前曲目、音量和静音恢复，但保持暂停且从 0 秒开始。
- [ ] 损坏 JSON、未知 ID、重复 ID、越界音量、已删除 currentTrack 均有测试和安全回退。
- [ ] 新增目录曲目不会自动进入已自定义列表；首次访问默认全选。
- [ ] 深浅色/主题色、焦点圈、键盘 Tab 顺序、Escape 和移动端滚动符合站点对话框体验。
- [ ] 首版没有导入导出入口。

## 测试计划

- 纯函数：v1 parse/normalize、目录增删、重复/未知 ID、音量边界、currentTrack 修正。
- Testing Library：专辑三态、两个视图共享 draft、取消/应用、至少一首、focus return。
- Playwright：修改列表、播放、移除当前曲目、刷新恢复、清空/损坏 localStorage 后自愈、Pixel 7 对话框滚动。

## 依赖与后续

依赖 MUS-002 目录和 MUS-003 `applySelection`/音量命令。可以与 MUS-004、005 并行，但曲目封面组件应复用 MUS-005 的实现；若合并顺序相反，可以先定义共同接口，最终只保留一份组件。
