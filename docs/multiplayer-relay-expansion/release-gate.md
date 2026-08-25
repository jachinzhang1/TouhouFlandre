# MRX-013 发布闸门清单

本文只记录发布验证，不是重新设计规则的入口。发现计分、配对、权限或协议语义冲突时，回到拥有该决策的 MRX Issue 修正。

## 发布状态模板

| 项目                  | 状态   | 记录                                                                                                   |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| MRX-001 基线          | 已记录 | 2026-08-23；E2E 34/34                                                                                  |
| 模块边界/装配检查     | 已验证 | 2026-08-25；full/race-only/relay-only/fake-mode 与静态边界检查通过，race-only SQL tracer 无 relay 查询 |
| expand migration 演练 | 已验证 | 一次性 PostgreSQL；0014 -> 0019 `135.349ms`，回退应用版本后重放 `76.301ms`，旧行与 v3 数据均保留       |
| WS v2 排空 / v3 切换  | 已演练 | v2 明确收到 refresh_required；v3 sequence/cursor/replay/sync.complete 自动化通过；未操作生产房间       |
| 自动化矩阵            | 已验证 | 合同、TS/Go、Web 184、浏览器 `73 passed / 1 expected skip`；逐项证据见 test-matrix                     |
| 并发/负载             | 已验证 | 8+32 fan-out、20 action `p95/p99=99.824ms`；100-stage history `p95=19.184ms`；deadlock/重复结算为 0    |
| 安全审计              | 已验证 | 跨 room/encounter、答案、日志/metrics、限流、XSS、WS 门禁通过；P0/P1=0                                 |
| 可访问性/视觉         | 已验证 | desktop/Pixel 7 的 2/4/6/8 lobby/stage baseline、axe、键盘、200% zoom、reduced-motion 通过             |
| 灰度/回滚             | 已演练 | 多人 relay 固定积分和淘汰赛 API/Web 入口默认开启；grandfather 自动化通过；生产执行人/提交/时间窗待实际发布流程填写 |
| 稳定文档/公告         | 已完成 | 稳定玩法、架构、部署、配置、监控和 `2026-08-25-multiplayer-relay-preview.md` 已同步                    |

## 灰度开关

多人 relay 固定积分和淘汰赛入口默认开启；服务端永远是最终授权边界，Web flag 只控制入口。发生灰度暂停时，可分别关闭对应 API/Web flag。

| 环境变量                                      | 初始默认 | 作用                                              |
| --------------------------------------------- | -------: | ------------------------------------------------- |
| `MULTI_N_PLAYER_RELAY_ENABLED`                |  `true`  | 是否允许新建/调高 `playerLimit > 2` 的 relay 房间 |
| `NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED`    | `true`  | 是否显示 relay 多人上限和对应状态 UI              |
| `MULTI_RELAY_ELIMINATION_ENABLED`             |  `true`  | 是否允许新建/修改为多人 relay 淘汰配置            |
| `NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED` |  `true`  | 是否显示并启用淘汰 switch                         |

关闭 flag 只阻止新的配置暴露：已经进入 lobby 且保存了多人设置的房间、已经 playing 的 match 和 finished/rematch 恢复必须由能解释其 `RuleSetRef` 的当前 binary 安全完成，不能中途改变规则集。紧急应用回滚到不理解 WS v3 的旧 binary 前，必须先阻止新建并排空/关闭 v3 房间。

## 自动化闸门

在 WSL 仓库根目录记录以下命令的退出码和测试数量：

```bash
pnpm lint:openapi
pnpm check:openapi-refs
pnpm check:ws-protocol
pnpm check:multiplayer-boundaries
pnpm typecheck
pnpm test
task test:go
task gen
pnpm --filter @touhouflandre/web build
```

`task check:generated` 内部会调用 Git；本工作区不得在 WSL 执行 Git。因此生成后在 Windows PowerShell 使用 Windows Git 检查漂移：

```powershell
git -C '\\wsl.localhost\Ubuntu\home\jachin\src\TouhouFriberg' diff --exit-code -- apps/api/internal/generated apps/web/src/generated
```

真实数据库和浏览器环境：

