# HSO-002：提供版本化搜索快照、服务端缓存与动态策略

**类型**：功能/服务端基础 Issue  
**优先级**：P0  
**依赖**：HSO-001  
**状态**：未开始  
**建议标签**：`type:feature` `area:api` `area:contracts` `area:web-proxy` `area:performance`

## 要解决的问题

浏览器本地搜索需要能够按冻结题库版本取得稳定数据，生产又需要一个不重新发布 Web 就能停用本地搜索的开关。当前 `/api/catalog/characters` 只返回当前版本且字段已弃用，`CatalogFull` 包含大量搜索无关配置；现有远程搜索还会绕过可复用的版本快照缓存。

## 要做到什么程度

实现相互隔离的 `CatalogSearchSourceProvider` 与 `CatalogSearchSnapshotProvider`、版本化不可变搜索快照端点和短生命周期策略端点；让现有 Go 搜索只从 source 层获取已解析角色，保持匹配、过滤、排序、分页和错误语义不变，不让索引 schema/序列化故障破坏正式回退路径。默认策略为 `remote`，因此本 Issue 单独部署不会改变用户行为。

### 新增契约

```http
GET /api/catalog/{catalogVersion}/search-index/{indexSchemaVersion}
GET /api/catalog/search-policy
```

索引 v1 条目包含当前 `CharacterSearchResult` 展示所需字段、独立 `searchTerms[]` 和 `nameSortKey`；响应声明实际 `catalogVersion` 和 `indexSchemaVersion`。策略响应包含 `mode`、`indexSchemaVersion`、`revision`、`gameScopeMode=strict|full`、`revalidateAfterSeconds=60`。

`CatalogSummary.version` 在 OpenAPI/shared 类型中为可选 additive 字段，以兼容旧 API；新 API 必须返回非空值且与 `CatalogState` 一致。所有变化均为 additive；现有 `/api/catalog/characters` 与 `/api/characters/search` 保持可用。

## 属于本 Issue

- 新增按 `catalogVersion` 缓存的 source Provider 和按 `(catalogVersion, indexSchemaVersion)` 缓存的 snapshot Provider；各自合并并发首次加载、容量 8、失败可重试。
- 从不可变 `CatalogSnapshot` 而不是当前行表生成任意仍存在版本的索引。
- 只投影 `enabledAsGuess=true` 的公开角色，使用现有 Go `CharacterSearchTerms` 和 `CharacterNameSortKey`。
- 为版本不存在、schema 不支持和题库未初始化提供稳定 404/400/503 错误；新 API 对真实缺失版本返回 `CATALOG_VERSION_NOT_FOUND`，旧 binary/路由缺失的无结构化 404 由客户端归类为 `COMPATIBILITY_ROUTE_MISSING`，两类错误响应均带 `Cache-Control: no-store`（旧 binary 无法补发该 header 时客户端也不得缓存其错误）。
- 索引返回稳定 ETag 与 `public, max-age=31536000, immutable`；策略返回 `no-store`。
- `CHARACTER_SEARCH_MODE=remote|local-primary`；缺失、空值或非法值一律为 `remote`。`CHARACTER_SEARCH_QUESTION_SCOPE_FILTER_ENABLED=true` 映射为 `gameScopeMode=strict`，`false` 映射为 `full`。增加可选 `CHARACTER_SEARCH_POLICY_REVISION`（缺省 `v1`），响应 revision 由该值、mode、scope mode 和 schema 组成；同一配置跨请求/实例稳定，结构性修复部署可显式提升。
- Next 同源代理转发新端点、状态码、ETag、Cache-Control 和远程搜索的可选 fallback reason 请求头；不能再用固定 60 秒模块缓存替代版本键。API CORS 必须显式允许该 header；跨源请求因预检拒绝时，无 header 的同一搜索仍必须成功。
- 远程搜索 handler 只使用 source Provider 的已解析角色，继续调用现有 `game.SearchCharacters`。
- 现有远程搜索接受并透传可选 `X-Character-Search-Fallback-Reason`；只将固定枚举、`none` 或 `unknown` 用作低基数观测标签，不参与业务行为。
- 增加策略 outcome、source/snapshot 加载与缓存 outcome、索引构建耗时、远程 fallback reason/错误/延迟的 Prometheus 指标和结构化日志；禁止题库版本、查询词和题局/房间/角色标识进入标签。fallback reason 只作观测，缺失/未知分别归一化为 `none`/`unknown`，不参与授权或业务响应。
- OpenAPI 源、Go/TypeScript 生成物、配置说明和 handler/provider 测试同步。

