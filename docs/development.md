# 开发指南

本文面向希望在本地运行、调试或贡献 TouhouFlandre 的开发者。

## 环境要求

| 工具 | 版本 |
|---|---|
| Node.js | 24 或更高 |
| pnpm | 11 |
| Go | 1.26 或更高 |
| Docker + Compose | 用于本地 Postgres |
| Task | 跨语言任务入口 |
| Git | 版本控制 |

仓库使用 pnpm workspace，Go 为独立 module（`apps/api`）。请在仓库根目录执行本文命令。

## 安装与启动

```bash
cp .env.example .env
pnpm install
task db:up
task db:migrate
task db:seed
pnpm dev
```

默认服务地址：

| 服务 | 地址 |
|---|---|
| Web | `http://localhost:5173` |
| API | `http://localhost:4000` |
| API 健康检查 | `http://localhost:4000/api/health`、`/livez`、`/readyz` |

Web 默认同源请求 `/api`，由 `next.config.ts` rewrites 代理到本地 API。若要让浏览器直连 Go API，可设置 `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`。

## 环境变量

| 变量 | 作用 |
|---|---|
| `API_PORT` | API 监听端口。 |
| `NEXT_PUBLIC_API_BASE_URL` | Web 请求的 API 根地址；留空为同源代理。 |
| `WEB_ORIGINS` | 允许跨域访问 API 的 Web 来源，逗号分隔。 |
| `POSTGRES_PASSWORD` | compose Postgres 密码。 |
| `DATABASE_URL_PG` | Go 服务 Postgres 连接串。 |
| `GOOSE_DBSTRING` | goose 迁移连接串。 |
| `GOOSE_DRIVER` | goose 驱动。 |

不要提交 `.env`、本地数据库或包含凭据的日志文件。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` / `task dev` | 同时启动 Go API 与 Web。 |
| `task db:up` / `task db:down` | 启动/停止本地 Postgres 容器。 |
| `task db:migrate` | 应用 goose 数据库迁移。 |
| `task db:seed` | 校验题库并写入 Postgres 快照。 |
| `pnpm build` | 构建所有 workspace 包。 |
| `pnpm test` | 运行 shared/data/web 的 Vitest 测试。 |
| `pnpm typecheck` | 对所有包执行 TypeScript 检查。 |
| `pnpm --filter @touhouflandre/web test:e2e` | Playwright E2E；需 `task dev` 运行中。 |
| `cd apps/api && go test ./...` | Go 单元与集成测试；需可访问 Postgres。 |
| `cd apps/api && go vet ./...` | Go 静态检查。 |
| `task gen` | 重新生成 OpenAPI 类型与 sqlc 查询。 |
| `pnpm --filter @touhouflandre/data validate` | 校验角色与作品数据。 |

PR 前至少运行 `pnpm typecheck`、`pnpm test` 和 `cd apps/api && go test ./...`。涉及构建配置或前端资源时还应运行 `pnpm build`。

## 项目结构

```text
apps/web/
  src/app/                 Next.js App Router 路由
  src/components/          页面组件与游戏组件
  src/domain/              前端展示逻辑
  src/generated/           openapi-typescript 生成类型
  src/hooks/               数据 Hook
  src/lib/api.ts           统一 API 客户端
  src/stats/               本地统计
apps/api/
  cmd/server/              服务入口
  cmd/seed/                题库 seed 入口
  internal/game/           权威游戏规则
  internal/handler/        OpenAPI handler 与错误映射
  internal/generated/      oapi-codegen / sqlc 生成代码
  internal/hub/            多人 WebSocket 连接管理
  internal/multi/          多人模式领域逻辑
  migrations/              goose 版本化迁移
  sql/queries/             sqlc 查询源
packages/shared/src/       前端共享类型、字段、模式、搜索归一化与分享文本
packages/data/src/         角色、作品数据与 Zod schema
contracts/openapi/         HTTP 契约
contracts/ws/              WebSocket 协议
```

## 开发约定

### 前端

- 业务状态以 API 返回的会话或房间快照为准。
- 不在客户端选择答案或重新计算反馈。
- 路由由 App Router 文件系统管理，动态路由必须校验非法参数。
- API 默认同源 `/api`，直连用 `NEXT_PUBLIC_API_BASE_URL`。
- 样式以 Tailwind utility 为主，设计 token 定义在 `globals.css` 的 `@theme`。
- 交互必须覆盖加载、空、错误、禁用和完成状态。
- 样式相关工作需要检查窄屏布局和 `prefers-reduced-motion`。

### API

- 请求校验由 OpenAPI middleware 承担，不维护第二套 API schema。
- 进行中的会话不得返回隐藏答案。
- 可预期业务错误返回统一 `ErrorResponse` 和稳定错误码。
- handler 实现 oapi-codegen 生成的 strict server interface。
- 游戏规则与答案选择逻辑位于 `internal/game`，与 handler 分离。
- 多人状态以 Postgres 为权威，Go 内存只保存活动连接和热点投影。

### 共享逻辑

- `packages/shared` 只保留前端展示和数据校验需要的类型、字段、模式、搜索归一化与分享文本。
- 比较、每日题、随机题、会话和并发写入规则以 Go `internal/game` 与 handler 实现为准。
- 反馈规则相关工作必须添加覆盖边界情况的 Go 测试。
- 扩展内容类型时同步更新 OpenAPI、Go 规则、前端展示和测试。

## 数据库迁移

新增迁移时：

1. 新建 `apps/api/migrations/00NN_<change_name>.sql`。
2. 遵循 expand/contract 原则，避免破坏运行中数据。
3. 运行 `task db:migrate`。
4. 若迁移影响 sqlc 查询，运行 `task gen:repo` 并纳入生成代码。
5. 运行 `task db:seed` 建立新的题库快照。
6. 运行 Go 测试与前端回归。

迁移一旦应用即不可变；如需调整，追加新迁移而非编辑已应用迁移。

## 故障排查

### Web 可以打开，但请求失败

确认 API 正在监听 `4000` 端口，并访问 `/api/health`、`/readyz`。`/readyz` 返回 503 表示 Postgres 不可达，先确认 `task db:up` 与 `DATABASE_URL_PG`。

### Go 服务启动报数据库连接错误

确认 Postgres 容器健康，且 `.env` 的 `DATABASE_URL_PG` 端口与 compose 配置一致。

### 题库同步后页面仍显示旧数据

重新运行 `task db:seed`。搜索页会使用最新题库；已开始的游戏会话按设计继续使用创建时的冻结快照。当天每日题映射不会因 seed 改变，需要等到下一个 `Asia/Shanghai` 自然日。

## 贡献范围

一个 PR 应聚焦于单一功能或问题。避免同时提交本地日志、数据库文件、格式化无关文件或来源不明的媒体资源。用户可见行为发生变化时，请同步更新相关文档。

提交 PR 前必须先通过 Issue 对齐需求、验收标准或数据来源。未事先在 Issue 中对齐，或明显偏离[站点开发计划](./site-development-plan.md)的 PR 将被直接关闭。
