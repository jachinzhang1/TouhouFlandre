# HSO-005：将单人题局恢复或创建收敛为一次请求

**类型**：性能/单人流程 Issue  
**优先级**：P0  
**依赖**：HSO-002  
**状态**：已完成

**建议标签**：`type:performance` `area:api` `area:web` `area:contracts` `area:test`

## 要解决的问题

当前浏览器先判断每日日期、读取旧 session、判断是否匹配，失败后再创建；随机新局还会先下载 `CatalogFull` 以修正本地题库设置。串行公网请求放大弱网等待，恢复判断和旧局统计清理也散落在 Web。

直接扩展旧创建端点会破坏新 Web 对旧 API 的回退：旧 API 可能忽略新字段并先创建题局。因此本 Issue使用全新 resolve 端点，404/405 时才能安全走旧流程。

## 要做到什么程度

新增：

```http
POST /api/puzzles/{mode}/resolve
```

请求复用 `questionScope`、`difficulty`，增加客户端生成且重试复用的 `idempotencyKey` 与可选 `resumeSessionId`。响应复用 `puzzleLabel`、`session`，增加 `resolution=created|resumed` 和可选 `supersededSession`。服务端一次决定恢复有效旧局，或按当前每日日期/随机范围创建新局。

## 服务端行为

- session 不存在：创建，`resolution=created`，不返回 superseded。
- random session 存在且 mode=random：恢复，无论 playing/won/lost，`resolution=resumed`。
- daily session 的 mode、当天 puzzleKey 和请求 difficulty 均匹配：恢复，`resolution=resumed`。
- session 存在但模式、日期或难度不匹配：创建并返回旧公开会话为 `supersededSession`。
- `questionScope` 只在创建 random 时使用；服务端按当前题库规范化。无效/不可解析本地存储时 Web 不发送，使用默认范围。
- daily 忽略调用方 questionScope，由服务端按当天和 difficulty 生成冻结范围。

## 幂等与并发行为

`idempotencyKey` 标识一次 resolve 意图，Web 在网络超时、连接断开或响应丢失后必须使用同一个 key 重试。服务端将规范化请求指纹（mode、resumeSessionId、difficulty、questionScope 等影响结果的字段）与最终 session、resolution、supersededSession 响应绑定并持久化；同 key+同指纹返回首次结果，不再次执行业务创建。相同 key+不同指纹返回 `409 IDEMPOTENCY_KEY_REUSED`，不创建或修改题局。

同一 key 的并发请求必须在创建/恢复事务中通过唯一约束和行锁（或等价数据库原子操作）串行化：只有一个请求能提交创建，其他请求等待后读取已保存结果。幂等记录至少保留到关联 session 的可恢复窗口结束，清理由独立维护任务负责；过期后才允许按明确规则复用 key。记录字段不得包含答案或未公开题局数据。旧 create-only 端点继续保持非幂等原义。

## 属于本 Issue

- 新 OpenAPI path、请求/响应 schema、handler/service 和生成物；必要的 additive 幂等记录表/字段及迁移由本 Issue 独占。
- 抽取可测试的 resolve 决策，复用现有 session 投影、答案选择和创建逻辑。
- Web 在独立 `apps/web/src/lib/puzzleApi.ts` 增加 `resolvePuzzle`，只在端点明确可用时使用；同一 resolve 意图重试复用 idempotencyKey。404/405 在本页标记旧 API 并执行现有流程，其他错误不误判为不支持。
- 暴露安全读取 localStorage 题库配置输入的方法，不再为创建随机题局先请求 `/api/catalog/full`。
- 用响应 `session.questionScope` 修正并保存本地配置。
- SingleGamePage 保留现有计时恢复、猜测时间、统计归档、草稿保存/删除、finished session 展示和显式重新开始语义。
- 每日其他难度状态在主 session 返回后后台刷新，不阻塞当前题局可用。

## 不属于本 Issue

- 不修改角色搜索 Hook、本地索引或多人搜索。
- 不删除旧 `POST /api/puzzles/{mode}` 或 `GET /api/sessions/{sessionId}`。
- 不将每日四个难度状态合并成新批量 API；只调整为后台刷新。
- 不改变答案随机、每日题唯一性、题库范围规范化、计时或统计定义。
- 不处理多人房间创建前的题库设置加载。
- 不修改题局业务字段、答案或统计语义；不让幂等记录改变旧 create-only API 的行为。

## 可能涉及的代码

- `contracts/openapi/paths/`、`contracts/openapi/schemas/session.yaml` 与生成物
- `apps/api/internal/handler/{server.go,service.go}` 及 server tests
- `apps/web/src/lib/puzzleApi.ts`（本 Issue 所有；HSO-004 不修改）
- `apps/web/src/components/SingleGamePage.tsx` 及测试
- `apps/web/src/lib/questionScopeStorage.ts`

## 验收标准

