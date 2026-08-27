# MRX-013：完成跨模式集成、安全审计与灰度发布

**类型**：质量/发布 Issue  
**优先级**：P0（发布闸门）  
**依赖**：MRX-012（传递依赖 MRX-001 至 MRX-011）  
**状态**：已完成

**建议标签**：`type:quality` `area:test` `area:security` `area:ops`

**决策依据**：[决策记录](./decisions.md)全部章节  
**执行清单**：[发布闸门](./release-gate.md)  
**覆盖矩阵**：[测试矩阵](./test-matrix.md)

## 要解决的问题

并行接力同时改变底层模式调度、数据库、实时协议、并发结算、历史和 Web 状态。单个规则或组件测试无法证明旧玩法无回归，也无法覆盖答案泄漏、stage 重复结算、v2/v3 切换和最大 fan-out。需要独立发布 Issue 只做集成修复与上线验证。

## 要做到什么程度

- 在真实 PostgreSQL/API/WS 环境完成 2/4/6/8 relay 三种 rule set、race wins/points/placement、spectator、chat、断线和 rematch 全矩阵。
- 演练 expand-only migration、旧数据读取、新 binary 回滚、v2 房间排空和 v3 客户端刷新。
- 审计鉴权、capability、答案投影、跨房间 ID、幂等、Origin、限流、XSS/纯文本、日志脱敏和慢消费者。
- 压测 8 player + spectatorCap、4 个并发 encounter、长 stage/history、同时 turn timeout 和结算；记录 p95/p99 与 WS payload。
- 分别验证两个服务端与两个 Web rollout flag 的组合、关闭/回滚策略和已开始 match 的 grandfather 行为。
- 验证 full、race-only、relay test module 三种 registry 装配及 core/race/relay 静态依赖规则；证明 relay 可关闭且 race 不需要 relay repository/projector。
- 完成桌面/移动可访问性、视觉回归、用户文档与公告。

## 属于本 Issue

- 集成发现的小范围修复、e2e/load/security tests、监控面板/告警、发布脚本和文档更新。
- v2 停止新建、短期房间排空/关闭、v3 切换与旧页面刷新演练。
- `0015+` migration、RuleSetRef 兼容映射和 stats v1-v6 升级演练。
- `docs/multiplayer.md`、`docs/gameplay.md`、`docs/architecture.md` 和部署配置同步。

## 不属于本 Issue

- 不在发布阶段重新设计计分、配对、濒死或历史协议；语义问题退回拥有它的 MRX Issue。
- 不顺手修复无关题库、聊天产品需求或 race 玩法。
- 不在发布阶段把 mode-owned 逻辑重新上提到 core 来临时绕过集成问题。
- 不在负载不达标时静默降低规则正确性或可见性；应优化查询/投影或保持 flag 关闭。

## 验收标准

- [发布闸门](./release-gate.md)全部 P0 项完成并记录命令、环境、提交和结果。
- [测试矩阵](./test-matrix.md)中所有 required case 自动化通过，无未解释 flaky/skip。
- 现有 2 人 relay 与 race 2/3/4/8 的 REST、WS、snapshot、UI、chat 和 stats 无行为回归。
- race-only 装配和 relay flag-off 路径不读取 relay 表、不注册 relay projector，依赖检查无跨模式 import。
- 最大房间下普通 turn 不因全局 stage 锁被长时间串行；并发完成只结算一次，数据库无死锁。
- 玩家不能通过其他 encounter API、WS、snapshot、history、错误或日志获取进行中答案；完整标签的有意可见性已单独验收。
- v3 灰度关闭后新建 N 人 relay 被服务端拒绝，双人 relay/race 正常；回滚不丢新表数据。
- 用户公告、稳定玩法文档、架构图、配置说明与实际默认开关一致后才允许默认开放。

## 可能涉及的代码

全仓测试与配置；重点为 `apps/api/internal/server/`、`apps/web/e2e/`、`scripts/`、`compose*.yaml`、`.env.example`、`docs/{multiplayer.md,gameplay.md,architecture.md,deployment.md}`、监控与发布配置。

## 实施与验收记录（2026-08-25）

本 Issue 已完成开发环境的发布就绪验收。服务端新增 `full`、`race-only`、`relay-only` registry profile，组合根只为已注册模式构造 recovery/forfeit runtime；relay rollout flag 只阻止新配置，当前 binary 仍可读取、恢复并完成已冻结的多人 match。race-only 真实 create/play/snapshot/recovery 路径通过 SQL tracer 证明不查询 `multi_relay_*` 表，未知 profile 和缺失 capability 均 fail closed。

集成审计修复了发布阶段发现的小范围问题：旧双人 relay 终局现在始终生成稳定排名；handler 在 relay runtime 未注册时不再落入 race 旧路径；内部错误响应和结构化请求日志不再包含持久化错误值；relay history 增加按已认证 member 的限流。Sweeper 会隔离独立步骤和单个 relay recovery candidate 的失败，先广播已提交房间再返回聚合错误，避免一个消失候选阻止其他 countdown、timeout、settlement 或房间清理。普通 encounter action 仍只锁所属 encounter，只有终态尝试 stage barrier。