## 不属于本 Issue

- 不实现浏览器本地匹配、策略轮询、自动 fallback 或页面接入。
- 不删除或重新定义旧搜索 API、旧完整角色表接口及 Go 搜索测试。
- 不合并或重构答案判定使用的 `CatalogRuntimeProvider`。
- 不为搜索快照新增数据库表或迁移；resolve 幂等绑定的 additive 数据库迁移由 HSO-005 单独拥有。
- 不将答案、session、room、访客令牌或私有投影写入索引。

## 可能涉及的代码

- `contracts/openapi/paths/`、`contracts/openapi/schemas/` 与生成物
- `apps/api/internal/game/` 下搜索快照模型/Provider
- `apps/api/internal/handler/server.go`、配置读取和 server/provider 测试
- `apps/web/src/app/api/catalog/` 下版本化代理路由
- `apps/web/src/generated/api.ts`、`docs/deployment.md`

## 验收标准

- [ ] v1 索引对 HSO-001 fixture 中每个角色生成预期的分字段 terms 和排序键。
- [ ] 当前版本和仍被旧题局引用的历史版本均可读取；不存在版本返回稳定 404。
- [ ] source/snapshot 各自相同键的并发 20 次请求只执行一次对应加载；索引投影或序列化注入失败时远程 Go 搜索仍能使用 source 层成功返回。
- [ ] 第 9 个缓存键触发 LRU 淘汰，被淘汰版本再次请求可无损重建；失败加载不污染缓存。
- [ ] Go 远程搜索的黄金样例、错误码和结果顺序与改造前完全一致。
- [ ] 索引 ETag/immutable 头在 Go 直连和 Next 同源代理上相同，条件请求行为正确。
- [ ] 策略缺省为 remote；修改服务端配置并重启后，无需重建 Web 即可返回 local-primary 或 remote。
- [ ] 策略 revision 对相同配置及多个 API 实例稳定，对 mode/scope mode/schema 或 `CHARACTER_SEARCH_POLICY_REVISION` 变化必然改变；部署文档说明结构性修复时的提升步骤。
- [ ] 观测指标只含受控低基数标签；缺失/伪造 fallback reason 分别折叠为 `none`/`unknown`，不影响搜索响应。
- [ ] 策略响应包含与配置一致的 `gameScopeMode`；缺失/未知值不会让游戏上下文启用本地全量搜索。
- [ ] 新 API 的 `CatalogSummary.version` 必须存在且与索引响应版本、当前 CatalogState 一致；OpenAPI/shared 声明保持可选以兼容旧 API。
- [ ] 真实缺失版本返回 `CATALOG_VERSION_NOT_FOUND` 且 `Cache-Control: no-store`；route-missing 404 不伪装成题库缺失。
- [ ] CORS 允许 fallback reason header；不带该 header 的跨源远程搜索仍成功。
- [ ] OpenAPI lint、引用检查、生成和二次生成漂移检查通过。

## 测试计划

- Go 单元测试分别覆盖 source/snapshot Provider 命中、并发合并、LRU、loader 失败重试、层间故障隔离和 schema 拒绝。
- 指标测试覆盖每个固定 outcome/reason、未知值折叠和敏感/高基数字段缺失。
- Handler 集成测试覆盖当前/历史/缺失版本、公开字段、答案泄露扫描、缓存头和策略解析；同时区分 `CATALOG_VERSION_NOT_FOUND` 与兼容路由缺失，断言错误响应 `no-store`。
- 使用 `strict`/`full` 配置验证远程范围语义、策略 revision 和多实例一致性。
- API/Next 跨源测试覆盖带 header 预检、旧 API 省略 header 和无 header 重试。
- 复跑 `game.SearchCharacters` 全量测试与 HSO-001 fixture，确认远程回退语义未改变。
- Next 路由测试验证上游状态与缓存头透传，不在代理进程返回错误版本陈旧数据。
- 运行 OpenAPI lint、codegen、Go 全量测试和 Web typecheck。

## 依赖与后续

依赖 HSO-001 冻结索引 v1 和测试样例。完成后 HSO-004 可以消费策略与索引；HSO-005 在其后增加单人 resolve 契约，避免两个 Issue 同时修改同一生成物和 handler 接口面。
