# Phase 2 开发计划 — 引入 Postgres、Go 与题库迁移

> 依据：[`05_tech_stack_migration.md`](../05_tech_stack_migration.md) §6、§8、§11、§12、§13 Phase 2；[`07_productization_plan.md`](../07_productization_plan.md) §4.1、§4.4
> 状态：✅ 已完成（执行记录见 §10）
> 影响范围：`apps/api`（新增 Go module）、`contracts/`（复用 Phase 1）、`Taskfile.yml`（新建）、`compose.yaml`（新建）、CI
> 原则：**后端先行、并存验证、不切流量**。Phase 2 只建设 Go 实现并验证，Express 继续承载全部流量；切流是 Phase 3 的事。

---

## 1. 目标与边界

### 目标

1. 在 `apps/api` 内建立 Go module：`cmd/`、`internal/`、`migrations/`（goose）、`sql/queries/`（sqlc）。
2. 全部 6 个 Prisma 模型迁入 Postgres（JSONB 化），goose 管理迁移，sqlc 生成数据访问层。
3. Go seed 从 `packages/data` 题库 JSON 重建快照与行表，数据哈希与 TS 侧一致。
4. `packages/shared` 的权威游戏逻辑（compare/daily/modes/search 归一化）平移进 `internal/game`，TS 用例翻译为 Go 测试（黄金用例）。
5. `oapi-codegen` 从 Phase 1 的 `contracts/openapi/openapi.yaml` 生成 strict server interface，Echo 实现全部 6 端点，响应通过 OpenAPI 校验。
6. 集成测试运行于真实 Postgres；**流量仍走 Express**，Go 仅验证。

### 非目标（本阶段明确不做）

- **不切流量**：前端仍请求 Express（4000）；Go 服务只监听 4100 供验证。
- 不实现身份认证、后台、多人房间（产品化阶段）。
- 不实现题库内存索引（07 §4.4 后期预案，由性能证据触发）。
- 不引入 `Idempotency-Key`（后续阶段）。
- 不迁移 Express 代码（Phase 3 直接删除，git 历史可回溯）。

---

## 2. 前置条件（Phase 1 交付物，开工前必须完成）

- [ ] `contracts/openapi/openapi.yaml` 唯一入口、6 端点全覆盖、lint/孤儿检查通过（Phase 1 已完成）。
- [ ] 契约测试（`apps/api/tests/contract.test.ts`）全绿——本阶段复用它做双后端对照。
- [ ] 本机环境：Go ≥ 1.26、Docker（含 compose）、sqlc v1.31.1、goose v3.27.3（已确认）。
- [ ] 现有测试基线（`pnpm test`、`pnpm typecheck`）通过。

---

## 3. 关键决策（规划期冻结）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **并存结构**：Go module 直接建在 `apps/api`（`cmd/`、`internal/`、`migrations/`、`sql/`、`go.mod`），TS/Express 保留在 `src/` + `tests/` 共存 | 不动现有路径、契约测试继续跑；`tsc` 只编译 `.ts`、`go build` 只编译 `.go`，互不干扰。Phase 3 切流后删除 `src/` |
| D2 | **数据处置：丢弃 demo 运行时数据**（`GameSession`/`DailyPuzzle` 不导入），题库由 Go seed 重建 | 开发期数据无保留价值（对齐 07 §4.1 选项一）；避免编写一次性导入器 |
| D3 | **本地 Postgres 用 Docker Compose**：`compose.yaml` 新建，`postgres:18.4-alpine` + 健康检查 + 命名卷（05 §12 目标形态） | 本地只容器化基础设施；生产部署形态另行规划 |
| D4 | **Go 服务端口 4100**，Express 保持 4000 | 并存期互不干扰；前端代理不动 |
| D5 | **JSONB 映射**：`*_Json` 列 → `jsonb`；`searchText` → `text` + 索引（搜索路径不变）；快照 `charactersJson` → `jsonb` | 对齐 05 §8.2 原则（低频展示字段 JSONB） |
| D6 | **搜索语义**：`searchText` 查询用 `ILIKE '%q%'`（Postgres），保持 SQLite `LIKE` 的 ASCII 大小写不敏感行为 | 归一化在 seed 时完成，查询只做子串匹配；中文/日文无大小写差异 |
| D7 | **题库版本**：Go seed 复算 FNV-1a（对齐 `packages/data` `demoCatalogVersion`）；验收时与 TS 输出对比，不一致则调整 Go 序列化（键序、无空格） | 版本是快照主键，需与 TS 计算同源 |
| D8 | **错误模型**：Go 输出 `{ code, error }`，错误码枚举复用 Phase 1 契约（9 个 code） | 与 Express 行为一致，契约测试可直接对照 |
| D9 | **Taskfile 本阶段引入**（拐点）：提供 `db:up`/`db:migrate`/`db:seed`/`gen`/`check:generated`/`test:go`/`dev:go` | 任务从纯 JS 变跨语言，05 §12 目标形态的首个落地 |
| D10 | **生成代码入库**：`internal/generated/{openapi,repo}` 提交仓库，CI 重新生成后 diff 检查 | 对齐 05 §7.4，防漂移 |

