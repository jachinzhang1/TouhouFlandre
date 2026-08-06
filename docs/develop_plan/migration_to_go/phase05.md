# Phase 5 开发计划 — 清理仓库

> 依据：[`05_tech_stack_migration.md`](../05_tech_stack_migration.md) §11/§13 Phase 5；[`phase04.md`](./phase04.md) §10
> 状态：已完成（执行记录见 §10）
> 影响范围：`packages/shared`（无调用者导出删除）、`Taskfile.yml`（goose 版本固定）、CI/文档微调
> 原则：**只删无调用者代码；Go 是权威游戏规则（Phase 2/3 已平移），shared 仅保留前端与 data 校验所需；提交即回滚**

---

## 1. 目标与边界

### 目标

1. 删除 `packages/shared` 中无调用者的导出（Phase 2 后 Go 已承担权威规则，TS 副本不再被前端/Go 使用）。
2. 工具链可复现：goose 迁移工具版本固定；`task gen` 全链（openapi/repo/web）重新生成零 diff。
3. README/开发命令/CI 与现状核对收尾（Phase 4 已做大部分，仅残留项）。

### 非目标（本阶段明确不做）

- 不拆分 `packages/shared` 为多包（05 §11「按调用者逐步拆解」是长期方向，非本次删除范围）。
- 不同步 `06_tech_stack_migration_summary.md`（用户指示 2026-08-05）。
- 不做 Phase 4 之后的任何功能或框架变更。

---

## 2. 前置条件（Phase 4 交付物）

- [ ] `apps/web` 已是 Next.js 16（Phase 4 完成）。
- [ ] Go 权威规则（`internal/game`）与 shared 副本等价性已由黄金用例验证（Phase 2）。
- [ ] 调用面盘点完成（本文件 §3 事实清单）。

---

## 3. 关键事实（2026-08-05 盘点）

`packages/shared` 8 个文件的实际调用面：

| 文件 | 符号 | 调用者 | 处置 |
|---|---|---|---|
| compare.ts | `compareField`、`compareCharacter` | 无（Go `internal/game` 已承担） | 删除 |
| daily.ts | `PUZZLE_DATE_KEY`、`getPuzzleDateKey`、`getDailyAnswer` | 无（Go 已承担；前端模式配置在 modes.ts） | 删除 |
| fields.ts | `GAME_CONTENT_DEFINITIONS`、`HAIR_COLOR_LABELS` | web（游戏页/首页） | 保留 |
| fields.ts | `CHARACTER_FIELD`、`GUESS_FIELD`、`WORK_FIELD` 等其余导出 | 待核对（见 T1 动作） | 核对后删 |
| modes.ts | `SINGLE_PLAYER_GAME_MODES`、`SINGLE_PLAYER_MODE_DEFINITIONS`、`isSinglePlayerGameMode`、`SinglePlayerModeDefinition` | web（lobby/游戏页） | 保留 |
| search.ts | `normalizeSearchText` | packages/data `validate.ts`（seed 校验一致性） | 保留 |
| search.ts | `characterSearchText`、`toSearchResult`、`CharacterSearchOptions`、`characterNameSortKey`、`compareCharacters`、`searchCharacters` | 无（Go 搜索走 DB `search_text`，web 走 API） | 删除 |
| share.ts | `createShareText` | web（游戏页分享） | 保留 |
| types.ts | `PublicGameSession`、`SinglePlayerGameMode`、`CharacterSort`、`SortDirection`、`FieldFeedback`、`CharacterSearchResult`、`Character`、`CatalogSummary` 等 | web | 保留（逐个核对） |
| types.ts | `GuessFieldKey`、`GuessResult`、`CharacterSearchResponse`、`CatalogContentSummary` 等 | 待核对 | 核对后删 |

注意：`searchCharacters` 在 `apps/web/src/lib/api.ts` 是 API 客户端方法名，与 shared 无关，不删。

---

## 4. 任务分解

### T1 — shared 无调用者清理

**输入**：§3 事实清单。
**动作**：

1. 逐符号核对（grep 全仓库非 docs、非 node_modules、非 shared 自身）：
   - 无调用者 → 从 `compare.ts`/`daily.ts`/`search.ts`（保留 normalizeSearchText）/`types.ts`/`fields.ts` 删除；
   - 组合使用（如 `GAME_CONTENT_DEFINITIONS` 依赖的类型）检查连带依赖，只删最终无引用者；
   - `index.ts` 的 `export *` 同步（删除空文件的 export 行或整个文件）。
2. 若有导出只剩自身内部使用（模块私有辅助），一并内联或删除。
3. 回归：`pnpm test`（shared/data/web）、`pnpm typecheck`、`pnpm build`。

**验收**：

- [ ] §3 清单中的删除项全部移除；`grep` 无悬挂 import（web/Go/data 全部可编译）。
- [ ] 测试与构建全绿。

### T2 — 收尾核对（README/命令/CI）

**输入**：T1 后仓库状态。
**动作**：

1. README「Scripts」与开发流程对照实际命令（`task gen` 现在含 gen:web）。
2. CI 复查：`check` job 的 `gen:api` 命令与 `task gen:web` 等价；无残留引用。
3. Taskfile：确认 `gen` 链包含 gen:openapi/gen:repo/gen:web（已补）。

**验收**：

