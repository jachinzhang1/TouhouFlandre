# 多人扩展施工基线

本记录冻结 MPX 施工开始前的可执行基线。记录日期为 2026-08-13，基线分支起点为 `feature/multipalyer_mode_backend` 的 `f1ea798`。

## 已验证能力

- race 与 relay 均保持两名 player、seat/slot 1 和 2 的现有规则。
- 满员后的新成员以 spectator 加入；spectator 可读取房间、快照、WS 与 finished 保留态，写命令保持只读拒绝。
- race 的个人完整棋盘/对手匿名矩阵、relay 的共享棋盘、finished 终态恢复和房间级事件重放均有现有测试覆盖。
- 真实 Postgres 一次性测试库从 goose `0001` 升级到 `0008` 后完成 API、WS、race、relay 与 spectator 集成测试。

## 基线闸门

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过；shared、data、web 均无类型错误 |
| `pnpm test` | 通过；shared 10、data 26、web 84 个测试 |
| `pnpm lint:openapi` | 通过 |
| `pnpm check:openapi-refs` | 通过；35 个 YAML、34 个本地引用、无孤儿文件 |
| `pnpm check:ws-protocol` | 通过；结构、正反例与 TS 一致性均通过 |
| `cd apps/api && go test ./...` | 通过；包含真实 Postgres、REST 与 WS 集成测试 |
| `task gen` | 通过；Go/TS 生成物与当前契约、查询源一致 |

基线收口包含两个独立修正：`b531f0b` 恢复 spectator/finished/search 的真实测试预期，`e3a6e5a` 消除已有 OpenAPI、sqlc 与 Web 类型生成漂移。

## 已知限制与后续归属

- 数据库及公开 payload 仍以 slot 1/2、`score_slot1/2`、`winner_slot` 和双棋盘为中心；由 MPX-002A 改造成 memberId + seat 集合底座。
- WS 仍是 `touhouflandre-multi.v1`，hello 只携带 `lastSequence`；观察者投影可静默跳过事件，客户端也未严格验证连续 sequence。由 MPX-002B 统一修正为 v2、cursor envelope 与 `sync.complete`。
- 本步骤只验证迁移升级；Down 演练、生成物无漂移自动闸门及 v2 组合回归属于 MPX-002C。
- finished roster 中已有成员 left 时的 rematch 拒绝、claim-seat、ready/unready 和并发开局串行化属于 MPX-003，不在基线步骤提前改变。
- N 人竞速、玩家上限设置、聊天与对应 Web 体验分别由 MPX-004 至 MPX-009 实现。

后续 Issue 只有在上述基线命令保持通过、生成目录没有未解释漂移时才能继续施工。