```bash
task db:up
task db:migrate
task db:seed:go
MULTI_N_PLAYER_RELAY_ENABLED=true \
MULTI_RELAY_ELIMINATION_ENABLED=true \
NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED=true \
NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED=true \
pnpm --filter @touhouflandre/web test:e2e e2e/multiplayer.spec.ts
```

必须逐项对照[测试矩阵](./test-matrix.md)；不能仅以 workspace 总命令成功替代 Required case 覆盖。

## 迁移演练

1. 从已经执行 `0014`、包含 race wins/points/placement、双人 relay、finished history、stats v5 对应服务数据和 chat 的旧版本数据库副本开始，记录 migration version 和行数摘要。
2. 备份或创建一次性演练库，从 `0015` 执行 `task db:migrate`，检查约束、索引和 sqlc query。
3. 使用新 binary 读取旧 snapshot/history，完成一场旧语义的双人 race/relay。
4. 创建 4/6/8 人新 relay，至少各完成一个 stage，检查 relay stage/encounter/member/turn/settlement/event 行，并确认 race-only 查询不访问这些表。
5. 仅在一次性测试库验证 Down 的声明行为；生产应用回滚保留 expand schema 和 v3 数据，不执行破坏性删除。
6. 回滚到前一 binary 的演练只要求旧玩法可服务；v3 房间必须已排空，不能让旧 binary 猜测新表状态。
7. 重新部署新 binary，确认 expand migration 幂等且已结束 v3 match/history 可读。

## WS v3 切换

1. 先发布能识别 v3 flag 但保持关闭的 API/Web，确认当前 v2 的双人流程和 race points/placement 正常。
2. 停止新建 v2 房间，等待 lobby/playing/finished retention 排空；记录剩余房间数。
3. 对维护窗内仍未结束的房间使用既有明确关闭事件，不直接删除数据库行。
4. 发布 v3 Web/API，确认 v2 页面握手得到刷新提示而不是表面连接成功。
5. 验证 v3 的 game sequence、chat cursor、replay buffer 和 `sync.complete`；在 complete 前断线后能重新同步。
6. 小比例开启多人 relay，观察至少一个完整 retention 周期后再扩大。

## 并发与负载

在 8 player + 32 spectator 的单房间和多房间组合下记录：

- 4 个 encounter 同时 guess/pass/timeout/forfeit；
- 最后两个 encounter 同时完成并争夺 stage settlement；
- join/claim-seat/settings/final-ready 并发；
- 玩家离场、grace sweeper、turn timeout 和正确猜测竞争；
- 100 stage history fixture 的 snapshot、history first page 和随机旧 stage detail；
- WS 慢消费者、队列满、重连风暴和 history 请求限流。
- full registry 与 race-only registry 的启动、snapshot、recovery 和查询基线。

建议初始门槛，正式值按现有生产基线校准：

- stage 重复结算、重复积分、重复淘汰、事件 sequence 冲突和数据库死锁必须为 0；
- ordinary turn 的 p95 不得因其他 encounter 活动呈线性增长；
- API/WS 非预期错误率持续 10 分钟不得高于 1%；
- snapshot 与单增量事件必须有记录的字节上限，100 stage fixture 不得把完整历史塞入 snapshot；
- history p95 超过 1500ms 或锁等待显著增长时保持 flag 关闭并优化。

## 安全审计

- [x] guess/pass/forfeit 每次重新校验 token、room、match、stage、encounter membership 和 turn capability。
- [x] 伪造其他 encounterId、其他 roomId、旧 stageIndex、淘汰/bye/spectator 身份均稳定拒绝。
- [x] 进行中 answer 不出现在 REST、WS、snapshot、history、cursor、错误、结构化日志、metrics label 或前端 DOM。
- [x] terminal answer 只属于对应 encounter；同 stage 其他进行中 answer 仍隐藏。
- [x] relay 完整标签可见是显式 allow policy；race 匿名矩阵没有因共享 projector 回归。
- [x] core 不解析 mode payload；race projector 不查询 relay 表，relay projector 不 import race 匿名矩阵实现。
- [x] 未知/缺失 `RuleSetRef` 明确拒绝，不能回退到 `wins`、`points` 或当前 relay 默认策略。
- [x] guest token/token hash、昵称和内部 ID 不进入本地统计导出；日志不记录 token 或未揭示答案。
- [x] chat 仍按 player/spectator channel 授权，role/capability 变化不会越权回放。
- [x] Web 对昵称、历史标签和 chat 继续按纯文本渲染，XSS payload 不注入 DOM。
- [x] WS Origin、subprotocol、hello 鉴权、read limit、send queue 和限流有效。

