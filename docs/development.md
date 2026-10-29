# 开发指南

本文面向希望在本地运行、调试或贡献 TouhouFlandre 的开发者。

## 环境要求

| 工具             | 版本              |
| ---------------- | ----------------- |
| Node.js          | 26.12.1 或更高    |
| pnpm             | 11                |
| Go               | 1.26 或更高       |
| Docker + Compose | 用于本地 Postgres |
| Task             | 跨语言任务入口    |
| Git              | 版本控制          |

仓库使用 pnpm workspace，Go 为独立 module（`apps/api`）。请在仓库根目录执行本文命令。

`.nvmrc` 固定 Node.js 26.12.1，使用 nvm 时可执行 `nvm install` 和 `nvm use`。CI 与 Web 容器使用相同版本。Node.js 26 不再自带 Corepack；如尚未安装 pnpm，可执行 `npm install --global pnpm@11.9.0`。

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

| 服务         | 地址                                                    |
| ------------ | ------------------------------------------------------- |
| Web          | `http://localhost:5173`                                 |
| API          | `http://localhost:4000`                                 |
| API 健康检查 | `http://localhost:4000/api/health`、`/livez`、`/readyz` |

Web 默认同源请求 `/api`，由 `next.config.ts` rewrites 代理到本地 API。若要让浏览器直连 Go API，可设置 `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`。本地生产栈则通过 `http://localhost:3000` 提供 Web 与 WebSocket 入口。

## 环境变量

| 变量                       | 作用                                     |
| -------------------------- | ---------------------------------------- |
| `API_PORT`                 | API 监听端口。                           |
| `NEXT_PUBLIC_API_BASE_URL` | Web 请求的 API 根地址；留空为同源代理。  |
| `WEB_ORIGINS`              | 允许跨域访问 API 的 Web 来源，逗号分隔。 |
| `POSTGRES_PASSWORD`        | compose Postgres 密码。                  |
| `DATABASE_URL_PG`          | Go 服务 Postgres 连接串。                |
| `GOOSE_DBSTRING`           | goose 迁移连接串。                       |
| `GOOSE_DRIVER`             | goose 驱动。                             |

不要提交 `.env`、本地数据库或包含凭据的日志文件。

## 常用命令

| 命令                                         | 说明                                            |
| -------------------------------------------- | ----------------------------------------------- |
| `pnpm dev` / `task dev`                      | 同时启动 Go API 与 Web。                        |
| `task db:up` / `task db:down`                | 启动/停止本地 Postgres 容器。                   |
| `task db:migrate`                            | 应用 goose 数据库迁移。                         |
| `task db:seed`                               | 校验题库并写入 Postgres 快照。                  |
| `pnpm build`                                 | 构建所有 workspace 包。                         |
| `pnpm test`                                  | 运行 shared/data/web 的 Vitest 测试。           |
| `pnpm typecheck`                             | 对所有包执行 TypeScript 检查。                  |
| `pnpm --filter @touhouflandre/web test:e2e`  | Playwright E2E；需 `task dev` 运行中。          |
| `cd apps/api && go test ./...`               | Go 单元与集成测试；需可访问 Postgres。          |
| `cd apps/api && go test ./guessing`          | 可复用猜测包的纯内存测试与示例，无需 Postgres。 |
| `cd apps/api && go vet ./...`                | Go 静态检查。                                   |
| `task gen`                                   | 重新生成 OpenAPI 类型与 sqlc 查询。             |
| `pnpm --filter @touhouflandre/data validate` | 校验角色与作品数据。                            |

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
  guessing/                公开的猜测判定与作答状态推进包
  internal/catalog/        数据库题库快照读取
  internal/game/           应用规则配置、题库缓存、展示适配与搜索
  internal/handler/        OpenAPI handler 与错误映射
  internal/generated/      oapi-codegen / sqlc 生成代码
  internal/hub/            多人 WebSocket 连接管理
  internal/multi/          多人模式领域逻辑
  migrations/              goose 版本化迁移
  sql/queries/             sqlc 查询源
