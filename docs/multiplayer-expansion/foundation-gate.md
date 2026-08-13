# MPX-003 共享底座进入闸门

本记录冻结 MPX-002A member/seat 数据底座与 MPX-002B WebSocket v2 游戏同步协议合并后的共同回归结果。记录日期为 2026-08-13；MPX-003 必须从 MPX-002C 合回 `feature/multipalyer_mode_backend` 后的 `mpx-003-base` 基线开始。

## 必须通过的命令

进入 MPX-003 前，在仓库根目录依次执行：

```bash
pnpm typecheck
pnpm test
pnpm lint:openapi
pnpm check:openapi-refs
pnpm check:ws-protocol
task check:generated
(cd apps/api && go test ./...)
```

`task check:generated` 会执行完整 `task gen`，随后同时检查 `apps/api/internal/generated` 与 `apps/web/src/generated`。命令结束后 `git status --short` 必须为空；不能把手改生成文件、未提交的再生成结果或未解释漂移带入 MPX-003。

## 本次实测结果

| 范围 | 结果 |
|---|---|
| TypeScript | shared、data、web 类型检查通过 |
| 单元测试 | shared 10、data 26、web 87 个测试通过 |
| OpenAPI | lint 通过；35 个 YAML、34 个本地引用、无孤儿文件 |
| WS 契约 | 结构、正反例及 TypeScript 类型一致性检查通过 |
| 生成物 | OpenAPI Go、sqlc Go 与 Web API 类型重新生成后零漂移 |
| Go / Postgres | `go test ./...` 通过，包含真实 Postgres、REST、WS 与迁移集成测试 |

关键组合回归包括：

- 一次性 Postgres 数据库完成 `0008 → 0009 → 0008 → 0009`，旧房间、两名 player、spectator、seat/slot 和默认 `player_limit=2` 均可验证恢复。
- 两人 race 与 relay 在 `touhouflandre-multi.v2` 下连续完成到 `match.ended`；观察者逐 sequence 收到业务事件或 `room.cursor`。
- spectator 写命令稳定返回 `SPECTATOR_READ_ONLY`，但可获得授权后的完整棋盘、finished 快照和 retention 关闭事件。
- 断线重连、同步屏障、非法水位、snapshot 对齐、cursor 去重及 `sync.complete` 完成水位均有自动测试。
- Web 序列协调器只把业务事件交给 reducer；cursor 仅推进水位，真实缺口只触发一次 snapshot，完成同步前不提交重放水位。

## 生产回滚边界

迁移 Down 只允许在一次性测试数据库演练。生产应用回滚继续保留 0009 的 expand schema 与已有数据，不通过 Down 删除 `player_limit` 或把 `seat` 强制退回旧双人结构。后续一旦出现 seat 大于 2 的数据，更不能把 0009 Down 当作生产恢复方案。

## 已知限制与后续归属

- 当前 join、ready、房主关闭与 rematch 生命周期仍以既有双人规则为主；最小可用 seat、claim-seat、unready、spectatorCap 和 final-ready 并发串行化由 MPX-003 实现。
- `multi_match` 的比分与胜者存储仍保留 `score_slot1/2`、`winner_slot` 兼容底座；N 人 roster、计分、离场与和局语义由 MPX-004 实现，MPX-003 不应提前改写。
- relay 固定两名 player；race 虽已允许 `playerLimit` 取 2—8，但房间生命周期尚未开放 N 人入座，由 MPX-003/005 分阶段接入。
- WS v2 当前只有游戏 `lastGameSequence`；独立聊天 cursor、授权历史与实时缓冲属于 MPX-007/008。
- v1 子协议会被 v2 服务端拒绝；旧页面刷新提示、房间排空和发布切换演练属于 MPX-010。
- 当前闸门以 Go 真实 Postgres 集成测试和 Web 单元测试为主；完整多人浏览器 e2e、移动端和发布环境演练由后续功能任务与 MPX-010 收口。

发现 member/seat 或 v2 sequence 的基础语义错误时，应分别回到 MPX-002A 或 MPX-002B 修正；MPX-003 只接入房间生命周期，不以本地兼容分支绕过底座契约。
