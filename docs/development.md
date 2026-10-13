# 开发指南

本地 API 和 Web 在宿主机运行，Docker 只负责 PostgreSQL。请在仓库根目录执行本文命令。

## 环境要求

| 工具 | 版本 |
|---|---|
| Node.js | 24 或更高 |
| pnpm | 11 |
| Rust | 1.99.0，由 `rust-toolchain.toml` 固定；通过 rustup 管理 |
| Docker + Compose | 仅用于本地 PostgreSQL 18 |
| Task | 跨语言任务入口 |
| Git | 版本控制 |

TypeScript 使用 pnpm workspace；Rust 使用根目录 Cargo workspace，API crate 位于 `apps/api`。首次运行 Cargo 时 rustup 会安装固定工具链及 rustfmt、Clippy。

## 安装与启动

```bash
cp .env.example .env
pnpm install
task db:up
task db:migrate
task db:seed
pnpm dev
```

`task dev` 启动数据库后，在本机并行运行 `cargo run --bin server` 和 Next 开发服务器。`task dev:api`、`task db:migrate`、`task db:seed` 会读取根目录 `.env`。直接运行 Cargo 时需自行导出环境变量；seed 的默认数据路径以 `apps/api` 为工作目录。

| 服务 | 地址 |
|---|---|
| Web | `http://localhost:5173` |
| API | `http://localhost:4000` |
| API 健康检查 | `http://localhost:4000/api/health`、`/livez`、`/readyz` |

Web 默认通过 Next rewrites 同源代理 `/api`。直连 API 时设置 `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`，并在 `WEB_ORIGINS` 中登记浏览器来源。

## 环境变量

| 变量 | 作用 |
|---|---|
| `API_PORT` | API 监听端口。 |
| `NEXT_PUBLIC_API_BASE_URL` | Web 请求的 API 根地址；留空为同源代理。 |
| `WEB_ORIGINS` | 允许跨域请求和 WebSocket 升级的浏览器来源，逗号分隔。 |
| `POSTGRES_PASSWORD` | Compose PostgreSQL 密码。 |
| `DATABASE_URL_PG` | API、迁移和 seed 共用的 PostgreSQL 连接串。 |
| `TEST_DATABASE_URL` | 集成测试专用本地 PostgreSQL；账号必须有建库权限。 |
| `CATALOG_DATA_DIR` | seed 数据目录；默认 `../../packages/data/src`。 |

其余配置和默认值见 `.env.example`、`apps/api/src/config.rs`。不要提交 `.env`、数据库文件或凭据日志。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` / `task dev` | 本机运行 API 与 Web，仅数据库使用 Docker。 |
| `task db:up` / `task db:down` | 启动/停止本地 PostgreSQL 容器。 |
| `task db:migrate` | 执行内嵌 SQLx 迁移，拒绝未经接管的 Goose 数据库。 |
| `task db:adopt-goose` | 已停止旧写进程后，一次性显式接管现有 Goose 数据库。 |
| `task db:seed` | 校验题库并写入版本化快照。 |
| `pnpm build` | 构建 Rust release 二进制及 TypeScript workspace 包。 |
| `pnpm test` | shared/data/web 的 Vitest 测试。 |
| `pnpm test:rust` | Rust 单元、契约和无数据库测试。 |
| `task test:integration` | 包括真实 PostgreSQL 测试；必须显式设置 `TEST_DATABASE_URL`。 |
| `pnpm typecheck` | TypeScript 类型检查。 |
| `cargo fmt --all --check` | Rust 格式检查。 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Rust 静态检查。 |
| `task gen` / `task check:generated` | 生成或核对 Rust DTO、JSON 校验 schema 和 Web API 类型。 |
| `pnpm check:multiplayer-boundaries` | Rust 模块依赖边界检查及检查器负例测试。 |
| `pnpm --filter @touhouflandre/web test:e2e` | Playwright E2E；需开发服务运行中。 |

真实数据库测试会为每个用例创建 UUID 命名的独立数据库，应用迁移后运行，结束时删除。仅指向可丢弃的本地测试服务器，不使用生产连接：

```bash
TEST_DATABASE_URL='postgres://touhouflandre:touhouflandre-dev@127.0.0.1:5433/postgres' task test:integration
```

CI 使用独立 PostgreSQL 服务执行包含被忽略集成用例在内的全部 Rust 测试，检查 Clippy、格式、生成物及 release 构建。

## 项目结构

```text
apps/api/
  src/bin/                 server、migrate、seed、healthcheck 入口
  src/game/                字段、答案等价、每日题、范围、搜索与缓存
  src/catalog/             题库读取、远程搜索与 immutable 索引
  src/solo/                单人题局、恢复与幂等写入
  src/multi/               房间、竞速、接力与观察者投影
  src/chat/                房间聊天与历史
  src/realtime/            WS v3 帧、同步屏障、队列和连接注册
  src/ws/                  WebSocket 鉴权与房间服务适配
  src/contracts/           从 OpenAPI 生成的 DTO/schema 与验证入口
  src/database.rs          SQLx 迁移与显式旧库接管
  src/seed.rs              原子题库写入与版本计算
  db/migrations/           不可变 SQLx up/down SQL
  tests/                   黄金样例、契约和真实数据库测试
