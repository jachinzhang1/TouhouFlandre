# 多人接力扩展测试矩阵

本文是 MRX-001 的基线清单和 MRX-013 的发布覆盖表。`Required` 项不得仅靠人工试玩；每项至少落在纯规则、数据库/handler 集成、协议 reducer、组件或真实浏览器中的一层，并按风险叠加覆盖。

## 测试层级

| 层级            | 目的                                      | 典型位置                                                 |
| --------------- | ----------------------------------------- | -------------------------------------------------------- |
| D：domain       | 纯函数、确定性随机、计分与状态转换        | `apps/api/internal/multi/**/*_test.go`                   |
| DB：transaction | 约束、锁序、并发、幂等、迁移与恢复        | `apps/api/internal/server/**/*_test.go`、migration tests |
| C：contract     | OpenAPI/WS 源、Go/TS 类型、投影形状       | contract scripts、serialization tests                    |
| R：reducer      | 乱序/重复/缺口、snapshot/replay、分页缓存 | `apps/web/src/hooks/useRoom*.test.*`、domain tests       |
| UI：component   | capability、单棋盘 DOM、状态与可访问性    | React Testing Library                                    |
| E2E：browser    | 真实 API/WS/Postgres 与桌面/移动流程      | `apps/web/e2e/multiplayer.spec.ts`                       |

## 模块边界与可拆卸性

| ID   | Required case                                                    | 层级      | Owner       |
| ---- | ---------------------------------------------------------------- | --------- | ----------- |
| A-01 | core 不 import race/relay，race 与 relay 互不 import             | static    | MRX-002/013 |
| A-02 | race-only registry 可完成 create/play/snapshot/recover/stats     | D/DB/C    | MRX-002/013 |
| A-03 | relay fake module 可注册所需 capability，且不构造 `RaceRules`    | D         | MRX-002     |
| A-04 | 未注册 mode/未知 RuleSetRef 明确拒绝，不回退默认规则             | D/DB/C    | MRX-002/003 |
| A-05 | race repository/projector 不查询 relay-owned 表                  | DB/static | MRX-003/011 |
| A-06 | relay flag 关闭或 Web module 移除后 race 与 stats v1-v5 仍可运行 | R/UI/E2E  | MRX-010/013 |
| A-07 | fake 新模式只修改组合根，不修改 race/relay/core 规则实现         | D/static  | MRX-002/013 |

### MRX-002 装配输入

MRX-001 只冻结下列预期，不实现 registry 或新增 wire error。MRX-002 的装配测试和 `check:multiplayer-boundaries` 必须逐项证明：

| 装配形态      | 注册内容                                                                | 必须成功                                                                                 | 必须拒绝/隔离                                                                                                  |
| ------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| race-only     | `race/wins@1`、`race/points@1`、`race/placement@1` 及 race capabilities | race create/play/snapshot/history/recovery、stats v1-v5；不构造 relay repository         | 新 relay 请求按未注册 mode 拒绝；core 不 import relay；已持久化 relay 不得被猜测为 race                        |
| legacy-relay  | race 全集 + `relay/legacy_wins@1`，不注册 stage/encounter 能力          | 当前双人 race、N 人 race 和双人 relay guess/pass/timeout/forfeit/snapshot/recovery       | relay `playerLimit > 2`、`fixed_points`、`elimination` 拒绝；不查询或创建 relay stage/encounter 表             |
| full registry | race 全集 + relay `legacy_wins@1`、`fixed_points@1`、`elimination@1`    | 根据完整 `RuleSetRef` 选择所属模块；关闭新建 flag 后仍可读取、恢复和完成已持久化规则版本 | 未知 mode/key/version、缺失 `RuleSetRef`、缺失 capability 均 fail closed；绝不回退 wins/points/legacy 默认规则 |

未注册模式的稳定语义冻结如下：用户输入引用未注册 mode 时沿用当前 v2 `HTTP 400 + INVALID_REQUEST`，不得写 room/match/event；持久化 room/match 引用当前 binary 未注册的 mode 或未知/缺失 `RuleSetRef` 时视为不可解释的服务配置/数据错误，当前 v2 transport 返回 `HTTP 500 + INTERNAL`，事务不写状态或事件，recovery 不猜测推进。feature flag 关闭是“禁止新建”而不是“模式未注册”：已存在且可解释的 match 必须继续完成。MRX-002 可在领域层增加 typed error，但不得在没有独立契约 Issue 时改变这些 v2 transport 结果。

## 现有功能回归

