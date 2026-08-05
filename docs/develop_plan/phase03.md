# Phase 3 开发计划 — 切换后端入口

> 依据：[`05_tech_stack_migration.md`](../05_tech_stack_migration.md) §13 Phase 3；[`07_productization_plan.md`](../07_productization_plan.md) §4.1；[`phase02.md`](./phase02.md) §9
> 状态：待评审（规划完成，未开始执行）
> 影响范围：`apps/api`（删除 Express 部分）、`prisma/`（删除）、root `package.json`、`pnpm-workspace.yaml`、`.env`、`Taskfile.yml`、`internal/config`、文档
> 原则：**Go 接替 4000，前端零改动；删除是提交即回滚（git 历史完整）**

---

## 1. 目标与边界

### 目标

1. Go 服务接管 4000 端口，Vite 代理（`/api` → 4000）与前端代码**零改动**完成切流。
2. 删除 Express、Prisma、SQLite 的全部代码与依赖（`apps/api/src`、`tests/`、`prisma/`、root scripts/依赖）。
3. `pnpm dev` 一键启动 Go + web（Taskfile 编排）。
4. 全用户流程回归通过（每日题/随机题/搜索/会话恢复/分享）。

### 非目标（本阶段明确不做）

- 不引入反向代理/Nginx（demo 规模直接端口接管）。
- 不做生产部署（部署拓扑是 07 的 Stage 5）。
- 不迁移 SQLite 运行时数据（D3：demo 数据丢弃，07 §4.1 决策）。
- 不实现身份/多人（产品化阶段）。

---

## 2. 前置条件（Phase 2 交付物）

- [ ] Go 服务 6 端点通过集成测试（10 用例）与 OpenAPI 校验（Phase 2 已完成）。
- [ ] Go seed 版本与 TS `demoCatalogVersion` 一致（`5a81c4c8`，已完成）。
- [ ] 契约测试基线记录：切流后 Express 契约测试删除，由 Go 集成测试承担同等覆盖。
- [ ] 前端可用（Vite dev + Express 4000），作为切流前的对照基线。

---

## 3. 关键决策（规划期冻结）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **端口接管**：Go 监听 4000，`config.APIPort()` 改读 `API_PORT`（默认 4000）；删除 `API_PORT_GO` | Express 消失后无冲突；前端 `VITE_API_BASE_URL`/Vite proxy 指向 4000 零改动 |
| D2 | **dev 命令**：root `"dev": "task dev"`；Taskfile 新增 `dev`（并行 `dev:api`=go run、`dev:web`） | Taskfile 是跨语言入口（05 §12）；concurrently 退役 |
| D3 | **数据处置**：SQLite 运行时数据（`GameSession`/`DailyPuzzle`）丢弃，不导入 Postgres | 开发期数据无保留价值；题库由 Go seed 重建（不丢） |
| D4 | **旧前端会话**：localStorage 中的旧 session id 在 Postgres 不存在 → 404 → 前端现有 `catch` 已清除并重建，无需代码改动 | 前端逻辑已处理（SingleGamePage loadSession catch 分支），回归验证即可 |
| D5 | **workspace 收窄**：`pnpm-workspace.yaml` 显式列出 `apps/web` + `packages/*`，`apps/api` 变为纯 Go 目录（删除 package.json） | api 无 package.json 后 `pnpm -r` 自动跳过 |
| D6 | **契约测试退役**：删除 Express 的 `contract.test.ts`，OpenAPI 响应校验由 Go 集成测试（server_test.go）承担 | 避免双份契约测试；Go 侧已覆盖成功/错误/并发路径 |
| D7 | **env 收敛**：`.env` 保留 `API_PORT=4000`、`DATABASE_URL_PG`、`GOOSE_*`、`POSTGRES_PASSWORD`；删除 `API_PORT_GO`、`DATABASE_URL`（SQLite） | 单一数据库连接语义 |
| D8 | **回滚**：切流失败 = `git checkout` 恢复 Express 目录与 root scripts（Phase 2 提交 `99943d5`~`b51e384` 完整保留）；前端无改动，无回滚面 | 提交即回滚手段 |

---

## 4. 任务分解

### T1 — 端口与入口切换

**输入**：Phase 2 Go 服务；`.env`。
**动作**：

1. `internal/config/config.go`：`APIPort()` 改读 `API_PORT`（默认 `"4000"`），删除 `API_PORT_GO` 分支。
2. `.env`：删除 `API_PORT_GO`、`DATABASE_URL`（SQLite）；确认 `API_PORT=4000`。
3. 停止 Express；启动 Go，验证 4000 上 6 端点 + `/livez` `/readyz`。

**验收**：

- [ ] `curl localhost:4000/api/health` 返回 Go 服务响应；Express 无进程存活。
- [ ] 6 端点 + 错误码行为与 Phase 2 冒烟一致。

### T2 — Taskfile dev 与 root dev

**输入**：Taskfile.yml；root package.json。
**动作**：

