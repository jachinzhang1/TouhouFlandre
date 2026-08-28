# HSO-003：实现浏览器搜索内核与版本化索引仓库

**类型**：功能/Web 基础 Issue  
**优先级**：P0  
**依赖**：HSO-001  
**状态**：已完成
**建议标签**：`type:feature` `area:web` `area:architecture` `area:test` `area:performance`

## 要解决的问题

当前 Web 只有请求远程 API 的 Hook，没有可独立测试的本地匹配内核，也没有按题库/索引版本加载并验证快照的仓库。若直接把过滤逻辑写进 Hook 或各页面，会形成多套实现，难以与 Go 保持一致，也难以隔离缓存损坏和过期异步结果。

## 要做到什么程度

建立与 React 页面无关的 `CharacterSearchEngine` 和 `CatalogSearchIndexRepository`。给定已校验索引、查询、允许 ID、作品筛选、排序和分页参数，纯函数返回与 Go 相同的有序结果和 total；仓库负责按版本 URL 获取、运行时校验、内存复用和并发加载合并。

本 Issue 不接入现有 `useCharacterSearch`，因此可以和 HSO-002 并行开发并通过 HSO-001 fixture 对齐。

## 属于本 Issue

- 定义 Web feature 内部的索引模型、运行时校验器和明确的 schema 不支持错误。
- 实现与 Go 一致的查询归一化、字段内包含匹配、过滤、排序、方向、分页和稳定 tie-break。
- 实现允许 ID 的 fail-closed 过滤：游戏上下文传入空集合时结果必须为空；无游戏上下文用显式 `undefined` 表示不限范围。
- 实现按 `(catalogVersion, indexSchemaVersion)` 的内存数据缓存和 in-flight Promise 去重；失败必须清除对应 in-flight 和未完成缓存条目。
- 原始响应持久化只依赖版本化 URL 的标准 HTTP 缓存；正常 fetch 使用默认缓存语义。普通缓存响应发生坏 JSON、schema 校验失败或声明版本不符时，仓库提供每个索引键/policy revision 最多一次的 repair API：清除内存条目并以 `cache: "reload"` 强制绕过 HTTP 缓存；不增加 Dexie/IndexedDB、Service Worker、localStorage 副本或随机 cache-busting URL。
- 对版本不一致、schema 不一致、重复角色 ID、重复/空 term 和缺失展示字段返回可分类错误，供 HSO-004 决定回退。
- 使用 HSO-001 同一 fixture 建立 TypeScript 一致性测试和本地性能基线。

### 共享加载与取消所有权

同一索引键的共享 fetch 必须由 `CatalogSearchIndexRepository` 自己创建并持有 `AbortController`。调用方传入的单个 Hook/页面 `AbortSignal` 只用于取消该消费者对结果的订阅或忽略迟到结果，不得直接传给共享 fetch，也不得因为一个页面卸载而取消其他消费者正在使用的下载。只有在消费者计数归零且实现明确支持时，仓库才可取消共享请求；取消后必须清理 in-flight 条目，后续消费者可以重新加载。策略请求由 HSO-004 遵守相同的 Provider 所有权规则，页面查询请求则可以独立取消。

## 不属于本 Issue

- 不调用搜索策略端点，不决定 local/remote，不自动请求旧搜索 API。
- 不修改 `useCharacterSearch`、页面、单人或多人组件。
- 不实现具体查询结果 LRU、60 秒查询缓存或网络防抖。
- 不新增 Web Worker、模糊距离算法、拼音库或第三方搜索依赖。
- 不修改 Go 搜索、OpenAPI 源或题局加载。

## 可能涉及的代码

- `apps/web/src/features/character-search/engine.ts`
- `apps/web/src/features/character-search/indexRepository.ts`
- `apps/web/src/features/character-search/schema.ts`
- 同目录单元/性能测试
- `docs/hybrid-search-optimization/fixtures/search-parity-v1.json`

