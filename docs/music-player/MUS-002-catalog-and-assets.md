# MUS-002：曲库模型、本地素材与校验

**类型**：数据/素材 Issue  
**优先级**：P0  
**依赖**：MUS-001  
**建议标签**：`type:data` `area:web` `area:assets` `area:license`

## 要解决的问题

播放器需要稳定的专辑、曲目、音频和封面映射。把这些信息直接写在 React 组件中会难以校验和维护；只把 MP3 丢进 `public` 又无法保证 ID、顺序、来源和封面关系。另一方面，MP3 是较大的二进制文件，错误的热链、授权记录缺失或无限制提交会影响部署和仓库体积。

本 Issue 建立类似角色数据库的静态曲库维护链，并加入 3 首可用于后续播放器验收的实验曲目。

## 目标

1. 在 `packages/data` 建立专辑和曲目 JSON、Zod schema、类型导出及跨记录校验。
2. 为 Web 提供不会连带导入完整角色数据的 `@touhouflandre/data/music` 子入口。
3. 建立 `apps/web/public/music/{tracks,covers}` 和稳定占位图约定。
4. 从用户指定的 THBWiki 官方音乐 CD 页面选取 3 首 MP3，并使用对应专辑封面；所有运行时资产本地化且进入 Git。
5. 完成素材来源、授权、大小预算和发布路径记录。

## 建议数据结构

- `packages/data/src/music/albums.demo.json`
- `packages/data/src/music/tracks.demo.json`
- `packages/data/src/music/schema.ts`
- `packages/data/src/music/index.ts`
- `apps/web/public/music/tracks/<album-id>/<track-id>.mp3`
- `apps/web/public/music/covers/<album-id>.<png|jpg|webp>`
- `apps/web/public/music/placeholder-cover.png`
- `apps/web/public/music/README.md`

具体字段遵循[曲库模型决策](./decisions.md#曲库模型)。专辑封面是默认值，曲目可用 `coverUrl` 覆盖；因此每首曲目总能解析到一个候选封面，又不需要重复专辑 URL。

## 属于本 Issue

- 设计和实现 `MusicAlbum`、`MusicTrack` schema。
- 校验稳定 ID、专辑引用、排序、曲号、URL 前缀、MP3 扩展名和源链接。
- 校验元数据引用的本地文件存在；占位图也进入存在性检查。
- 添加独立 package export，必要时在 `apps/web/package.json` 声明 `@touhouflandre/data` 的直接 workspace 依赖。
- 让现有 `pnpm --filter @touhouflandre/data validate` 同时验证角色/作品与音乐，不另建容易被遗漏的手工命令。
- 添加 schema 和跨记录 Vitest：重复 ID、缺失 album、重复曲号、越界 URL、缺失文件、稳定排序。
- 选取 3 首曲目，确认同一专辑或不同专辑都能覆盖专辑分组验收；至少要能测试列表首尾循环。
- 更新 `THIRD_PARTY_ASSETS.md`，并在音乐目录 README 中记录每个文件的来源与用途。
- 记录文件大小；首批 3 个 MP3 总计建议不超过 50 MiB，单张封面不超过 2 MiB。

## 不属于本 Issue

- 不实现播放、进度、音量或 React 界面。
- 不把曲库写入 Postgres，不增加 API route、OpenAPI schema 或 Go seed。
- 不提供后台编辑、上传、导入导出或远程同步。
- 不抓取整个 THBWiki 音乐目录，不批量镜像所有官方 CD。
- 不把远程站点 URL 当作 `audioUrl`/`coverUrl`，不在生产运行时热链。
- 不引入 Git LFS，除非先在本 Issue 记录仓库、CI 和生产部署的完整迁移方案并得到维护者确认。

## 素材获取与记录流程

1. 从用户给定的 `https://thwiki.cc/官方音乐CD` 进入具体专辑和曲目来源，选取 3 首明确提供 MP3 的曲目。
2. 对每首曲目记录专辑名、曲号、展示名、艺人/作曲信息、页面 URL、实际下载 URL、获取日期和使用/再分发说明。
3. 获取对应专辑封面，记录图片来源与使用说明；不可使用来源不明的搜索结果缩略图。
4. 下载到临时目录后确认 MIME、扩展名、可解码性、时长和大小，再以 ASCII 稳定 ID 命名并移动到 `public/music`。
5. 页面说明不足以证明允许 Git 再分发时停止提交，先在 Issue 中补充依据；“可以在线试听/下载”与“允许重新分发”不得混为一谈。
6. 在 `THIRD_PARTY_ASSETS.md` 中声明这些素材不自动适用仓库 MIT License，并保留要求的署名/非官方声明。
7. 运行数据校验和 Git 大文件检查，确认没有临时文件、下载页面、重复编码版本或未引用素材。

用户已说明这些测试曲目无版权问题，但实施者仍需把可核查来源和使用条件写进仓库，以便未来维护者知道文件为何可以随 Git 分发。

## 封面失败策略

构建时校验可以防止已知路径漏交，但不能替代运行时回退：CDN 响应错误、图片损坏或浏览器解码失败仍可能发生。MUS-002 只提供稳定占位图和解析函数；实际 `onError` 一次性回退由 MUS-005 实现。测试可通过 mock URL/网络拦截制造失败，不要故意在生产 JSON 中提交坏路径。

## 验收标准

- [ ] `albums.demo.json`、`tracks.demo.json` 均通过 Zod，并至少包含 1 张专辑、3 首可播放 MP3。
- [ ] 曲目 ID、专辑 ID、专辑顺序和专辑内曲号满足唯一性与稳定排序规则。
- [ ] 每首曲目的 `audioUrl` 和解析后封面 URL 均指向仓库内 `/music/` 资产。
- [ ] `@touhouflandre/data/music` 可被 Web 单独导入，不执行角色目录构建，也不把整个角色 JSON 打进播放器客户端 chunk。
- [ ] `pnpm --filter @touhouflandre/data validate` 对缺失 MP3、封面和占位图稳定失败，并给出曲目/专辑 ID。
- [ ] 3 个 MP3 可由 Chromium 读取 metadata 和播放；文件扩展名、实际 MIME 与编码一致。
- [ ] `THIRD_PARTY_ASSETS.md` 和 `apps/web/public/music/README.md` 记录来源、作者/权利方、使用条件、仓库位置和站内用途。
- [ ] 首批资产满足大小预算；若超出，Issue 中已有获批的替代方案。
- [ ] Git diff 不含临时下载文件、缓存、未引用封面或同曲目的多个随意转码版本。

## 测试计划

- `pnpm --filter @touhouflandre/data typecheck`
- `pnpm --filter @touhouflandre/data validate`
- `pnpm --filter @touhouflandre/data test`
- `pnpm --filter @touhouflandre/web build`，确认 workspace 子入口可被 Next.js 正确打包
- 对 3 个公开静态 URL 执行 HEAD/Range 检查；生产代理的最终检查留给 MUS-007

## 依赖与后续

依赖 MUS-001 冻结数据消费方式。MUS-003、MUS-005 和 MUS-006 消费本 Issue 的目录；后续新增曲目可以沿用同一 schema、校验和授权流程，通常不需要修改播放器代码。