- [ ] README/CI 与实际命令一致（可照抄执行）。
- [ ] CI 配置无过时引用。

### T3 — 工具链可复现

**输入**：T2。
**动作**：

1. goose 版本固定：`Taskfile.yml` 的 `db:migrate` 改为固定版本执行（`go run github.com/pressly/goose/v3/cmd/goose@<锁定版本> -dir migrations up`），或在 `apps/api/go.mod` 增加 goose 工具依赖 + `task db:migrate` 走本地二进制；记录锁定版本到文档。
2. `task gen` 全链执行后 `git diff --exit-code`（openapi 生成物、sqlc 生成物、web generated/api.ts）零差异。
3. 确认 sqlc（1.31.1，CI 已锁）与 oapi-codegen 版本可复现。

**验收**：

- [ ] `task db:migrate` 使用固定版本 goose（README/04 记录版本）。
- [ ] `task gen` 后工作区无 diff。

### T4 — 文档与执行记录

**输入**：T3 完成。
**动作**：

1. `05_tech_stack_migration.md`：§13 Phase 5 标记完成。
2. `phase05.md`：追加执行记录（本文件 §10）。
3. 若 shared 删除影响 04/README 结构描述，同步。

**验收**：

- [ ] 文档与实现一致。

---

## 5. 总验收标准（阶段退出条件）

1. `packages/shared` 无调用者导出清零（grep + `tsc --noEmit` 双重确认）。
2. `pnpm test`、`pnpm typecheck`、`pnpm build`、`go test ./...`、`go vet ./...` 全绿。
3. `task gen`（含 gen:web）重新生成零 diff；goose 版本固定可复现。
4. 文档（05/phase05/README/04）与实现一致。

## 6. 风险与回滚

| 风险 | 等级 | 缓解 |
|---|---|---|
| 误删仍有运行期引用的导出 | 中 | 逐符号 grep + typecheck/build 全绿后提交 |
| Go 与 shared 规则未来漂移（若重新引入 TS 逻辑） | 低 | Go 是权威（05 §6）；shared 仅剩类型/展示 |
| goose 版本升级破坏迁移 | 低 | 固定版本执行；升级走显式提交 |
| **回滚**：`git checkout` 恢复 shared 导出与 Taskfile（git 历史完整） | — | 提交即回滚 |

## 7. 与后续阶段的衔接

- **07 产品化（Stage 2+）**：身份/后台/多人实现时，如需前端类型先回到 `packages/shared` 或 OpenAPI 生成类型，以契约（OpenAPI）为准补充，不重建 TS 规则副本。
- **05 §11 拆分**：若 shared 体积增长，再按调用者拆分（当前不预做）。

---

## 10. 执行记录（2026-08-05）

> 执行人：承接 Phase 4 的同一工作会话。提交：`33ae033`（gen:web）→ P5 清理提交。

### T1 — shared 清理 ✅

- 删除 `compare.ts`（compareField/compareCharacter）与 `tests/compare.test.ts`——Go `internal/game` 已承担权威比较（Phase 2 黄金用例等价验证）。
- 删除 `daily.ts`（PUZZLE_DATE_KEY/getPuzzleDateKey/getDailyAnswer）——Go 已承担；前端模式配置来自 modes.ts。
- `search.ts` 仅保留 `normalizeSearchText`（`packages/data` validate.ts 仍用于 seed 校验一致性）；删除 `characterSearchText`/`toSearchResult`/`CharacterSearchOptions`/`characterNameSortKey`/`compareCharacters`/`searchCharacters`（Go 搜索走 DB `search_text`，web 走 API）。
- `fields.ts` 删除 `GUESS_FIELDS`（compatibility export，无消费者）、`WORK_TYPE_LABELS`（无消费者）。
- `types.ts` 删除 `Work`（web/data 无引用；works 数据由 zod schema 校验）。
- `index.ts` 移除 compare/daily 的 export。
- shared `test` script 加 `--passWithNoTests`（tests 目录清空后 vitest 报错）。
- 验证：`pnpm typecheck`、`pnpm test`（shared/data/web）、`pnpm build` 全绿。

### T2 — 收尾核对 ✅

- README/CI 无 shared 内部符号引用（grep 仅命中 phase02/phase05 计划文档的历史记录，属预期）。
- 命令与文档一致性已在 Phase 4 T7 核对。

### T3 — 工具链可复现 ✅

- **goose 固定**：`go get -tool github.com/pressly/goose/v3/cmd/goose@v3.27.3`（go.mod `tool` 指令）；`Taskfile db:migrate` 改为 `go tool goose -dir migrations up`。迁移执行验证通过（v1，无变更）。
- 顺带升级 `modernc.org/libc` v1.74.3 → v1.74.4（goose 传递依赖 retracted 警告）。
- `task gen` 全链（gen:openapi + gen:repo + gen:web）执行后生成物（openapi 生成、sqlc 生成、web generated/api.ts）**零 diff**。

### T4 — 文档 ✅

- `05_tech_stack_migration.md`：§13 Phase 5 标记完成。
- 本文件状态头与执行记录更新。

### 偏差汇总

| 偏差 | 原因 | 影响 |
|---|---|---|
| shared `test` 加 `--passWithNoTests` | tests 目录随 compare 删除清空 | packages/shared/package.json |
| 无其他偏差 | — | — |