---

## 4. 目标结构（本阶段结束时的 `apps/api`）

```text
apps/api/                        # 单 Go module + 并存 TS/Express
├── cmd/
│   ├── server/main.go           # Echo + 路由挂载，监听 4100
│   └── seed/main.go             # 读题库 JSON → 写 Postgres
├── internal/
│   ├── game/                    # 纯逻辑平移：compare/daily/modes/search 归一化（含 *_test.go）
│   ├── generated/
│   │   ├── openapi/             # oapi-codegen 生成（strict server + DTO），禁止手改
│   │   └── repo/                # sqlc 生成（models + queries），禁止手改
│   ├── handler/                 # Echo handlers：实现 generated 接口，错误映射 { code, error }
│   └── config/                  # env 读取（DATABASE_URL、API_PORT）
├── migrations/                  # goose：0001_init.sql（6 表 + 索引 + 外键）
├── sql/queries/                 # sqlc 查询定义
├── sqlc.yaml
├── go.mod / go.sum              # go 1.26；echo v4、pgx v5、kin-openapi
├── src/  tests/                 # Express 并存（Phase 3 删除）
└── tsconfig.json                # 保持现状，只编译 .ts
```

根目录新增：`Taskfile.yml`、`compose.yaml`、`go.work`（**不引入**，单模块，见 05 §11）。

---

## 5. 数据库模型映射（SQLite → Postgres）

| Prisma 模型 | Postgres 表 | 要点 |
|---|---|---|
| `Character` | `character` | `namesJson`/`firstAppearanceJson`/`speciesJson`/`abilityTagsJson`/`affiliationsJson`/`locationsJson`/`rolesJson`/`hairColorsJson`/`sourceRefsJson` → `jsonb`；`searchText`/`nameSortKey` → `text`；索引 `(enabled_as_guess, name_sort_key)`、`(enabled_as_guess, appearance_order)`、`(first_appearance_work_id)` |
| `Work` | `work` | 同列名 |
| `CatalogSnapshot` | `catalog_snapshot` | `charactersJson` → `jsonb`；`version` PK |
| `CatalogState` | `catalog_state` | 单行 `id='current'`，`current_version` UNIQUE + FK → `catalog_snapshot.version` |
| `DailyPuzzle` | `daily_puzzle` | `date_key` PK；`catalog_version` FK；索引 |
| `GameSession` | `game_session` | `guessesJson` → `jsonb`；`version` 乐观锁列保留；`catalog_version` FK；索引 `(mode)`、`(status)`、`(catalog_version)` |

命名约定：Postgres 用 snake_case（sqlc 默认映射），外键 `on delete restrict` 保持快照保护语义。

---

## 6. 任务分解

任务有依赖序；每项完成即标记，验收不通过不进入下一任务。

### T1 — 环境与工具链

**输入**：§2 前置条件。
**动作**：

1. 创建 `compose.yaml`：`postgres:18.4-alpine`，`POSTGRES_DB/USER/PASSWORD`（touhouflandre），端口 5432，命名卷 `pgdata`，`pg_isready` 健康检查（照 05 §12 示例）。
2. 创建 `apps/api/go.mod`（module `github.com/TouhouFlandre/touhouflandre/apps/api`，go 1.26）；建 `cmd/server`、`cmd/seed`、`internal/{game,handler,config}` 骨架。
3. 创建 `Taskfile.yml`（根目录）：`db:up`（`docker compose up -d --wait postgres`）、`db:down`、`db:migrate`、`db:seed`（deps: 校验 + Go seed）、`gen:openapi`、`gen:repo`、`gen`、`check:generated`、`test:go`、`dev:go`。
4. 固定版本：goose v3.27.3、sqlc v1.31.1（本机已装）；`oapi-codegen` v2 通过 `go run` 使用；Echo v4、pgx v5、kin-openapi 写入 `go.mod`。