任何 P0/P1 越权、答案泄漏或结算重复都阻止发布；不能以低发生概率接受。

## Web 与可访问性

- [x] 2/4/6/8 人大厅、relay fixed_points/elimination、bye、near-death、eliminated、finished 在 desktop/Pixel 7 有视觉基线。
- [x] 当前和历史任何时刻最多一张棋盘表格挂载，翻页/加载不会改变布局尺寸或把输入移到错误棋盘。
- [x] 对阵标题、积分、长昵称、页码、状态提示不重叠、不截断关键数值、无页面横向溢出。
- [x] paginator icon 有 tooltip/accessible name；switch、range、菜单、历史按钮可用键盘操作。
- [x] 状态变化使用适当 live region，不依赖颜色单独表达 near-death/淘汰/轮空。
- [x] encounter 结束不弹阻塞模态；用户可继续翻页、看历史和聊天。
- [x] prefers-reduced-motion、200% zoom 和窄屏下功能完整。

## 灰度观察与回滚

至少按 `mode + ruleSetKey + ruleSetVersion` 观察；race 可额外保留兼容 `scoringMode` 标签。记录房间/成员/active encounter 数、stage/encounter duration、barrier wait、turn timeout、pool-too-small、settlement retry、deadlock、guess latency、WS reconnect/queue drop、snapshot bytes、history latency。

回滚顺序：

1. 关闭两个 Web flag，重新发布 Web，停止新入口。
2. 关闭两个 API flag，拒绝新配置；当前 binary 按冻结 `RuleSetRef` 继续完成已有 v3 房间。
3. 观察 active v3 rooms 归零或在维护窗发送明确 close 事件。
4. 如需回滚应用 binary，确认 v3 房间归零后部署旧版本；保留 expand schema。
5. 公告同步标记暂停，记录触发指标、影响范围和恢复条件。

以下任一情况立即停止扩大灰度：答案/权限 P0/P1、重复计分/淘汰、数据库死锁、v3 重连不可恢复、API/WS 错误率越线、旧 race/relay 回归。

## 文档与发布完成

- [x] 更新 `docs/multiplayer.md` 的稳定规则、REST/WS、配置、可见性和测试重点。
- [x] 更新 `docs/gameplay.md` 的公开玩法说明。
- [x] 更新 `docs/architecture.md` 的 capability registry、core/mode 边界、relay stage/encounter 和历史数据流。
- [x] 记录最终 core/race/relay 包依赖图、registry 装配点和 legacy adapter 清理条件。
- [x] 更新 `.env.example`、部署文档与监控说明。
- [x] 用户公告明确 2 人旧赛制、两种多人赛制、完整棋盘可见性和灰度状态。
- [x] 在本文件记录最终默认 flag、发布提交、执行人、时间和回滚演练结果。

## 2026-08-25 非生产发布记录

- 环境：WSL Ubuntu 工作树；真实 PostgreSQL 一次性副本；隔离 API `127.0.0.1:14010` 与 Web `127.0.0.1:5174`；未触碰用户 `:4000` 服务。
- 默认开关：`MULTI_N_PLAYER_RELAY_ENABLED=true`、`MULTI_RELAY_ELIMINATION_ENABLED=true`、`NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED=true`、`NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED=true`；registry 默认 `full`。
- 自动化命令：本文件“自动化闸门”全部命令通过；浏览器在复用隔离服务并限制 `--workers=2` 时为 `73 passed / 1 expected skip`。
- 回滚演练：API flag 关闭拒绝新多人配置但允许既有 match snapshot/action；migration version 回到 14 不删除 expand schema/v3 数据，重新部署新 binary 后旧、新数据均可读。
- 发布提交/执行人/时间窗：未创建提交，未执行生产部署；实际生产发布必须填写 commit、负责人、开始/结束时间及一个完整 retention 周期观察结果。
