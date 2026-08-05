# Phase 4 开发计划 — 前端迁移（Vite → Next.js App Router）

> 依据：[`05_tech_stack_migration.md`](../05_tech_stack_migration.md) §4/§5/§10/§13 Phase 4；[`07_productization_plan.md`](../07_productization_plan.md) §9 验收场景；[`phase03.md`](./phase03.md) §10 回归基线
> 状态：待评审（规划完成，未开始执行）
> 影响范围：`apps/web-next`（新建）、`apps/web`（替换）、`Taskfile.yml`、root/`apps/web` `package.json`、`pnpm-workspace.yaml`、CI、文档
> 原则：**并行目录迁移、页面级替换、行为平移优先；视觉回归用截图对比兜底；旧 Vite 实现保留在 git 历史（提交即回滚）**

---

## 1. 目标与边界

### 目标

1. 前端从 Vite + 手写 History API 路由迁移到 Next.js App Router + Tailwind CSS v4，全部 11 条路由与 Phase 3 行为一致（07 §9 游戏回归 + 浏览器场景）。
2. 建立前端测试：Vitest + React Testing Library（纯逻辑/hooks/组件）+ Playwright（路由、404、完整游戏流程、键盘/移动端/无障碍/视觉回归）。
3. `task dev` 一键启动 Next.js（5173）+ Go（4000），`/api` 代理语义与 Phase 3 一致。
4. 稳定后替换 `apps/web`，Vite 配置与依赖零残留。

### 非目标（本阶段明确不做）

- 不引入服务端取数（Server Component fetch Go API 推迟，见 D9）。
- 不做身份/登录（07 Stage 2；登录不是单机玩法前置条件，07 §2）。
- 不做多人页面实现（占位页平移即可；07 Stage 4）。
- 不拆解 `packages/shared`（Phase 5 职责，05 §11）。
- 不做生产部署与同源入口（07 Stage 5）。
- 不引入 shadcn/ui 或额外组件库（05 §5）。

---

## 2. 前置条件（Phase 3 交付物）

- [ ] Go 后端已接管 4000，`task dev` 编排可用（Phase 3 已完成）。
- [ ] 前端回归基线：Phase 3 记录的全部场景（每日题/随机题/搜索/分享/会话恢复/幂等）与页面形态可对照（phase03 §10）。
- [ ] OpenAPI 契约与 `apps/web/src/generated/api.ts` 一致（`gen:api` 可复现）。
- [ ] 迁移期并行运行环境：`apps/web`（Vite, 5173）与 `apps/web-next`（Next.js, 5173）可交替启动，共用同一 Go 后端与 Postgres。

---

## 3. 关键决策（规划期冻结）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **并行目录**：新建 `apps/web-next`，全部迁移完成且测试通过后再替换 `apps/web` | 05 §4.3 明确不在原目录边删边改；demo 规模无需 worktree |
| D2 | **端口固定 5173**：Next.js dev 用 `next dev -p 5173`，与 Vite 相同 | 保持 origin（`127.0.0.1:5173`）不变：localStorage 会话延续、`WEB_ORIGINS` CORS 白名单零改动 |
| D3 | **API 访问改同源**：`next.config` rewrites `/api` → `http://127.0.0.1:4000`；`lib/api.ts` 基址默认同源，保留 `NEXT_PUBLIC_API_BASE_URL` 直连选项 | 对齐目标拓扑（05 §3 同源入口）；rewrites 与 Vite proxy 语义等价；Phase 3 的 CORS 支持保留作直连选项 |
| D4 | **路由**：App Router 文件路由替换 `parseRoute`/`routePath`/`useRouter`（App.tsx）；导航高亮用 `usePathname`；`/single/[mode]` 非法模式 → `notFound()` | 05 §4.1/§4.2 路由映射表 |
| D5 | **样式**：Tailwind v4，`@theme` 直接映射 styles.css `:root` 现有 token（`--ink`/`--paper`/`--vermilion`/`--jade`/`--amber`/`--shadow-*` 等 17 个）；按页面迁移；保留 reset/字体/焦点可见/动画 | 05 §5；token 已存在，映射而非重设计 |
| D6 | **数据与逻辑边界**：API 层平移 `lib/api.ts`（openapi-fetch + `generated/api.ts`，契约唯一源）；搜索归一化在 `packages/shared`（不动）；游戏规则在 Go（前端不重复）；前端展示格式化落 `src/domain/` | 05 §7/§11；避免形成第二个后端（05 §14） |
| D7 | **测试**：Vitest + RTL 覆盖 domain 纯函数、hooks、Client Components；Playwright 覆盖路由/404/游戏全流程/键盘/移动端/视觉截图对比（新旧应用同页面截图 diff） | 05 §10；不引入 Jest/Cypress |
| D8 | **会话延续**：localStorage key（`touhoufriberg:daily-session`/`random-session`）不变；迁移期新应用在同一 origin 可直接恢复进行中会话 | D2 推论；Phase 3 的 404 重建逻辑兜底（07 §2 匿名可玩） |
| D9 | **行为平移优先**：本阶段所有页面沿用客户端数据获取（平移 `useCatalogSummary`/`useCharacterSearch`），不做服务端取数 | 生产拓扑未定（07 Stage 5），服务端 fetch 地址不可配置；收益（SEO/性能）无基线不宣称（07 §3） |
| D10 | **替换与回滚**：全部路由迁移 + 测试绿后，`git rm` 旧 `apps/web` 源文件并 `git mv apps/web-next apps/web`，同步 Taskfile/CI/package.json；旧实现保留 git 历史 | 05 §4.3「稳定后替换」；提交即回滚 |