**验收**：

- [ ] `task db:up` 后 `docker compose ps` 显示 postgres healthy。
- [ ] `go build ./...` 在 `apps/api` 通过（空骨架）。
- [ ] `task -l` 列出全部任务。

### T2 — goose 迁移（6 表）

**输入**：§5 映射表；`prisma/schema.prisma`。
**动作**：

1. 编写 `migrations/0001_init.sql`（up + down）：6 表、snake_case、`jsonb` 列、索引、外键（`on delete restrict`）。
2. 空库执行 `goose -dir migrations up` 验证；`down` 验证回滚。

**验收**：

- [ ] 全新 Postgres 上 `up` 成功，`\dt` 有 6 张表。
- [ ] `down` 回滚到空库（测试库验证）。
- [ ] 列/索引与 §5 一致（对照 schema.prisma 逐项核对）。

### T3 — sqlc 查询

**输入**：T2 迁移；`apps/api/src/game.ts`、`db.ts` 的查询语义（逐条对应）。
**动作**：

1. `sqlc.yaml`：engine postgresql，schema 指向 migration 产出的 schema（`--schema migrations` 或导出 schema.sql），queries 目录 `sql/queries`，gen go 输出 `internal/generated/repo`。
2. 编写查询：角色搜索（`searchText ILIKE` + 排序 + limit/offset + count）、`enabledAsGuess` 过滤、catalog 摘要计数、快照读写（upsert）、CatalogState 读写、每日题 upsert/查、会话创建/查询/乐观锁更新（`UPDATE ... WHERE version = ?` 返回行数）、`getCatalogCharacters(version)` 快照读取。
3. `sqlc generate` 验证零错误。

**验收**：

- [ ] `sqlc generate` 零错误，产物在 `internal/generated/repo`。
- [ ] 关键查询（搜索、乐观锁更新、快照读取）在真实 Postgres 上手工执行验证结果正确（可先用 psql 验证 SQL）。

### T4 — internal/game 纯逻辑平移

**输入**：`packages/shared/src/{compare,daily,modes,search}.ts`；`packages/shared/tests/compare.test.ts`（12 用例）。
**动作**：

1. 平移 `compareCharacter`/`compareCharacters`、`getDailyAnswer`/`getPuzzleDateKey`、`SINGLE_PLAYER_MODE_DEFINITIONS`、`normalizeSearchText` 到 `internal/game`。
2. 将 `compare.test.ts` 12 个用例翻译为 Go 测试（固定输入断言）；补 daily 日期键边界（时区、闰日）与 modes 约束测试。
3. 随机源与时钟可注入（`internal/game` 导出带 rand 源/clock 的构造或函数参数），为集成测试固定随机做准备。

**验收**：

- [ ] `go test ./internal/game` 全绿。
- [ ] 同一固定输入，Go 与 TS 输出逐一相等（黄金用例表驱动，12+ 用例）。

### T5 — Go seed

**输入**：`packages/data/src/characters.demo.json`、`works.demo.json`；D7 决策。
**动作**：

1. `cmd/seed` 读取两个 JSON（路径经 env `CATALOG_DATA_DIR` 或相对仓库根解析），定义与源结构对应的 Go struct（含 `appearanceOrder` 派生、`firstAppearance` 展开——对齐 `packages/data/src/index.ts` 的组装逻辑）。
2. 复算 FNV-1a 版本（对齐 `hashString`/`demoCatalogVersion`）；事务写入：行表 upsert + 快照 upsert + `CatalogState.currentVersion` 更新。
3. `Taskfile` 的 `db:seed` = `pnpm --filter @touhoufriberg/data validate`（Zod 前置）→ `go run ./cmd/seed`。

**验收**：

