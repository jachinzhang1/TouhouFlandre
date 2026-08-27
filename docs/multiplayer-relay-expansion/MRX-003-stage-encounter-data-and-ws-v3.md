# MRX-003：建立 relay-owned stage/encounter 数据与 WS v3 契约

**类型**：架构/数据/契约 Issue  
**优先级**：P0  
**依赖**：MRX-002  
**状态**：已完成
**建议标签**：`type:feature` `area:db` `area:api` `area:contracts` `area:websocket`

**决策依据**：[持久化模型](./decisions.md#13-持久化模型)、[契约与 WS v3](./decisions.md#15-契约与-ws-v3)、[事务与锁序](./decisions.md#14-事务与锁序)、[多人模式模块边界](./architecture.md)

## 要解决的问题

当前一条 `multi_round` 同时承担单局、答案和双人接力当前手，无法表达一个同步结算边界内的 2..4 张独立棋盘。直接把它改成通用 stage 又会迫使 race 接受可空答案、接力 turn 和新锁序。需要建立 relay-owned 数据模型，并在共享信封之上增加不绑定具体 relay 计分规则的 v3 payload。

## 要做到什么程度

- 从迁移 `0015` 开始新增 `multi_relay_stage`、`multi_relay_encounter`、`multi_relay_encounter_member`、`multi_relay_turn`、relay match player state 与 stage settlement 表；不新增无第二消费者的 `multi_stage_unit`。
- 保留现有 `multi_round`、`multi_turn` 及其约束供 race 与 legacy relay adapter 使用；新 relay 答案和 turn 只存在 relay-owned 表。
- `multi_match` expand `rule_set_key/rule_set_version` 和冻结配置快照；按 `(room.mode,key,version)` 解析。现有 `scoring_mode` 保留供 race v2/旧数据/stats v5 兼容，不单独调度新玩法。
- 旧数据按确定映射回填：race `wins|points|placement` 保持同 key/version 1，旧 relay 回填 `legacy_wins` version 1；未知或矛盾数据阻止迁移。
- relay 专属 player state 保存有符号 score、`healthy/near_death`、淘汰 stage；不放宽 race score 约束，不扩张 race round/player status 枚举。
- v3 relay fragment 定义允许负分的 `RelayStandingView`；现有 race `MemberScoreView.score >= 0` 和 stats v5 形状保持不变。
- 定义带 `stageId/stageIndex/encounterId/memberId` 的 OpenAPI 与 WS v3 typed union；数组按 encounter index、side/seat 稳定排序。
- v3 从当前含 race `raceEliminationEnabled`、`points/placement` 的 v2 扩展，并沿用游戏 sequence、cursor、snapshot 缺口修复、`sync.complete` 和 chat cursor，不重新设计已验证的同步屏障。
- v3 使用 `ruleSetRef` 和 namespaced `relay.stage.*`/`relay.encounter.*`；race payload 和匿名矩阵保持现状。
- 增加 relay encounter action 和 history 的契约骨架；handler 可先返回 feature-disabled，不提前实现玩法。
- 数据库迁移可在包含旧 race/relay 数据的副本上执行，旧列保留供应用回滚。

## 属于本 Issue

- `0015+` goose migration、sqlc query 源及生成物。
- OpenAPI schemas/paths、WS protocol 源、Go/TS 手写协议类型和一致性检查。
- v2 -> v3 握手拒绝/刷新提示所需的服务端控制帧契约。
- 数据约束、索引、迁移回归、序列化 round-trip 与 contract tests。
- relay repository/domain 映射与 legacy storage adapter，不含真实配对和计分。

## 不属于本 Issue

- 不生成随机配对、答案或 turn。
- 不开放 relay 多人房间创建。
- 不实现积分、濒死、轮空选择、Web 棋盘或历史加载体验。
- 不删除或放宽 `multi_round.answer_id/turn_slot`、`multi_turn.round_id`、旧 winner/score/scoring_mode 列。
- 不让 race repository 查询 relay stage/encounter，也不让共享 core 解释 relay 表。
- 不长期维护 v2/v3 双协议；排空和切换由 MRX-013 执行。

## 验收标准

- migration `0015+` Up 后旧 race 与双人 relay 数据仍可由旧 adapter 读取；一次性测试库可验证迁移过程，生产回滚不依赖删除新表。
- backfill 行数与 mode/scoring_mode 分组完全对应，重复执行验证不改变既有 RuleSetRef；构造的未知旧值会让迁移明确失败。
- 数据库约束保证一个 encounter 属于一个 relay stage、恰有两名不同 roster player、同一 stage 玩家最多加入一个 encounter；near-death 与 active/eliminated/left 是正交维度。
- 同一 stage 的不同 encounter 可以提交同一 `guess_id`，同一 encounter 内仍禁止重复角色和幂等冲突。
- v3 schema 能表达 `RuleSetRef`、1..4 个 encounter、bye、stage settlement 和紧凑历史摘要；进行中结构没有 answer 字段。
- relay 淘汰后的负分可以 round-trip，race schema 仍拒绝负分；两种 standings 不通过宽松 union 混为一体。
- v3 客户端仍能严格检查 game sequence，投影跳过使用 cursor，不因 encounter 并发产生假缺口。
- race-only registry 不查询 relay 新表，race v2 fixture 归一化到 v3 后语义不变；未知 relay rule set version 明确拒绝。
- OpenAPI lint/ref、代码生成、WS protocol 检查、migration/sqlc 测试通过且工作树无生成物漂移。

## 可能涉及的代码

`apps/api/migrations/0015_*.sql` 及后续、`apps/api/sql/queries/multi.sql`、`apps/api/internal/generated/`、relay storage/domain adapter、`contracts/openapi/{paths,schemas}/`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts`、`apps/web/src/generated/api.ts`。

## 实施与验收记录（2026-08-23）

本 Issue 已交付 relay-owned stage/encounter 持久化底座、冻结 RuleSetRef、OpenAPI/WS v3 契约与 feature-disabled 路由骨架。实现没有开放多人 relay 创建，没有生成配对、答案或 turn，也没有实现计分、淘汰、历史读取和多棋盘 Web；这些行为仍由 MRX-004 及后续 Issue 负责。

主要交付如下：

- `0015_relay_stage_encounter_ws_v3.sql` expand `multi_match.rule_set_key/rule_set_version/rule_config_snapshot`，按旧 `mode/scoring_mode` 确定性回填 race `wins|points|placement@1` 与 relay `legacy_wins@1`，未知或矛盾数据明确拒绝。迁移新增 relay stage、encounter、两人成员、turn、relay match player state 与 stage settlement 表、约束和索引；race score 非负约束及旧 round/turn/score/scoring 列保持不变。
- encounter 使用 deferred constraint trigger 保证提交时恰有两名不同 roster player，同一 stage 玩家最多属于一个 encounter；`guess_id` 与幂等约束限定在 encounter 范围。迁移 Down 为 expand-only no-op，并用 legacy INSERT 兼容触发器保证上一 binary 回滚后仍能创建旧 race/relay match。
- relay SQL 源与 sqlc 生成物独立于 race/shared 查询。运行时所有 handler、snapshot、Hub、forfeit、restart 和 sweeper 入口统一按持久化 RuleSetRef 调度；只对三个新字段全空的迁移前数据走 legacy adapter。`relay/fixed_points@1` 与 `relay/elimination@1` 已登记但所有 capability 均返回 `FEATURE_DISABLED`，未知 version fail closed。
- OpenAPI 增加 RuleSetRef、允许负分的 relay standings、stage/encounter/settlement、终态 answer/history 与 action/history 路径骨架；两个新 handler 固定返回 `501 FEATURE_DISABLED` 且不写状态。WS 子协议升级为 `touhouflandre-multi.v3`，保留 sequence/cursor/chat cursor/`sync.complete`，新增七个 namespaced relay typed events；进行中结构不含 answer，终态 encounter 必须携带 answer。v2 客户端收到 `protocol.refresh_required` 和所需 v3 子协议，持久化 v2 `match.started` 事件可确定性归一化到 v3 RuleSetRef。
- Go/TypeScript 手写类型、OpenAPI/sqlc/Web 生成物和 Web reducer 已同步。race v2 fixture 除新增 RuleSetRef 外语义保持不变，Web 仅切换 v3 子协议并保存服务端规则集引用，没有增加 relay 玩法界面。

WSL 实测结果：

- `pnpm check:multiplayer-boundaries`、`pnpm check:ws-protocol`、`pnpm lint:openapi`、`pnpm check:openapi-refs`、`pnpm typecheck` 与 `go vet ./...` 全部通过；OpenAPI 检查为 41 个 YAML、40 个本地引用、无孤儿文件。
- `pnpm test` 通过：shared 10、data 26、Web 152，共 188 项。`task test:go` 全部通过，其中 server 集成套件 44.641s、migration 套件 21.586s；最终聚焦 `go test ./migrations -run MRX003 -count=1` 与 server MRX-001/MRX-003 回归再次通过。
- `task gen:openapi`、`go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate`、`task gen:web` 全部通过，二次运行前后生成物 SHA-256 一致。`pnpm --filter @touhouflandre/web build` 通过。

迁移可直接作用于包含旧 race/relay 数据的数据库；应用回滚保留全部旧表和旧列，新表不要求删除，上一 binary 的旧式 match INSERT 由兼容触发器确定性补齐新字段。偏离原计划的收尾仅是审计时补强了该旧 binary 写兼容、终态 answer/outcome 一致性检查与 v2 事件归一化；没有扩张到后续玩法。MRX-004+ 继续负责容量与开局策略、配对、encounter 引擎、计分淘汰、恢复/history projector 和多棋盘 Web。
