# MRX-013 发布闸门清单

本文只记录发布验证，不是重新设计规则的入口。发现计分、配对、权限或协议语义冲突时，回到拥有该决策的 MRX Issue 修正。

## 发布状态模板

| 项目                  | 状态   | 记录                             |
| --------------------- | ------ | -------------------------------- |
| MRX-001 基线          | 已记录 | 2026-08-23；E2E 34/34            |
| 模块边界/装配检查     | 待执行 | full/race-only/fake-mode、依赖图 |
| expand migration 演练 | 待执行 | 旧版本、目标版本、耗时、数据校验 |
| WS v2 排空 / v3 切换  | 待执行 | 停止新建时间、剩余房间、刷新验证 |
| 自动化矩阵            | 待执行 | 命令与报告链接                   |
| 并发/负载             | 待执行 | 样本、p95/p99、锁等待、错误率    |
| 安全审计              | 待执行 | P0/P1 必须为 0                   |
| 可访问性/视觉         | 待执行 | desktop/Pixel 7 截图与 axe 结果  |
| 灰度/回滚             | 待执行 | flag 组合、负责人、时间窗        |
| 稳定文档/公告         | 待执行 | 评审人与发布时间                 |

## 灰度开关

开发和初次合并阶段建议默认关闭，完成本清单后再决定生产默认值。服务端永远是最终授权边界；Web flag 只控制入口。

| 环境变量                                      | 初始默认 | 作用                                              |
| --------------------------------------------- | -------: | ------------------------------------------------- |
| `MULTI_N_PLAYER_RELAY_ENABLED`                |  `false` | 是否允许新建/调高 `playerLimit > 2` 的 relay 房间 |
| `NEXT_PUBLIC_MULTI_N_PLAYER_RELAY_ENABLED`    |  `false` | 是否显示 relay 多人上限和对应状态 UI              |
| `MULTI_RELAY_ELIMINATION_ENABLED`             |  `false` | 是否允许新建/修改为多人 relay 淘汰配置            |
| `NEXT_PUBLIC_MULTI_RELAY_ELIMINATION_ENABLED` |  `false` | 是否显示并启用淘汰 switch                         |

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

- [ ] guess/pass/forfeit 每次重新校验 token、room、match、stage、encounter membership 和 turn capability。
- [ ] 伪造其他 encounterId、其他 roomId、旧 stageIndex、淘汰/bye/spectator 身份均稳定拒绝。
- [ ] 进行中 answer 不出现在 REST、WS、snapshot、history、cursor、错误、结构化日志、metrics label 或前端 DOM。
- [ ] terminal answer 只属于对应 encounter；同 stage 其他进行中 answer 仍隐藏。
- [ ] relay 完整标签可见是显式 allow policy；race 匿名矩阵没有因共享 projector 回归。
- [ ] core 不解析 mode payload；race projector 不查询 relay 表，relay projector 不 import race 匿名矩阵实现。
- [ ] 未知/缺失 `RuleSetRef` 明确拒绝，不能回退到 `wins`、`points` 或当前 relay 默认策略。
- [ ] guest token/token hash、昵称和内部 ID 不进入本地统计导出；日志不记录 token 或未揭示答案。
- [ ] chat 仍按 player/spectator channel 授权，role/capability 变化不会越权回放。
- [ ] Web 对昵称、历史标签和 chat 继续按纯文本渲染，XSS payload 不注入 DOM。
- [ ] WS Origin、subprotocol、hello 鉴权、read limit、send queue 和限流有效。

任何 P0/P1 越权、答案泄漏或结算重复都阻止发布；不能以低发生概率接受。

## Web 与可访问性

- [ ] 2/4/6/8 人大厅、relay fixed_points/elimination、bye、near-death、eliminated、finished 在 desktop/Pixel 7 有视觉基线。
- [ ] 当前和历史任何时刻最多一张棋盘表格挂载，翻页/加载不会改变布局尺寸或把输入移到错误棋盘。
- [ ] 对阵标题、积分、长昵称、页码、状态提示不重叠、不截断关键数值、无页面横向溢出。
- [ ] paginator icon 有 tooltip/accessible name；switch、range、菜单、历史按钮可用键盘操作。
- [ ] 状态变化使用适当 live region，不依赖颜色单独表达 near-death/淘汰/轮空。
- [ ] encounter 结束不弹阻塞模态；用户可继续翻页、看历史和聊天。
- [ ] prefers-reduced-motion、200% zoom 和窄屏下功能完整。

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

- [ ] 更新 `docs/multiplayer.md` 的稳定规则、REST/WS、配置、可见性和测试重点。
- [ ] 更新 `docs/gameplay.md` 的公开玩法说明。
- [ ] 更新 `docs/architecture.md` 的 capability registry、core/mode 边界、relay stage/encounter 和历史数据流。
- [ ] 记录最终 core/race/relay 包依赖图、registry 装配点和 legacy adapter 清理条件。
- [ ] 更新 `.env.example`、部署文档与监控说明。
- [ ] 用户公告明确 2 人旧赛制、两种多人赛制、完整棋盘可见性和灰度状态。
- [ ] 在本文件记录最终默认 flag、发布提交、执行人、时间和回滚演练结果。
