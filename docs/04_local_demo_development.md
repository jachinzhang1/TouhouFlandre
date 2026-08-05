# 本地开发指南

本文面向希望在本地运行、调试或贡献东方芙一把（TouhouFlandre）的开发者。

## 环境要求

- Node.js 20.19 或更高的 20.x 版本，或 Node.js 22.12 及更高版本；
- pnpm 11；
- Go 1.26 及以上；
- Docker（本地 Postgres 容器）；
- [Task](https://taskfile.dev/)（跨语言任务编排入口）；
- Git。

仓库使用 pnpm workspace，Go 为独立 module（`apps/api`）。请在仓库根目录执行本文命令。

## 安装与启动

先将 `.env.example` 复制为 `.env`，再执行：

```bash
pnpm install
task db:up        # docker compose up -d --wait postgres（端口 5433）
task db:migrate   # goose -dir migrations up
task db:seed      # 校验题库并写入 Postgres（版本化快照）
pnpm dev          # task dev：并行启动 Go API 与 Web
```

`task db:up` 会启动一个可丢弃的 Postgres 容器（`touhouflandre-postgres-1`）。运行时数据（每日题、会话）不跨全新数据库保留，题库由 `task db:seed` 重建。

默认服务地址：

- Web：`http://localhost:5173`
- API：`http://localhost:4000`
- 健康检查：`http://localhost:4000/api/health`、`/livez`、`/readyz`

`pnpm dev` 会同时启动 API 与 Web。Web 默认同源请求 `/api`，由 `next.config.ts` rewrites 代理到本地 API（4000）；设置 `NEXT_PUBLIC_API_BASE_URL` 可改为直连。

## 环境变量

将 `.env.example` 复制为 `.env` 后按需修改：

| 变量                | 作用                                 | 默认值                              |
| ------------------- | ------------------------------------ | ----------------------------------- |
| `API_PORT`          | API 监听端口                         | `4000`                              |
| `NEXT_PUBLIC_API_BASE_URL` | Web 请求的 API 根地址（留空为同源代理） | 空（同源 `/api`） |
| `WEB_ORIGINS`       | 允许跨域访问 API 的 Web 来源，逗号分隔 | 本地 5173 地址                      |
| `POSTGRES_PASSWORD` | compose Postgres 密码                | `touhouflandre-dev`                 |
| `DATABASE_URL_PG`   | Go 服务 Postgres 连接串              | 见 `.env.example`（127.0.0.1:5433） |
| `GOOSE_DBSTRING`    | goose 迁移连接串                     | 见 `.env.example`                   |
| `GOOSE_DRIVER`      | goose 驱动                           | `postgres`                          |

不要提交 `.env`、本地数据库或包含凭据的日志文件。

## 常用命令

| 命令                                         | 说明                             |
| -------------------------------------------- | -------------------------------- |
| `pnpm dev` / `task dev`                      | 同时启动 Go API 与 Web           |
| `task db:up` / `task db:down`                | 启动/停止本地 Postgres 容器      |
| `task db:migrate`                            | 应用 goose 数据库迁移            |
| `task db:seed`                               | 校验题库并写入 Postgres 快照     |
| `pnpm build`                                 | 构建所有 workspace 包            |
| `pnpm test`                                  | 运行共享、数据与 Web（Vitest）测试 |
| `pnpm typecheck`                             | 对所有包执行 TypeScript 检查        |
| `pnpm test:e2e`（在 `apps/web`）              | Playwright E2E（需 `task dev` 运行中） |
| `pnpm typecheck`                             | 对所有包执行 TypeScript 检查     |
| `go test ./...`（在 `apps/api`）              | Go 单元与集成测试（需 Postgres） |
| `go vet ./...`（在 `apps/api`）               | Go 静态检查                      |
| `task gen`                                   | 重新生成 OpenAPI 类型与 sqlc 查询 |
| `pnpm --filter @touhoufriberg/data validate` | 校验角色与作品数据               |

提交改动前至少运行 `pnpm typecheck`、`pnpm test` 和 `go test ./...`。涉及构建配置或前端资源时还应运行 `pnpm build`。

## 项目结构

```text
apps/web/
  src/
    app/                      Next.js App Router 路由
      page.tsx                首页
      search/page.tsx         搜索页
      single/page.tsx         游戏模式选择
      single/[mode]/page.tsx  每日题/随机题（非法模式 404）
      links/page.tsx          友链与鸣谢
      not-found.tsx           404 页
    components/               SiteNav、HomePage、SingleGamePage 等组件
    domain/                   前端专用展示逻辑（joinValues 等）
    generated/                openapi-typescript 生成类型
    hooks/                    题库摘要与角色搜索数据 Hook
    lib/api.ts                统一 API 客户端（openapi-fetch，同源 /api）
    test/setup.ts             Vitest jsdom 环境
  e2e/                        Playwright 测试
  globals.css 相关: src/app/globals.css（Tailwind v4 + 组件样式）
apps/api/
  cmd/server/                服务入口
  cmd/seed/                  题库 seed 入口
  internal/game/             权威游戏规则
  internal/handler/          OpenAPI handler 与错误映射
  internal/generated/        oapi-codegen / sqlc 生成代码
  internal/seed/             Go 题库 seed
  migrations/                goose 版本化迁移
  sql/queries/               sqlc 查询源
packages/shared/src/
  compare.ts        字段比较规则
  daily.ts          每日题选择
  fields.ts         当前启用的反馈字段
  modes.ts          可玩模式与内容类型定义
  search.ts         搜索归一化逻辑
  share.ts          无剧透分享文本
  types.ts          共享类型
packages/data/src/
  characters.demo.json
  works.demo.json
  schema.ts
```

## 开发约定

### 前端（Next.js App Router）

- 业务状态以 API 返回的 `PublicGameSession` 为准；
- 不在客户端选择答案或重新计算反馈；
- 路由由 App Router 文件系统管理，`/single/[mode]` 需校验非法模式并 `notFound()`；
- API 默认同源 `/api`（`next.config.ts` rewrites 代理到 Go），直连用 `NEXT_PUBLIC_API_BASE_URL`；
- 样式以 Tailwind utility 为主，设计 token 定义在 `globals.css` 的 `@theme`；复杂动画/伪元素类保留为组件类；
- 交互必须覆盖加载、空、错误、禁用和完成状态；
- 样式修改需要检查窄屏布局和减少动态效果设置（`prefers-reduced-motion`）。

### API（Go）

- 请求校验由 OpenAPI middleware 承担，不维护第二套 API schema；
- 进行中的会话不得返回隐藏答案；
- 可预期的业务错误返回统一 `ErrorResponse`（稳定错误码）；
- handler 实现 oapi-codegen 生成的 strict server interface；生成代码禁止手工修改；
- 游戏规则与答案选择逻辑位于 `internal/game`，与 handler 分离。

### 共享逻辑

- 比较、搜索、每日题和分享逻辑应保持无框架依赖；
- 修改反馈规则时必须添加覆盖边界情况的测试；
- 客户端与服务端共享的结构统一定义在 `packages/shared`。
- 猜测内容的字段与次数从 `GAME_CONTENT_DEFINITIONS` 读取；扩展内容类型时建立独立定义与比较器。

### 题库

题库字段与来源要求见[东方内容与数据规范](./03_touhou_integration.md)。数据变更必须通过 schema 和跨记录校验（`task db:seed` 前置的 `catalog:check`）。

## 数据库变更

修改 `apps/api/migrations` 新增迁移后：

1. 新建 `apps/api/migrations/00NN_<change_name>.sql`，遵循 expand/contract 原则（加列可空、回填、再收紧）；
2. 运行 `task db:migrate` 应用迁移；
3. 若迁移变更了查询涉及的结构，运行 `task gen:repo`（sqlc generate）并提交生成的 Go 代码；
4. 运行 `task db:seed` 同步题库并建立新的版本化快照；
5. 运行 Go 测试（`go test ./...`）与前端回归；
6. 验证历史会话继续引用原题库快照（按 `catalog_version` 读取），持久化记录能兼容读取。

不要在开发机提交数据库文件。迁移一旦应用即不可变：如需修改，追加新迁移而非编辑已应用的迁移。

## 故障排查

### Web 可以打开，但请求失败

确认 API 正在监听 `4000` 端口，并访问健康检查地址（`/api/health`、`/readyz`）。若单独启动 Web，检查 Next rewrites 或 `NEXT_PUBLIC_API_BASE_URL` 是否正确。`/readyz` 返回 503 表示 Postgres 不可达，先确认 `task db:up` 与 `DATABASE_URL_PG`。

### Go 服务启动报数据库连接错误

确认 `docker compose ps` 中 Postgres 容器健康，且 `.env` 的 `DATABASE_URL_PG` 端口（默认 5433）与 compose 一致。

### 题库修改后页面仍显示旧数据

重新运行 `task db:seed`。搜索页会使用最新题库；已开始的游戏会话则按设计继续使用创建时的冻结快照。要在随机题中使用新题库，请重新开始一局。当天的每日题映射不会因 seed 改变，需要等到下一个 `Asia/Shanghai` 自然日。

## 提交范围

一个提交应聚焦于单一功能或问题。避免同时提交本地日志、数据库文件、格式化无关文件或来源不明的媒体资源。用户可见行为发生变化时，请同步更新相关文档。