最终文件名可按现有 Web feature 约定小幅调整，但纯内核、索引加载和 React 路由不得重新混在一个文件中。

## 验收标准

- [ ] HSO-001 所有黄金样例在 TypeScript 中返回与 Go 完全相同的有序 ID 和 total。
- [ ] 查询不会跨两个 searchTerms 拼接命中，NFKC 和所有删除字符行为与 Go 一致。
- [ ] 过滤先于分页；空允许集合为零结果；无允许集合只用于非游戏目录。
- [ ] 相同版本并发加载只调用一次 fetch；失败后缓存 Promise 被清理且下一次可重试。
- [ ] 一个消费者卸载不会取消仍有其他消费者的共享下载；最后消费者离开时若取消共享请求，in-flight 条目可清理并允许后续消费者重新加载。
- [ ] 普通缓存内容损坏时同键只执行一次 `cache: "reload"` 修复；成功返回已校验实例，修复响应仍坏或网络失败时返回可分类结构性错误且不循环下载。
- [ ] 版本/schema/重复 ID/坏字段均在进入搜索前失败，不返回部分结果。
- [ ] 切换版本不会复用旧索引；同版本重复获取返回同一已解析实例。
- [ ] 固定生产规模 fixture 下同步搜索 P95 小于 16ms，测试记录运行环境且无主线程长任务。
- [ ] 不新增运行时依赖和浏览器持久化 schema。

## 测试计划

- Vitest 表驱动测试读取共享 fixture，覆盖归一化、term 边界、过滤组合、排序和分页。
- 仓库测试 mock fetch，覆盖成功、并发、消费者 subscribe/unsubscribe、一个消费者取消而另一个继续、最后消费者离开、HTTP 错误、坏 JSON、版本不符、未知 schema、内存条目清理、强制 reload 修复成功/失败和同键修复去重。
- 生成至少 8 倍当前条目数的非生产测试数据做性能与稳定排序测试，避免只对极小 fixture 得出结论。
- 运行 Web typecheck、全量 Vitest；不需要启动 API 或修改数据库。

## 依赖与后续

依赖 HSO-001 的 fixture 和冻结语义。HSO-004 负责把本内核与 HSO-002 的真实端点、动态策略、远程请求和 React 生命周期组合起来。

## 实施与验收记录（2026-08-28）

- 已交付独立的 `schema.ts`、`engine.ts` 与 `indexRepository.ts`：索引运行时校验、Go 一致的查询归一化/字段边界匹配/过滤/排序/分页，以及按 `(catalogVersion, indexSchemaVersion)` 的内存实例与共享加载。
- 索引仓库使用自身 `AbortController` 管理共享 fetch；消费者取消只终止自身订阅。失败 in-flight 会清理并允许重试；普通缓存内容损坏、schema/版本校验失败时，同一 policy revision 只执行一次 `cache: "reload"` repair，修复失败不会循环下载。
- 新增 `engine.test.ts`、`schema.test.ts`、`indexRepository.test.ts`。测试直接读取 HSO-001 `search-parity-v1.json` 的全部黄金样例，并覆盖空允许集合、term 边界、重复 ID/坏字段、并发去重、消费者取消、repair 成功/失败和版本隔离；固定规模 8 倍 fixture 的同步搜索 P95 断言小于 16ms。
- 验证通过：
  - `pnpm --filter @touhouflandre/web exec vitest run src/fixtures/hso-001-fixtures.test.ts`
  - `pnpm --filter @touhouflandre/web typecheck`
  - `pnpm --filter @touhouflandre/web test`（56 个文件，279 个测试）
  - `pnpm --filter @touhouflandre/web build`
  - `pnpm --filter @touhouflandre/web exec vitest run src/features/character-search`
- 未修改 `useCharacterSearch`、页面、OpenAPI/生成物、Go 搜索、数据库或浏览器持久化 schema；HSO-004 继续负责路由与回退接入。未引入新的运行时依赖。