- [ ] 有效 random 和当天各 difficulty daily session 均由一次 resolve 请求恢复，session ID 和进度不变。
- [ ] 404 session、过期 daily、难度不匹配和 mode 不匹配由同一请求创建正确新局。
- [ ] supersededSession 使现有 completed/playing 统计归档与草稿清理结果和改造前一致。
- [ ] random 无旧局主流程不请求 `/api/catalog/full`，服务端返回并持久化规范化 scope。
- [ ] daily 主流程不先请求 `/api/catalog` 获取日期；其他难度状态失败不影响当前题局。
- [ ] 同一日期已结束 daily 仍恢复结果，不意外创建第二局。
- [ ] resolve 404/405 时新 Web 只执行一次旧 `GET session -> POST puzzle` 兼容流程；其他 4xx/5xx 不触发可能重复创建的 fallback。
- [ ] 同一 idempotencyKey + 同一请求指纹的超时重试返回首次 session/resolution，不创建第二局；并发相同 key 也只有一个创建事务提交。
- [ ] 同一 idempotencyKey + 不同请求指纹返回 `409 IDEMPOTENCY_KEY_REUSED`，响应不修改已有题局；幂等记录保留和过期复用规则有测试证据。
- [ ] 旧创建/恢复 API 的现有测试和客户端仍通过。
- [ ] additive 幂等记录迁移可重复执行、唯一约束生效，OpenAPI 生成与二次生成无漂移。

## 测试计划

- Go handler/service 表驱动测试覆盖两种模式、四种 daily difficulty、playing/finished、404 和 mismatch；补充相同 key 重试、并发竞争、不同指纹冲突、记录过期和迁移唯一约束测试。
- Web component 测试断言请求顺序、兼容 fallback、superseded 统计、计时恢复和后台状态失败。
- 网络调用计数测试分别覆盖 random fresh/resume、daily fresh/resume/expired。
- 运行 OpenAPI checks、Go 全量测试、Web typecheck/Vitest/build。

## 依赖与后续

依赖 HSO-002 已完成第一批 OpenAPI/handler 生成物，避免并行修改同一接口面。HSO-005 独占 `puzzleApi.ts` 与幂等迁移；HSO-004 不修改这些路径。HSO-006 在本 Issue 之后把返回的 catalogVersion/scope 同时接入本地搜索上下文。

## 实施与验收记录（2026-08-28）

- 已新增 `POST /api/puzzles/{mode}/resolve` 的 OpenAPI 源契约、Go/TypeScript 生成物与 strict handler。服务端在一个数据库事务内恢复匹配的 random/当天 daily（包括已结束题局），或创建新题局并返回公开 `supersededSession`；旧 create-only 和 session GET 端点保持原义。
- 已新增 additive 迁移 `0023_puzzle_resolve_idempotency.sql` 与 SQLC 查询。幂等记录用主键唯一约束、请求 SHA-256 指纹和公开 session 引用绑定首次结果，不保存答案或响应 payload；并发同 key 通过插入冲突与行锁串行化，不同指纹返回 `409 IDEMPOTENCY_KEY_REUSED`。记录默认 `expires_at=infinity`，只有维护方显式设置为已过期后才允许复用。
- daily puzzle 插入改为 `ON CONFLICT DO NOTHING RETURNING`，使 resolve 事务内的并发唯一冲突可以重读权威记录而不使事务进入 aborted 状态；旧创建 API 的行为不变。迁移测试验证 `22 -> 23 -> 22 -> 23`、重复 key 的 PostgreSQL `23505` 和表内无 answer/payload 字段。
- Web 新增独立 `apps/web/src/lib/puzzleApi.ts`：网络 `TypeError` 使用相同 idempotency key 自动重试一次，只有 404/405 在当前页面生命周期内记忆为不支持并进入旧流程，其他 4xx/5xx 不 fallback。`SingleGamePage` 的 daily/random 主流程均只等待一次 resolve；daily 其他难度在主 session 可用后后台刷新，random 不再预取 `/api/catalog/full`，并用响应中的规范化 scope 修正 localStorage。无效 JSON 或不符合请求 schema 的本地 scope 不发送。
- 现有恢复计时、猜测耗时、finished 展示、统计归档、草稿保存/删除和显式重新开始语义已保留；server/component 测试覆盖 random playing/finished、四档 daily/finished、session 缺失及日期/难度/mode mismatch、superseded 处理、请求数量、后台失败和旧 API 兼容路径。
- 验证通过：
  - `pnpm lint:openapi`
  - `pnpm check:openapi-refs`
  - 连续两次 `task gen`，比较 `apps/api/internal/generated`、`apps/web/src/generated` 和 `apps/api/.openapi.bundled.yaml` 共 15 个文件的 SHA-256，结果一致
  - `go test ./internal/game ./internal/handler`
  - `go test ./internal/server -run TestPuzzleResolve -count=1`
  - `task test:go`（Go 全量，含 server 集成与迁移测试）
  - `pnpm --filter @touhouflandre/web exec vitest run src/lib/questionScopeStorage.test.ts src/lib/puzzleApi.test.ts src/components/SingleGamePage.test.tsx`（3 个文件，28 个测试）
  - `pnpm --filter @touhouflandre/web test`（59 个文件，302 个测试）
  - `pnpm --filter @touhouflandre/web typecheck`
  - `pnpm --filter @touhouflandre/web build`
  - `git diff --check`
- 部署顺序为先应用 additive 0023 迁移，再部署新 API，最后部署新 Web；旧 Web/旧端点可继续工作。binary 回滚不要求删除新表，生产环境不执行 down；`22 -> 23 -> 22 -> 23` 只在 disposable 测试数据库验证。幂等记录清理由后续维护任务负责，HSO-006 的本地搜索上下文接入继续按原计划延后。
- 实施未扩展到角色搜索 Hook、本地索引、多人搜索或批量 daily 状态 API。审查中仅补齐了无效 legacy scope 的前端结构校验，并同步既有 server 基线测试中的最新迁移尾号 23；均为本 Issue 验收所需，无其他范围偏离。