可观测性新增有界、低基数的 Prometheus 指标，覆盖 active encounter、guess/history latency、stage/encounter duration、barrier wait、timeout、pairing/pool failure、settlement retry、deadlock、snapshot/WS bytes、重连和慢消费者队列丢弃；未知持久化 RuleSetRef 统一归入 `unknown/0`，不会成为答案或内部 ID label。`/metrics`、Prometheus 告警、Grafana provisioning/dashboard 和 Compose monitoring profile 已同步，配置解析通过。稳定玩法、部署、架构、默认开关与用户灰度公告均已更新；多人 relay 固定积分和淘汰赛 API/Web 入口均默认开启，可通过对应 flag 独立关闭。

迁移与回滚演练使用一次性 PostgreSQL 数据库，从包含 race wins/points/placement、旧双人 relay、finished history 和 chat fixture 的 `0014` 开始：`0014 -> 0019` 耗时 `135.348628ms`，旧行数和 RuleSetRef 回填保持正确；将应用 migration version 回到 14 后，`0015..0019` 的 expand 表/列和 v3 fixture 仍保留，模拟旧 binary 的显式旧列写入可被新 binary 读取；重新应用耗时 `76.300617ms` 且行数不漂移。`0015..0019` 的 Down 均经自动化确认是 `SELECT 1` no-op，生产回滚不删除新表数据。WS v2 页面收到 `protocol.refresh_required`，v3 的 game/chat cursor、replay 与 `sync.complete` 由现有 server/Web 自动化覆盖。

负载与安全结果：

- 8 player + 32 spectator、4 个并发 encounter、5 波共 20 个并发 action：`p95=99.824309ms`、`p99=99.824309ms`；stage/settlement/event 各一次，8 条 settlement row，数据库 deadlock 增量为 0，spectator snapshot 小于 512 KiB。
- 100 stage / 2000 turn fixture：snapshot `106687B`（`p95/p99=31.393106ms`），history first page `68626B`（`p95/p99=19.184407ms`）；完整历史没有无界进入 snapshot，history 远低于 1500ms 门槛。
- 跨 room/encounter、旧 stage、非成员、非 turn、spectator/bye/eliminated capability、活动答案投影、terminal answer 边界、history 限流、日志/metrics 脱敏、XSS 纯文本、WS Origin/subprotocol/read limit/send queue 均由 Go、Web 或浏览器门禁覆盖；P0/P1 发现数为 0。

最终验证：

- `pnpm lint:openapi`、`pnpm check:openapi-refs`（41 个 YAML、40 个本地引用）、`pnpm check:ws-protocol`、`pnpm check:multiplayer-boundaries`：全部通过。
- `pnpm typecheck`、`pnpm test`：shared 10、data 26、Web 184 tests 全部通过。
- `task test:go`：全部 Go package 通过；MRX-013 security/load、migration、metrics/recovery 聚焦测试另以 `-count=1 -v` 通过并记录上述指标。
- `task gen`：使用 CI 同版本 `sqlc v1.31.1` 成功；生成目录前后 SHA-256 聚合值均为 `60c0a07be6ca1202ccaf1bd5bbb4416d33dc040e198a2d2ea7b215f2db949b6b`。
- `pnpm --filter @touhouflandre/web build`、`docker compose config --quiet`、固定镜像 `prom/prometheus:v3.5.0` 的 `promtool check config`（1 个 rule file / 6 条 rules）、monitoring dashboard JSON 解析和相关 Prettier 检查：全部通过。
- 隔离真实 PostgreSQL/API/WS 环境的 `apps/web/e2e/multiplayer.spec.ts --workers=2`：desktop Chromium 与 Pixel 7 为 `73 passed / 1 skipped`；唯一 skip 是明确限定 desktop 的 8 人淘汰 survivor 长流程，desktop 对应用例通过，移动组合不属于最小矩阵。2/4/6/8 relay lobby/stage 视觉基线、race 视觉回归、axe、200% zoom、reduced-motion 和键盘 `Home/End` 切换均通过。
- 一次诊断性 `10 workers` 运行因本机 Next dev proxy 饱和出现 4 个 desktop timeout 与 1 个 `ECONNRESET`；5 项均在单 worker 复跑通过，随后完整 2-worker 套件零失败，因此没有遗留未解释 flaky。

本次未创建分支、commit、tag、push、PR 或生产发布，也未修改用户正在运行的 `:4000` API。最终发布提交、执行人和生产时间窗由实际发布流程填写；当前代码默认开放多人 relay 固定积分和淘汰入口，Web 创建页默认显示多人控件但保持 2 人、关闭淘汰的兼容初始值。回滚时按关闭 Web flag -> 关闭 API flag -> 排空 v3 room -> 回滚旧 binary、保留 expand schema 的顺序执行，发布闸门和稳定部署文档已同步。