packages/shared/src/       前端共享类型、字段、模式、题库校验辅助与分享文本
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
- Paper 视觉组件统一从 `@/components/paper` 导入；该包独占纸张表面、折角、纹理、阴影、分隔线以及 hover、focus、disabled 状态。
- 页面样式只能组合 Paper 组件的布局几何（宽度、网格、间距、定位），不得覆盖其颜色、背景、纹理、折角或交互状态；缺少能力时先扩展 Paper 包 API 和组件测试。
- 游戏模式渐变卡、语义化结果单元格、公告/鸣谢签名卡和完成态透明棋盘属于明确视觉例外；站点导航、标签页、隐藏文件输入等非 Paper 语义控件不强制套用 Paper。

#### 多人界面状态调试

开发环境的多人大厅和房间会在浏览器控制台注册只读界面种子：

```js
// 查看全部可用状态
__touhouflandreDev.game.presets;

// 切换状态；在大厅调用时会进入 DEV222 调试房间
__touhouflandreDev.game.seed("race-n-player");

// 清除种子并恢复真实房间流程
__touhouflandreDev.game.reset();
```

预设覆盖身份同步、断线、玩家与观战大厅、双人和多人竞速、接力轮次、局末/场末、淘汰、复盘以及聊天加载和发送状态。种子只修改当前标签页的开发状态与 `sessionStorage`，不写入 API 或数据库。

### API

- 请求校验由 OpenAPI middleware 承担，不维护第二套 API schema。
- 进行中的会话不得返回隐藏答案。
- 可预期业务错误返回统一 `ErrorResponse` 和稳定错误码。
- handler 实现 oapi-codegen 生成的 strict server interface。
- 字段比较、答案匹配和公共作答状态推进位于公开包 `guessing`；`internal/game` 负责应用配置、答案选择、题库加载缓存、展示适配与搜索，`internal/catalog` 负责数据库快照读取。
- 多人状态以 Postgres 为权威，Go 内存只保存活动连接和热点投影。

### 共享逻辑

- `packages/shared` 只保留前端展示和数据校验需要的类型、字段、模式、校验辅助与分享文本；运行时角色搜索不在前端重复实现。
- 猜测计算以 Go `guessing` 实现为准；每日题、随机题、会话编排和并发写入由应用层负责。
- 反馈规则相关工作必须添加覆盖边界情况的 Go 测试。
- 扩展内容类型时同步更新 OpenAPI、Go 规则、前端展示和测试。

### 复用猜测过程

[`guessing` 使用说明](../apps/api/guessing/README.md)提供完整的纯内存示例。本包仍属于 `apps/api` 的 Go module，外部项目导入 `github.com/TouhouFlandre/touhouflandre/apps/api/guessing`，无需导入任何 `internal` 包。包依赖仅有标准库；首版固定支持现有六字段角色规则，其他题材的规则扩展不在此次提取范围内。

调用方通过 `NewCatalog` 构建不可变题库，再用 `Evaluate` 判定一次猜测，或用 `ApplyGuess` 检查重复、消耗额度并得到新作答状态。`ConsumeAttempt` 可记录调用方已确认应计数的超时或空过，不读取时钟。`AttemptState.Limit == 0` 表示无限次数；`Closed` 只关闭调用方划定的作答序列，不能直接作为多人整场比赛的结束信号。

应用层仍需负责题库版本和答案选择、鉴权、并发控制、事务、持久化、幂等重试、时钟、多人轮次及显示。请在事务内按原有规则验证并保存返回状态，不要把输入状态的不可变性当作并发写入保障。原 HTTP 响应与数据库序列化由适配层保留，规则包的 Go 类型不直接取代这些契约。

修改公共判定或状态推进时，先运行无需数据库的包测试；修改应用接入时，还需执行相关单人和多人回归。仅执行可运行示例可使用：

```bash
cd apps/api
go test ./guessing -run Example
```

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