| ID   | Required case                                                | 层级     | Owner           |
| ---- | ------------------------------------------------------------ | -------- | --------------- |
| B-01 | race N=2 的 BO、并发正确猜测、forfeit、timeout               | D/DB/E2E | MRX-001/002/013 |
| B-02 | race N=3/4/8 points/placement、淘汰开关、finish rank 和排名  | D/DB/E2E | MRX-001/002/013 |
| B-03 | relay N=2 的 BO1/3/5/7、交替先手、guess/pass/timeout/forfeit | D/DB/E2E | MRX-001/006/013 |
| B-04 | player/spectator/淘汰者的权限与 race 匿名矩阵                | DB/C/E2E | MRX-001/002/013 |
| B-05 | game sequence、cursor、snapshot 缺口和 `sync.complete`       | DB/R/E2E | MRX-001/011/013 |
| B-06 | player/spectator chat channel、闭麦、history/replay          | DB/R/E2E | MRX-001/013     |
| B-07 | join/claim-seat/ready/settings/rematch/leave 并发            | DB       | MRX-001/004/009 |
| B-08 | stats v1-v5 导入、匿名导出及 race scoringMode 兼容语义       | R/UI     | MRX-001/012     |

### MRX-001 基线证据

| ID   | 已冻结的测试文件                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-01 | `apps/api/internal/multi/{match,race_scoring}_test.go`；`apps/api/internal/server/{match,n_player_race,n_player_terminal}_test.go`；`apps/web/e2e/multiplayer.spec.ts`                                        |
| B-02 | `apps/api/internal/multi/{match,race_scoring}_test.go`；`apps/api/internal/server/{n_player_race,n_player_terminal,player_limit_settings}_test.go`；`apps/web/src/domain/memberCollections.test.ts`；多人 E2E |
| B-03 | `apps/api/internal/server/{mrx001_baseline,match,ws}_test.go`；`apps/api/internal/multi/match_test.go`；多人 E2E                                                                                              |
| B-04 | `apps/api/internal/server/{n_player_race,n_player_terminal,ws,room_lifecycle}_test.go`；`apps/web/src/components/{OpponentBoard,MemberPaginator}.test.tsx`；多人 E2E                                          |
| B-05 | `apps/api/internal/server/ws_test.go`；`apps/web/src/{hooks/useRoom.websocket.test.tsx,domain/gameSequence.test.ts}`；多人 E2E                                                                                |
| B-06 | `apps/api/internal/server/chat_test.go`；`apps/web/src/{components/ChatDock.test.tsx,domain/multiChat.test.ts,hooks/useRoom.test.ts}`；多人 E2E                                                               |
| B-07 | `apps/api/internal/server/{room_lifecycle,player_limit_settings,match,multi}_test.go`                                                                                                                         |
| B-08 | `apps/web/src/stats/{transfer,db,aggregate}.test.ts`；其中 `transfer.test.ts` 表驱动覆盖 v1-v5、匿名归一化和 v5 导出                                                                                          |