- [ ] seed 后：`work` 9 行、`character` 29 行、快照 1 行、`current_version` = TS 侧 `demoCatalogVersion`（对比输出，D7）。
- [ ] 重复 seed 幂等（upsert，不产生重复行）。

### T6 — oapi-codegen 生成与 Echo handlers

**输入**：Phase 1 `contracts/openapi/openapi.yaml`。
**动作**：

1. `oapi-codegen`（v2，echo 模板）生成 strict server interface + DTO 到 `internal/generated/openapi`；`Taskfile gen:openapi` 固化命令。
2. `internal/handler` 实现全部 6 端点：health、characters/search、catalog、puzzles/{mode}、sessions/{sessionId}/guess、sessions/{sessionId}。
3. 接入 kin-openapi 请求校验中间件（照 05 §6.2）；错误映射为 `{ code, error }`（错误码枚举复用契约，见 D8）；`getPuzzleDateKey` 用可注入时钟。
4. `cmd/server`：Echo 监听 4100，`/livez`、`/readyz`（readiness 查库，对齐 07 §8.2）。

**验收**：

- [ ] `go build ./...` 通过；`go run ./cmd/server` 起 4100。
- [ ] 6 端点全部可调用；非法参数返回 400 + 合法错误码。
- [ ] 生成代码禁止手改（`internal/generated` 注释声明）。

### T7 — 集成测试（真实 Postgres）

**输入**：T3-T6 产物。
**动作**：

1. 测试库：独立 database（如 `touhouflandre_test`），`beforeAll` 跑 goose up + seed（或复用 `task db:seed` 的同一入口）。
2. `httptest` 起 Echo app，覆盖：6 端点成功路径（对照契约测试的成功形状）、400/404/409/503 错误路径、并发猜测（两协程同猜 → 恰一个成功，另一个 409 `CONCURRENT_UPDATE`）、每日题固定答案（固定时钟两次请求同 `date_key` 同 `answerId`）。
3. 响应校验：用 kin-openapi（或复用 ajv 对 OpenAPI schema）断言响应符合 `openapi.yaml`。

**验收**：

- [ ] 集成测试全绿；故意改一个响应字段名，测试变红。
- [ ] 并发用例稳定通过（重试 3 次无 flake）。

### T8 — 回归与衔接

**动作**：

1. 双后端并存回归：`pnpm test`（Express 契约测试仍绿）、`pnpm typecheck`、Go 侧 `go vet ./...` + `go test ./...`。
2. seed 哈希对照：Go seed 输出 vs `packages/data` `demoCatalogVersion`（D7 验证，失败则修 Go 序列化）。
3. `task check:generated`：openapi + sqlc 重新生成后工作区无 diff。
4. 更新文档：`phase02.md` 标记完成并记录执行偏差；05 §12 Taskfile 示例与实际对齐。

**验收**：

- [ ] Phase 1 全部验收保持通过；Express 行为零变化。
- [ ] Go 全部 6 端点通过契约校验；`task -l` 任务全部可用。

---

## 7. 总验收标准（阶段退出条件）

1. Go 服务（4100）6 端点全部通过集成测试与 OpenAPI 响应校验，错误码与契约一致。
2. `internal/game` 黄金用例与 TS 行为一致（固定输入逐一相等）。
3. 空 Postgres 可一键 `task db:migrate` + `task db:seed`，数据哈希与 TS 一致，重复 seed 幂等。
4. Taskfile 的 `db:*`/`gen`/`check:generated`/`test:go` 全部可用；CI（Go job + Postgres service）全绿。
5. **Express 未受影响**：`pnpm test`/`typecheck` 绿，前端可玩（流量未切换）。

## 8. 风险与回滚

| 风险 | 等级 | 缓解 |
|---|---|---|
| SQLite→Postgres 语义差（LIKE/JSON 排序/事务） | 高 | ILIKE（D6）；集成测试覆盖并发与快照路径；黄金用例逐字段断言 |
| 快照 JSON 序列化与 TS 不一致（FNV 版本漂移） | 中 | D7：复算对比，验收强制；失败则对齐 Go 序列化键序/紧凑格式 |
| `jsonb` 列内字段顺序影响 Go 解析 | 低 | 快照由 Go 自己写自己读（D2 数据丢弃规避跨实现互操作） |
| 并发乐观锁测试 flake | 中 | T7 重试 3 次；updateMany 等价 WHERE 条件 |
| goose/sqlc/oapi-codegen 版本与生成结果漂移 | 中 | 版本固定（T1）、生成代码入库、`check:generated` 进 CI |
| Postgres 环境依赖（docker 不可用） | 低 | compose 为本地方案；CI 用 service；文档注明替代（托管实例） |
| **回滚**：Go 未切流，任何问题只需不启动 4100；Express 全量承载，删除 `apps/api` 的 Go 部分即恢复 Phase 1 状态 |