---

## 4. 任务分解

### T1 — web-next 骨架

**输入**：Phase 3 运行环境；`apps/web` 现有依赖与配置。
**动作**：

1. 脚手架 `apps/web-next`：Next.js（TypeScript）+ App Router 目录结构（`app/`、`src/domain/`、`src/generated/`）；固定 Next.js 与 Tailwind v4 版本（Phase 0 基线精神，实施时锁定并记录）。
2. Tailwind v4 接入（postcss 配置 + `@theme` token 映射表，从 styles.css `:root` 摘录）。
3. `next.config.ts`：`rewrites()` 将 `/api/:path*` 代理到 `http://127.0.0.1:4000`。
4. root layout + 字体/assets（`public/` 从旧应用平移：`characters/`、`favicon.png`、hero 图）；`not-found.tsx`/`error.tsx`/`loading.tsx` 约定文件。
5. `lib/api.ts` 平移（openapi-fetch + `NEXT_PUBLIC_API_BASE_URL` 默认空 = 同源）；`gen:api` 脚本接入 `apps/web-next`。
6. `pnpm-workspace.yaml` 加入 `apps/web-next`；Taskfile 新增 `dev:web-next`（`next dev -p 5173`）。

**验收**：

- [ ] `task dev:web-next` 起 5173；`127.0.0.1:5173/api/health` 经代理返回 Go 响应。
- [ ] 空 layout 渲染 + 404 页可访问；`pnpm typecheck`/`build`（web-next）通过。

### T2 — 公共 layout 与静态/占位页

**输入**：T1 骨架。
**动作**：

1. `SiteFrame` → root layout：brand、6 项 nav（`usePathname` 高亮，含 singleLobby 的 singleGame/multi 子路径激活规则）、footer；nav 从 `button` 改为 `Link`。
2. 首页：Hero（目录摘要数据平移 `useCatalogSummary` 到 Client 子树）+ 快捷入口 → `app/page.tsx`。
3. 占位页：`multi/page.tsx`、`multi/room/page.tsx`、`stats/page.tsx`、`leaderboard/page.tsx`、`announcement/page.tsx`、`admin/page.tsx` → 共享 `PlaceholderPage` 组件；`links/page.tsx` 平移。
4. 上述页面样式按 Tailwind 迁移（保留视觉一致）；静态页优先 Server Component，含状态的子树标记 Client（05 §4.2/§4.3）。
5. 每页同步补 Vitest + RTL 渲染测试。

**验收**：

- [ ] 全部静态/占位路由可导航；`/404` 与未知路径均渲染 not-found。
- [ ] 页面视觉与旧应用截图一致（Playwright 截图对比）。

### T3 — 搜索页

**输入**：T2；`SearchPage.tsx`（174 行）。
**动作**：

1. `app/search/page.tsx`：平移 `useCharacterSearch`（防抖/取消、结果 12 条限制）、图标/列表视图切换、排序、空/加载/错误态、键盘可达性。
2. 展示格式化逻辑（若有）落 `src/domain/`；纯函数补 Vitest 用例。
3. 样式 Tailwind 迁移。

**验收**：

- [ ] 关键词/别名/罗马字搜索与 Phase 3 行为一致（黄金样本：博丽、红白、reimu）。
- [ ] 键盘 Tab 顺序与窄屏（移动端视口）Playwright 检查通过。

### T4 — 游戏页（Lobby + 每日题/随机题）

**输入**：T3；`SingleGamePage.tsx`（467 行）、`SingleLobby`（App.tsx 内）。
**动作**：

1. `app/single/page.tsx`：模式选择网格 + 多人占位入口。
2. `app/single/[mode]/page.tsx`：`params.mode` 经 `isSinglePlayerGameMode` 校验，非法 → `notFound()`；游戏页为 Client Component（05 §4.2），平移：提交猜测（输入/建议/提交）、反馈表、赢/输终局、分享文本、localStorage 会话恢复与 404 重建（D8）。
3. `useCharacterSearch`/`useCatalogSummary` hooks 平移。
4. 样式 Tailwind 迁移；交互组件补 RTL 测试。

**验收**：

- [ ] 每日题/随机题完整流程（创建→猜测→赢/输→分享）与 Phase 3 一致；刷新恢复、伪造旧 id 重建通过。
- [ ] 非法 mode（如 `/single/foo`）渲染 404。
- [ ] 移动端视口可完成一局（Playwright）。

### T5 — E2E 与视觉回归

**输入**：T2-T4 完成的 web-next；可运行的旧 `apps/web`。
**动作**：

