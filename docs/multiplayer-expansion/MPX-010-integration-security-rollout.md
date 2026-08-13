# MPX-010：完成跨模式验收、安全审计与分阶段发布

**类型**：质量/发布 Issue  
**优先级**：P0（发布闸门）  
**依赖**：MPX-006、MPX-009  
**建议标签**：`type:quality` `area:test` `area:security` `area:ops`

## 要解决的问题

多人扩展同时触碰迁移、实时协议、并发规则和前端状态。单个 PR 的单测通过并不能证明不存在越权、序列缺口、容量竞态或移动端不可用。需要一个独立的发布闸门，避免未完成的能力被默认暴露。

## 属于本 Issue

- 从旧 slot1/slot2 数据迁移到 member roster/score 的升级演练；Down 只在一次性测试库验证，生产应用回滚保留 expand schema 和新数据。
- WS v1 短期房间的停止新建、排空/关闭、前端刷新提示和 v2 切换演练；不维护长期双协议。
- race 2/3/4/8 人、relay 两人、单局放弃/对局离场、spectator、断线重连、finished retention、聊天可见性和闭麦的完整 e2e 矩阵。
- 并发 join/claim-seat/final-ready/playerLimit、guess/forfeit/send、spectator cap 与上限 fan-out、限流、慢消费者、游戏事件重放/snapshot 补齐、独立 chat cursor/history 补齐和服务重启终态测试。
- 隐私审计：玩家对手匿名字段、spectator 消息不向 player 投影、聊天纯文本/XSS、日志/错误/前端 DOM 不泄漏 token、答案或未授权消息，本地统计落盘/导出不含房间或成员身份。
- 指标、告警、feature flag、灰度策略、应用回滚说明，以及 `docs/multiplayer.md`/README 的发布状态同步；本地多人统计 v3→新 schema 的导入/聚合回归也纳入发布闸门。
- 准备并发布面向用户的公告：说明 N 人竞速、`playerLimit`、房间聊天/闭麦的使用方式，强调不必等到房间满员即可开局，并列出未纳入范围的组队、N 人接力、图片消息等能力。公告还需包含旧页面需要刷新、短期 v1 房间会排空/关闭、灰度期间功能可能分批开放等兼容提示。
- 公告在灰度前形成可评审草稿，在功能默认开放时通过项目既有用户公告渠道正式发布；若发布回滚或功能临时关闭，应同步维护公告状态，避免用户看到与线上能力不一致的说明。

## 不属于本 Issue

- 不在测试阶段顺便改变游戏规则或聊天 channel。
- 不实现图片消息、管理员审核、账号化身份或 relay N 人。
- 不以“手工点过一次页面”替代自动化验收；发现功能缺陷应回到对应 Issue。

## 验收标准

- `pnpm typecheck`、`pnpm test`、OpenAPI/WS 检查、`cd apps/api && go test ./...`、`task gen`、Go/Web 生成目录漂移检查和多人 Playwright e2e 全部通过。
- 记录至少一次真实 Postgres 升级/回滚和一次并发压力结果；定义可接受的错误率、延迟和消息丢弃行为。
- 用故障注入覆盖 WS 订阅缓冲、捕获高水位、重放、`sync.complete` 前断线和切实时边界；授权消息零丢失、重复帧只渲染一次，未授权消息始终不可见。
- 在 spectator claim-seat 提交与旧 WS 关闭并发时持续发送两类 channel，确认旧连接不会在角色变化后继续收到 spectator 消息，重连后的 player 视图也不会恢复该 channel。
- 默认 feature flag 保持 `playerLimit=2` 且隐藏聊天入口；灰度期间可分别关闭 N 人创建和聊天发送，关闭后已有 v2 房间仍可安全结束并读取获授权历史。
- 安全审计无 P0/P1 越权问题，所有 P2 风险有负责人和后续 Issue；发布文档包含监控指标和回滚步骤。
- 用户公告已经评审并随默认开放同步发布，正文准确链接多人玩法说明，清楚区分“已经上线”“灰度中”和“暂不支持”的能力；公告链接和发布时间记录在发布清单中。发生回滚时，公告在同一发布流程中维护。

## 可能涉及的代码与工具

`.github/workflows/`、`Taskfile.yml`、`scripts/`、`apps/api/internal/server/*_test.go`、`apps/api/internal/multi/*_test.go`、`apps/web/e2e/multiplayer.spec.ts`、部署环境变量和 `docs/` 发布说明。