三份跨层 fixture 位于 `docs/multiplayer-relay-expansion/fixtures/`，由 `apps/api/internal/server/mrx001_baseline_test.go` 对真实 API、WS v2 payload key 和迁移 `0014` 数据库列顺序做归一化比对。E2E 失败归因和命令结果记录在 [MRX-001 实施与验收记录](./MRX-001-contract-and-regression-baseline.md#实施与验收记录2026-08-23)；当前 desktop/Pixel 7 基线为 34/34 通过，MRX-002 重构后不得引入未解释失败。

## 房间与开局

| ID   | Required case                                            | 层级      | Owner           |
| ---- | -------------------------------------------------------- | --------- | --------------- |
| L-01 | relay create/settings 只接受 2/4/6/8，默认 2             | D/DB/C/UI | MRX-004/010     |
| L-02 | relayEliminationEnabled 默认 false，且不污染 race 开关   | DB/C/R/UI | MRX-004/010     |
| L-03 | 上限 6 可由实际 2/4/6 人开局，不要求坐满                 | DB/E2E    | MRX-004/013     |
| L-04 | 3/5/7 人全员 ready 不开局并投影 odd reason               | D/DB/R/UI | MRX-004/010     |
| L-05 | 偶数 roster 有一人未准备或断线时不开始                   | DB/E2E    | MRX-004/013     |
| L-06 | 4 人中仅 2 人 ready 不会冻结 ready 子集                  | DB        | MRX-004         |
| L-07 | join/claim/settings/final-ready 竞争不超员、不奇数开局   | DB        | MRX-004         |
| L-08 | 实际 N=2 时 relay 开关任意都冻结 relay legacy RuleSet    | D/DB/E2E  | MRX-004/006     |
| L-09 | feature flag 关闭时只允许双人 relay，race 不受影响       | DB/UI/E2E | MRX-004/010/013 |
| L-10 | 请求不能混用 race/relay 淘汰字段，切换模式不保留异类草稿 | C/R/UI    | MRX-004/010     |

## 配对、题目与 encounter

| ID   | Required case                                              | 层级     | Owner           |
| ---- | ---------------------------------------------------------- | -------- | --------------- |
| E-01 | 2/4/6/8 active 分别生成 1/2/3/4 个完整 pair                | D/DB     | MRX-005         |
| E-02 | 奇数 active 恰有一个 bye，无遗漏/重复 member               | D/DB     | MRX-005/008     |
| E-03 | 同一玩家不能连续两个 stage bye                             | D/DB     | MRX-005/008     |
| E-04 | 固定 seed 配对可复现；落库后重启不重抽                     | D/DB     | MRX-005/009     |
| E-05 | 同 stage 各 encounter 答案互异，答案池不足原子失败         | D/DB     | MRX-006         |
| E-06 | 不同 encounter 可猜同一角色，同 encounter 禁止重复         | DB       | MRX-003/006     |
| E-07 | 非本 encounter 玩家/非当前 turn/已结束动作稳定拒绝         | D/DB/C   | MRX-006         |
| E-08 | 一张棋盘结束不关闭其他棋盘，最后一张触发一次 relay barrier | DB/R/E2E | MRX-005/006/013 |
| E-09 | 4 张棋盘同时 guess/pass/timeout 无死锁和重复事件           | DB/load  | MRX-006/013     |
| E-10 | 正确、双方耗尽、整局超时、空过超额、forfeit outcome        | D/DB     | MRX-006         |

## 非淘汰积分

| ID   | Required case                                              | 层级     | Owner       |
| ---- | ---------------------------------------------------------- | -------- | ----------- |
| P-01 | win/loss 为 +2/+0，draw 为 +1/+1，bye 为 +0                | D/DB     | MRX-007     |
| P-02 | BO1/3/5/7 恰为 1/3/5/7 个 stage                            | D/DB     | MRX-007     |
| P-03 | stage 全部 encounter 结束前积分不变                        | DB/R     | MRX-007/011 |
| P-04 | stage delta 原子且幂等，重试不重复加分                     | DB       | MRX-007     |
| P-05 | 最终积分降序与 `1,1,3` 共享排名                            | D/DB/UI  | MRX-007/012 |
| P-06 | 永不因领先提前结束，除非异常不足 2 active                  | D/DB     | MRX-007/009 |
| P-07 | relay fixed-points 与 race points 不共享常量、排名或调度键 | D/static | MRX-007/013 |

## 淘汰、濒死与排名

| ID   | Required case                                            | 层级     | Owner       |
| ---- | -------------------------------------------------------- | -------- | ----------- |
| X-01 | 初始/上限 10；胜 +1 capped，负 -n，平 -floor(n/2)        | D/DB     | MRX-008     |
| X-02 | 首次原始结果小于等于 0 均进入濒死并钳制为 0              | D        | MRX-008     |
| X-03 | near-death 正分无效、0 delta 不死；负 delta 保留负分      | D/DB     | MRX-008     |
| X-04 | near-death 下一次负 delta 保留负分并淘汰                 | D/DB     | MRX-008     |
| X-05 | 同 stage 0/1/多人/全员淘汰均正确                         | D/DB     | MRX-008     |
| X-06 | 剩 2 人继续淘汰 policy，结算后 <=1 人结束                | D/DB/E2E | MRX-008/013 |
| X-07 | bye 分数/生命状态不变，页面 capability 只读              | D/DB/UI  | MRX-008/012 |
| X-08 | 淘汰于 n 的 survivedStages=n-1，survivor=completedStages | D/DB     | MRX-008     |
| X-09 | 只按存留局数共享排名，积分不破同分                       | D/DB/UI  | MRX-008/012 |
| X-10 | 全员同轮淘汰允许并列第一且无 winner                      | D/DB/E2E | MRX-008/013 |
| X-11 | relay elimination 改动不改变 race placement fixture      | D/DB     | MRX-008/013 |
| X-12 | relay 负分可持久化/投影/统计，race score schema 仍非负   | DB/C/R   | MRX-003/012 |

## 离场、恢复与再来一局

| ID   | Required case                                                  | 层级     | Owner       |
| ---- | -------------------------------------------------------------- | -------- | ----------- |
| R-01 | 宽限内重连恢复原 encounter/turn，timer 不暂停                  | DB/R/E2E | MRX-009/011 |
| R-02 | 单人永久离场只让所属 encounter 判负                            | DB       | MRX-009     |
| R-03 | 同 pair 双方同时过期为 draw，不依赖扫描顺序                    | D/DB     | MRX-009     |
| R-04 | relay fixed_points 离场后 odd active 复用 bye，不足 2 提前排名 | D/DB     | MRX-009     |
| R-05 | relay elimination 离场不触发濒死，存留局数正确                 | D/DB     | MRX-009     |
| R-06 | 重启不重抽 pairing/answer，不重复 turn/settlement/event        | DB/E2E   | MRX-009/013 |
| R-07 | 无法恢复时产生明确 server_restart 终态                         | DB/R     | MRX-009/011 |
| R-08 | 淘汰者可 rematch；left 阻止；新 match 全状态重置               | DB/E2E   | MRX-009/013 |

## 投影、历史与安全

| ID   | Required case                                                    | 层级          | Owner           |
| ---- | ---------------------------------------------------------------- | ------------- | --------------- |
| S-01 | 所有 relay viewer 可见完整标签，不使用匿名矩阵                   | C/R/UI/E2E    | MRX-011/012     |
| S-02 | 进行中 answer 不出现在 REST/WS/snapshot/history/error/log        | DB/C/security | MRX-006/011/013 |
| S-03 | terminal encounter 才揭示自身 answer                             | DB/C/R        | MRX-011         |
| S-04 | 伪造跨 encounter/跨 room ID 无动作或越权读取                     | DB/security   | MRX-006/011/013 |
| S-05 | namespaced relay 事件共享连续 sequence，cursor/snapshot 修复缺口 | DB/R/E2E      | MRX-011         |
| S-06 | snapshot 大小不随完整历史 turn 无界增长                          | DB/load       | MRX-011/013     |
| S-07 | 历史分页无重复/遗漏，刷新后可按需恢复                            | DB/R/E2E      | MRX-011/012     |
| S-08 | v2 客户端明确刷新，v3 game/chat 双水位正确                       | C/R/E2E       | MRX-003/011/013 |

## Web 与本地统计

| ID   | Required case                                            | 层级       | Owner       |
| ---- | -------------------------------------------------------- | ---------- | ----------- |
| W-01 | 当前/历史始终最多挂载一张棋盘                            | UI/E2E     | MRX-012     |
| W-02 | 对阵标题包含双方昵称和 seat，重复昵称可区分              | UI/E2E     | MRX-012     |
| W-03 | 浏览他人棋盘、bye、结束、淘汰、spectator 输入禁用        | UI/E2E     | MRX-012     |
| W-04 | own active board + 本人 turn 才可 guess/pass/forfeit     | UI/E2E     | MRX-012     |
| W-05 | own encounter 结束提示不阻塞翻页/历史                    | UI/E2E     | MRX-012     |
| W-06 | 顶部积分实时展示 active/near-death/eliminated/left/bye   | UI/E2E     | MRX-012     |
| W-07 | desktop/Pixel 7 无横向页面溢出、遮挡和布局跳动           | E2E/visual | MRX-010/012 |
| W-08 | stats v1-v6 导入；v6 以 mode + RuleSetRef 判别并匿名导出 | R/UI       | MRX-012     |

## MRX-013 最小浏览器组合

完整组合数量很大，E2E 至少覆盖以下高价值路径，其余组合由 domain/DB/component 测试覆盖：

| viewport |        roster | scoring            | 关键路径                                 |
| -------- | ------------: | ------------------ | ---------------------------------------- |
| desktop  |             2 | relay legacy_wins  | 完整 BO、pass/timeout、历史、rematch     |
| desktop  |             4 | relay fixed_points | 两棋盘并发、一方先结束等待、固定轮数排名 |
| desktop  |             6 | relay elimination  | 濒死、淘汰后 5 人 bye、禁止连续 bye      |
| desktop  |             8 | relay elimination  | 四棋盘并发、完整积分条、最终 survivor    |
| Pixel 7  |             4 | relay fixed_points | 创建/大厅、单棋盘分页、非阻塞提示        |
| Pixel 7  |             6 | relay elimination  | bye/淘汰只读、历史与返回当前轮           |
| desktop  | 4 + spectator | 任一多人制         | 全标签观战、刷新/重连、chat channel      |
| desktop  | 4 -> 3 active | relay fixed_points | 永久离场、系统 bye、提前终止保护         |