## 9. 与后续阶段的衔接

- **Phase 3（切换后端）**：入口代理 `/api/*` 指向 Go（4100 → 4000 或反代切换），删除 Express `src/` + `tests/` + Prisma/SQLite 依赖；Go 服务接替 4000 端口。
- **Phase 4（前端迁移）**：`apps/web/src/generated` 与 `src/lib/api.ts` 已依赖契约,切流后自动指向新后端,无需改动。
- **07 验收对齐**：本阶段完成后,「数据」验收场景（题库版本、每日题固定答案、并发猜测、旧记录兼容）在 Go 实现上通过（07 §9 第二行）。

---

## 10. 执行记录（2026-08-05，分支 feature/migrate-to-go）

### 完成情况

- T1-T8 全部完成；退出条件 5 条全部满足：Go 6 端点过契约校验与集成测试、黄金用例与 TS 逐一相等、空库一键 migrate+seed（版本 `5a81c4c8` 与 TS `demoCatalogVersion` 完全一致）、Taskfile/CI 全绿、Express 零影响（`pnpm test` 26 用例全绿）。
- Go 测试 12（game 黄金用例）+ 10（server 集成）全绿，集成测试连跑 5 次无 flake。

### 关键实现

- `internal/game`：compare/daily/modes/search 平移，`Character` 字段序严格对齐 TS 组装序（版本哈希依赖键序）。
- `internal/seed`（从 cmd 抽取，可测试）：读 `packages/data` JSON → 行表 + 快照 + `CatalogState`，FNV-1a 复算版本。
- `internal/handler` + `internal/server`：oapi-codegen strict 实现，kin-openapi 请求校验（livez/readyz 跳过），错误映射 `{ code, error }`。
- 搜索：`search_text ILIKE` + CASE 方向排序（4 个 sqlc 查询），保持 SQLite `LIKE` 语义。

### 执行中发现的真实问题与修复

| 问题 | 修复 |
|---|---|
| 本机 5432 被其他项目容器占用 | compose 映射 `5433:5432`，`.env` 连接串走 5433 |
| Taskfile v3 不支持 `sh:` 键 | 改用 `bash -c 'set -a && . ../../.env && set +a && …'` |
| sqlc：`@limit`/`@offset` 保留字、`@q` 推断为 `interface{}` | 参数改名 `@max_results`/`@page_offset`；`@q::text` 显式类型；`sql_package: pgx/v5` |
| oapi-codegen 多文件 $ref 报 external reference | `redocly bundle` 合并为单文件再生成（import-mapping 指向自身包会生成无效 self-import） |
| 集成测试 URL 替换误伤 user 字段 | `replaceDBName` 用 `LastIndex` 只替换路径 |
| DROP/CREATE 测试库需 admin 连接 | TestMain 先连 `postgres` 库重建，再连测试库 |
| 并发/重复猜测用例数据相关 flake（猜中答案导致 SESSION_CLOSED） | 用例从库中选非答案角色 |
| echo-middleware v1.1.0 无 Skip 选项 | 包装中间件按 `c.Path()` 跳过 /livez、/readyz |
| Go seed/server 不可测试 | 抽取 `internal/seed`、`internal/server` 包 |

### 与计划的偏差

- `compose.yaml` 端口 5433（环境冲突，文档 05 §12 示例为 5432，落地以 .env 为准）。
- 版本哈希复算一次通过（D7 无偏差）；`hashString` 导出为 `game.HashString` 供 seed 复用。
- CI 拆为 `check`（JS/契约）与 `go`（vet/build/test + 生成 diff，Postgres service）两个 job。
- `internal/handler` 内新增 service 逻辑（selectAnswer/createSession/快照加载），未另设 service 包（规模小）。