1. Playwright 接入 web-next：路由导航、404、每日题全流程（赢/输）、随机题、搜索、会话恢复场景（对照 07 §9 游戏回归表）。
2. 视觉回归：旧 Vite 应用与 web-next 同路由截图 diff（桌面 + 移动端视口）；差异人工确认后建立基线。
3. 键盘（Tab 顺序/焦点可见）、移动端、基本无障碍（aria 标签）检查。
4. CI：`check` job 增加 web-next 测试步骤（Playwright 需要浏览器缓存策略）。

**验收**：

- [ ] Playwright 全绿；视觉截图对比通过或差异已确认接受。
- [ ] CI 前端测试步骤生效（本地复跑与 CI 命令一致）。

### T6 — 替换 apps/web

**输入**：T5 通过。
**动作**：

1. `git rm` 旧 `apps/web` 的 Vite 源（`App.tsx`/`main.tsx`/`index.html`/`vite.config.ts`/`styles.css`/`pages/`/`hooks/`/`components/`），`git mv apps/web-next apps/web`。
2. 合并 package.json：`dev`（`next dev -p 5173`）、`build`（`next build`）、`typecheck`、`gen:api`；移除 `vite`/`@vitejs/plugin-react` 依赖。
3. Taskfile `dev:web` 指向 web-next 命令；删除 `dev:web-next` 或改名；`pnpm-workspace.yaml` 移除 web-next 条目。
4. `pnpm install` 清理 Vite 依赖；CI 中 web 相关步骤对齐（build/test 命令不变则不动）。
5. 全量回归：`task dev` 起 Next.js + Go，Phase 3 场景全跑一遍。

**验收**：

- [ ] `task dev` 一键启动 Next.js（5173）+ Go；全部路由与游戏回归通过。
- [ ] 非 docs 目录 grep `vite.config\|@vitejs/plugin-react` 零命中；依赖树无 vite。

### T7 — 文档与执行记录

**输入**：T6 完成。
**动作**：

1. `README.md`/`04_local_demo_development.md`：前端栈描述、dev 流程（Taskfile 不变则微调）、项目结构更新为 Next.js。
2. `05_tech_stack_migration.md`：§13 Phase 4 标记完成。
3. `phase04.md`：追加执行记录（本文件 §10）。
4. `05` §12 Taskfile 示例若与实际不符，以实际为准回写文档。

**验收**：

- [ ] 文档命令可照抄执行；CI 配置与前端栈一致。
- [ ] 无 Vite/手写路由引用残留（docs 中历史记录除外）。

---

## 5. 总验收标准（阶段退出条件）

1. `task dev` 一键启动 Next.js（5173）+ Go（4000）；11 条路由 + 404 与 Phase 3 行为一致（07 §9 游戏回归 + 浏览器场景：键盘/移动端/无障碍/视觉）。
2. Tailwind v4 视觉与旧版一致（Playwright 截图对比通过）。
3. Vitest + RTL + Playwright 全绿；CI 包含前端测试步骤。
4. Vite 配置与依赖零残留（grep + 依赖树）；`generated/api.ts` 与 OpenAPI 契约重新生成无 diff。
5. 文档（README/04/05/phase04）与实现一致。

## 6. 风险与回滚

| 风险 | 等级 | 缓解 |
|---|---|---|
| Tailwind 迁移造成视觉回归 | 中 | 页面级迁移 + 新旧截图对比（05 §14） |
| 路由行为差异（手写 → App Router） | 低 | 映射表（05 §4.2）+ 404/参数校验测试 |
| origin/端口变化破坏会话或 CORS | 低 | D2 固定 5173；localStorage key 不变；`WEB_ORIGINS` 已含 |
| 客户端 Bundle 体积变化 | 低 | Next 自动代码分割；D9 不引入 server 取数，无基线不宣称优化 |
| 测试基建拖长迁移窗口 | 中 | 纯逻辑/hooks 先行，组件后补，Playwright 最后（T5） |
| 双应用并行期维护成本 | 低 | 迁移窗口限定 T1-T5，T6 替换后立即删除旧实现 |
| Next.js 与 Go 职责重叠 | 低 | Route Handler 不承载业务逻辑（05 §14） |
| **回滚**：`git checkout` 恢复 `apps/web` 旧实现与 Taskfile/CI 配置（Phase 3 提交历史完整）；Go 后端与契约不变，无后端回滚面 | — | 提交即回滚 |

## 7. 与后续阶段的衔接

- **Phase 5（清理仓库）**：`packages/shared` 按调用者拆解、删除无调用者类型（05 §11/§13 Phase 5）；迁移期遗留的 `web-next` 引用清理。
- **07 Stage 2（身份）**：`lib/api.ts` 抽象层保留，Next.js 客户端恢复 access token 的机制（07 §5.3）在此基础扩展。
- **07 Stage 5（生产拓扑）**：D9 推迟的服务端取数与同源入口在拓扑确定后落地（05 §3）。

---

## 10. 执行记录

> 本阶段执行完成后，在此追加各任务执行情况、验证证据与偏差（格式参照 phase03 §10）。