1. Taskfile 新增 `dev`（`task --parallel dev:api dev:web`）、`dev:api`（`bash -c 'set -a && . ../../.env && set +a && go run ./cmd/server'`）、`dev:web`（`pnpm --filter @touhoufriberg/web dev`）。
2. root `package.json`：`"dev": "task dev"`；移除 `concurrently` 依赖。
3. `pnpm install` 更新 lockfile。

**验收**：

- [ ] `task dev` 一键启动 Go（4000）+ web（5173），Vite proxy 转发 `/api` → Go 正常。
- [ ] root 无 `concurrently` 残留。

### T3 — 前端功能回归（切流验证）

**输入**：T1/T2 后的运行环境。
**动作**：

1. 起 `task dev`，浏览器/curl 回归 07 §9「游戏回归」场景：
   - 首页（catalog 摘要：29 角色、每日题按钮）；
   - 每日题：创建 → 猜测 → 赢/输 → 分享文本；
   - 随机题：创建 → 猜测；
   - 搜索：关键词/别名/罗马字；
   - 会话恢复：刷新页面恢复进行中会话；伪造旧 localStorage id → 404 → 前端重建。
2. 验证每日题同日幂等（两次创建同 `puzzleKey`）。

**验收**：

- [ ] 全部场景与切流前行为一致（对照 Phase 2 冒烟记录）。
- [ ] 无前端代码改动。

### T4 — 删除 Express/Prisma/SQLite

**输入**：T3 通过。
**动作**：

1. 删除：`apps/api/src/`、`apps/api/tests/`、`apps/api/package.json`、`apps/api/tsconfig.json`（若残留）、`prisma/`。
2. root `package.json`：删除 scripts `db:generate`、`db:push`、`seed`、`postinstall`；删除依赖 `@prisma/client`、devDeps `prisma`。
3. `pnpm-workspace.yaml`：packages 改为 `["apps/web", "packages/*"]`。
4. `pnpm install`（清理 node_modules 中的 prisma/express）；`go mod tidy` 确认无 TS 相关依赖残留。

**验收**：

- [ ] `grep -ri "prisma\|express"` 在非 docs 目录零命中（node_modules 除外）。
- [ ] `pnpm test`（shared + data）、`pnpm typecheck`、`pnpm build`、`go test ./...`、`go vet ./...` 全绿。
- [ ] `pnpm install` 无 postinstall 错误。

### T5 — CI 与文档

**输入**：T4 完成。
**动作**：

1. CI：确认 `check` job 无需改动（`pnpm test` 经 `-r --if-present` 自动跳过无 package.json 的 api）；如有 prisma 相关步骤则清理。
2. 文档：
   - `README.md`：dev 命令改为 `task dev`（或 `pnpm dev`）；数据库流程改为 compose + goose + `task db:seed`；
   - `04_local_demo_development.md`：数据库变更章节（Prisma → goose 迁移）、API 端口说明；
   - `05_tech_stack_migration.md`：§13 Phase 3 标记完成；
   - `phase03.md`：追加执行记录（本文件 §10）。
3. 更新 `.env.example` 对齐 D7（删除 SQLite 变量）。

**验收**：

- [ ] 文档与实现一致（命令可照抄执行）。
- [ ] CI 配置无 prisma/express 引用。

---

## 5. 总验收标准（阶段退出条件）

1. `task dev` 一键启动 Go（4000）+ web；6 端点与全部用户流程可用（07 §9 游戏回归）。
2. Express/Prisma/SQLite 代码与依赖零残留（grep + 依赖树）。
3. `pnpm test`（shared+data）、`go test ./...`、`typecheck`、`build` 全绿。
4. 错误码/契约行为与 Phase 2 一致（Go 集成测试保持全绿）。
5. 文档（README/04/05/phase03）与实现一致。

## 6. 风险与回滚

| 风险 | 等级 | 缓解 |
|---|---|---|
| 旧 localStorage 会话 404 | 低 | 前端已有 catch 重建（D4），回归验证 |
| 删除依赖影响 packages/data（tsx） | 低 | tsx 保留（data validate 使用）；prisma 仅 root/api 移除 |
| `pnpm -r` 对无 package.json 目录报错 | 低 | D5 显式 workspace 列表 |
| Vite proxy 端口漂移 | 低 | D1 端口统一 4000，proxy 配置不动 |
| 切流后行为差异 | 中 | T3 全场景回归；Go 集成测试（Phase 2）保持绿 |
| **回滚**：`git checkout` 恢复 Express 目录、root scripts、workspace 配置（Phase 2 提交历史完整），前端无需任何改动 | — | 提交即回滚 |

## 7. 与后续阶段的衔接

- **Phase 4（前端迁移）**：Go 已是唯一后端，前端 `apps/web` 迁移 Next.js 时 API 契约与 `src/lib/api.ts` 直接复用，无后端联动。
- **07 Stage 1（数据完整性）**：SQLite 已下线，运行时数据处置（D3）落地为最终决策。