apps/web/src/              Next 页面、组件、API 客户端及本地统计
packages/shared/src/       前端共享类型、字段、展示与校验辅助
packages/data/src/         角色、作品数据与 Zod schema
contracts/openapi/         HTTP 契约唯一来源
contracts/ws/              WebSocket 协议
```

## 开发约定

前端以 API 返回的会话、房间及公开索引为准。客户端不选择答案或重新计算反馈，进行中的投影不得包含隐藏答案。交互应覆盖加载、空、错误、禁用和完成状态，样式改动检查窄屏及 `prefers-reduced-motion`。

Axum handler 使用从 OpenAPI 生成的 schema 校验请求，业务错误返回稳定错误码及 `ErrorResponse`。领域规则位于 `src/game`；该模块不得依赖数据库或 HTTP 适配层。PostgreSQL 是会话和多人状态的权威，内存仅保留版本化缓存、活动连接和同步队列。事务提交后才能发布事件。

`src/realtime` 不依赖房间或数据库服务；`src/ws` 负责连接协议与应用服务的装配。多人共享 models/store/events 不引用具体模式；race 与 relay 不互相导入。模式 domain 不访问数据库或传输适配层，允许无 I/O 的 `sqlx::FromRow` 数据映射派生。边界检查覆盖 grouped use、相对路径、别名和完全限定调用。

权威规则变更要添加能发现行为回归的 Rust 测试。搜索使用 Rust/TypeScript 共用 fixture；对外契约变更需同步更新生成物和前端调用。

## 数据库迁移

1. 在 `apps/api/db/migrations` 追加同一编号的 `<version>_<name>.up.sql`、`<version>_<name>.down.sql`。
2. 保持 expand/contract 原则，不破坏仍在使用的记录或冻结快照。
3. 执行 `task db:migrate`；SQLx 验证已应用迁移的 checksum。
4. 修改对应 SQLx 查询及其真实 PostgreSQL 集成用例；查询不再通过独立代码生成器生成。
5. 数据变更需要时执行 `task db:seed`，然后运行集成测试与前端回归。

迁移一旦应用即不可变；追加迁移而非修改旧文件。迁移由 `sqlx::migrate!` 内嵌，`build.rs` 监视迁移目录，新增文件后需重新构建二进制。

旧库首次切换前停止所有旧 API、Goose 迁移任务和其他写进程，先备份，再显式运行 `task db:adopt-goose`。该命令核对既有迁移历史及基础表存在性并建立 SQLx 记录；普通 `db:migrate` 不会自动接管。成功后只使用 SQLx 迁移入口，不再运行 Goose。生产步骤见[部署指南](./deployment.md)。

## 故障排查

Web 请求失败时，先确认 API 正在监听 `4000`，再检查 `/readyz`。503 可能是 PostgreSQL 不可达、迁移未完成或当前题库快照缺失，依次检查 `task db:up`、连接串、迁移及 seed。

seed 后角色目录使用最新题库，已经开始的题局仍引用原冻结快照。已创建的当天每日题不会因 seed 或判定策略配置变化而改变，日期按 `Asia/Shanghai` 划分。

提交 PR 前通过 Issue 对齐需求、验收或数据来源，遵守[站点开发计划](./site-development-plan.md)。避免混入日志、数据库文件、无关格式化或来源不明媒体。
