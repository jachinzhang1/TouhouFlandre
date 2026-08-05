# 产品化与系统设计规划

> 状态：规划中  
> 基线日期：2026-08-05  
> 目标读者：产品、前后端、测试和运维贡献者  
> 范围：产品能力、业务不变量、身份权限、多人系统、可靠性和验收

本文承接从技术栈迁移书中提取出的非技术选型内容。使用什么框架和工具见 [`05_tech_stack_migration.md`](./05_tech_stack_migration.md)。

---

## 1. 产品化目标与边界

在保留当前单机玩法的前提下，后续产品能力包括：

- 用户账号和跨设备进度；
- 个人统计与排行榜；
- 多人房间和实时对战；
- 受权限保护的运营后台；
- 数据备份、恢复、监控和事故处理。

本项目是非盈利社区项目，不规划收费或商业化功能。是否支持组织空间、多实例房间和外部身份服务，必须由实际需求触发，不提前建设。

---

## 2. 必须保持的业务不变量

- 服务器是答案、猜测结果和多人状态的权威来源。
- 进行中的公开会话不返回答案，结束后才返回答案。
- 会话绑定创建时的题库快照；题库更新不能改变已开始会话（快照按版本存于 `CatalogSnapshot`，会话记录 `catalogVersion`，恢复时按版本读取）。
- 每日题按明确时区生成，同一天的答案一旦创建便固定。
- 猜测顺序稳定，同一角色不能在同一会话重复提交。
- 并发提交不会覆盖已经成功的猜测。
- 旧猜测缺少非权威展示字段时，可从题库快照恢复（按 `catalogVersion` 从 `CatalogSnapshot` 读取对应版本）。
- 匿名用户仍可游玩每日题和随机题，登录不是单机玩法前置条件。

---

## 3. 产品与可靠性指标

正式实施前需要为下列指标填写基线和目标值：

| 维度 | 指标 |
|---|---|
| 功能 | 每日题、随机题、搜索、恢复和分享的回归通过率 |
| API | p50/p95 延迟、错误率、并发请求量 |
| 多人 | 每房间人数、并发房间数、事件延迟、重连成功率 |
| 前端 | LCP、INP、CLS、可访问性和客户端体积 |
| 可靠性 | 可用性、备份频率、RPO、RTO、回滚时限 |
| 成本 | 开发、预发布和生产环境预算 |

没有基线和目标值时，不宣称性能或可靠性已经提升。

---

## 4. 数据处置与产品数据

### 4.1 现有数据处置

题库目录（角色、作品、标签）以版本化快照形式存于数据库（`CatalogSnapshot`），是版本管理与游玩历史复现的权威源，查询直接走 SQL（内存索引为后期优化预案，见 4.4）。题库本身可重建，但 `DailyPuzzle` 和 `GameSession` 是运行时数据，正式迁移前必须二选一：

- **丢弃 Demo 运行时数据**：公告停机窗口，冻结写入后重建；或
- **保留运行时数据**：编写一次性导入器，校验行数、题库版本、答案和猜测哈希。

旧 SQLite 文件保留到确认稳定后删除（git 历史同样可回溯）。

### 4.2 后续产品数据

新增能力可能需要：

- `users`：账号主体；
- `auth_sessions`：refresh token 轮换与撤销；
- `game_guesses`：每次猜测一行，保存顺序和结果快照；
- `rooms`、`room_members`、`room_events`：多人权威状态和恢复游标；
- `audit_logs`：后台敏感操作审计。

具体字段、索引和删除策略必须通过 schema ADR 决定，不能仅凭本规划直接建表。首版只有个人账号时不引入 `tenant_id`；组织空间出现明确需求后再设计租户边界。

### 4.3 建议数据约束

- `UNIQUE (session_id, turn)`；
- `UNIQUE (session_id, guess_id)`；
- 状态、模式和内容类型使用受约束字段；
- 每日题对业务日期和时区建立明确唯一键；
- 用户数据必须有外键、归属关系和明确删除策略。

### 4.4 题库存储设计与后期优化预案

**设计原则：数据库是题库的唯一权威源，承担版本管理与游玩历史复现。**

- 每个题库版本在 `CatalogSnapshot` 中一行（`charactersJson`），`GameSession`/`DailyPuzzle` 通过 `catalogVersion` 外键绑定——旧会话随时按版本还原当时的角色数据，这是纯 JSON 文件方案需要额外维护的能力。
- seed 写入新版本快照并更新 `CatalogState.currentVersion`；旧版本快照保留，历史会话按 `catalogVersion` 复现不受影响。
- `Character`/`Work` 行表保留为结构化当前版本数据（seed 对账、审计、后台查询），与快照同源于一次 seed，不允许漂移。
- 题库变更时，已开始会话的答案与比较结果不因题库更新而改变（见第 2 节不变量）。

**后期优化预案：内存索引（当前不做，由性能证据触发）。**

当真实负载数据显示搜索/目录查询的延迟或数据库开销成为瓶颈时：

- 进程启动时读取 `CatalogState.currentVersion` 对应的快照一次，构建内存索引（byId、规范化搜索文本、排序键），此后搜索、目录摘要、创建会话、会话恢复全部在内存完成，零 DB 往返。
- 内存索引版本必须与 `CatalogState.currentVersion` 一致；启动时校验，加载失败拒绝启动，不能带空/错版题库运行。
- 运行中通过显式 reload 重建索引，或简单重启。
- 附带收益：可恢复前缀优先匹配语义（现 SQL 查询只有子串匹配）。

是否启用由性能证据触发，不预付成本；与 `pg_trgm`、Redis 等优化同级对待。

---

## 5. 身份与 Token 设计

鉴权采用 JWT 双 Token：

- access token 短期有效，存入 LocalStorage；
- refresh token 长期有效，存入 HttpOnly Cookie；
- 业务 API 使用 `Authorization: Bearer <access_token>`；
- refresh token 只用于 refresh、logout 等身份端点。

### 5.1 登录与刷新

1. 登录成功后，响应体返回 access token；前端写入 LocalStorage。
2. Go API 通过 `Set-Cookie` 写入 refresh token，前端 JavaScript 不读取其值。
3. access token 过期后，前端以 `credentials: include` 调用 refresh endpoint。
4. 服务端返回新 access token，并通过 `Set-Cookie` 轮换 refresh token。
5. refresh token 包含唯一 `jti`；服务端保存 auth session，用于重用检测和撤销。

生产 refresh Cookie 必须设置：

- `HttpOnly`；
- `Secure`；
- `SameSite=Strict`；
- 省略 `Domain`，形成 host-only Cookie；
- `Path=/api/auth`；
- Cookie 有效期与 refresh token `exp` 一致。

### 5.2 登出与多设备

- 登出时撤销 auth session、返回过期 Cookie并清除 LocalStorage access token。
- 即使登出请求失败，前端也先清除本地 access token。
- 支持设备级退出和全端退出。
- 多标签页刷新必须串行，避免同一 refresh token 被并发使用。
- 匿名会话通过显式流程合并到登录账号，不凭客户端 session ID 直接认领。

### 5.3 浏览器安全

LocalStorage access token 可被同源 JavaScript 读取，XSS 仍是主要风险。HttpOnly 防止直接读取 refresh token，但 XSS 存在期间仍可能代用户调用刷新接口。

必须落实：

- 严格 CSP，限制内联脚本和脚本来源；
- 禁止不可信内容进入 `dangerouslySetInnerHTML`、`innerHTML`、动态脚本或 `eval`；
- 限制第三方脚本，锁定并审查前端依赖；
- Token 不进入日志、错误上报、URL、查询参数或分享内容；
- access token 保持短期有效；
- refresh rotation、重用检测和全端撤销不得省略；
- refresh/logout 仅接受 POST，验证精确 Origin/Referer，并限制 credential CORS 来源。

由于 Next.js 服务端无法读取 LocalStorage access token，登录态页面在客户端恢复 access token。客户端路由守卫和隐藏按钮只改善体验，Go API 必须逐请求执行资源级授权。

---

## 6. 权限、后台与合规

### 6.1 权限

初始角色可为 `user`、`operator`、`admin`：

- 认证回答“用户是谁”；
- 授权回答“用户能访问什么”；
- 每个资源查询必须包含归属或角色条件；
- 不能只依赖前端隐藏页面或按钮。

### 6.2 后台审计

后台敏感操作记录：

- 操作者；
- 操作目标；
- 变更前后摘要；
- request ID；
- 操作时间和结果。

### 6.3 素材与隐私

公开部署前需要核对东方 IP、第三方头像和其他素材的来源与许可，更新 `THIRD_PARTY_ASSETS.md`，并准备隐私说明和个人数据删除流程。

---

## 7. 多人房间系统设计

### 7.1 权威状态

- Postgres 保存房间、成员、回合、动作和恢复游标。
- 题库目录的权威源是数据库快照（见 4.4），查询直接走 SQL。
- Go 内存保存活动连接和热点投影，不是房间状态的真实来源。
- 服务重启后能够从持久状态恢复，或给出明确终止结果。
- 单实例版本也需要优雅排空，不能在发布时无提示丢局。

### 7.2 REST 与 WebSocket

- REST 负责命令：创建/加入房间、准备、提交猜测、离开。
- WebSocket 负责事件：成员变化、回合变化、猜测结果、房间结束。
- REST 命令使用幂等键；数据库事务提交后再发布事件。
- 客户端按 sequence 去重、排序，发现缺口时通过 REST 获取 snapshot。
- REST 响应和 WebSocket 事件可能乱序，客户端按版本合并状态。

### 7.3 事件信封

```json
{
  "type": "room.guess.accepted",
  "eventId": "...",
  "roomId": "...",
  "sequence": 42,
  "occurredAt": "2026-08-05T12:00:00Z",
  "payload": {}
}
```

`contracts/ws/protocol.yaml` 记录消息方向、payload、权限、错误和时序，并提供有效与无效示例。早期可手写 Go/TypeScript 类型，但 CI 必须校验 schema 和示例。

### 7.4 连接与重连

- HTTP 升级时验证 Origin 和协议版本。
- 连接建立后的第一条消息携带 access token；认证前不能接收或发送房间事件。
- 指数退避重连并加入随机抖动，携带最后确认的 sequence。
- 设置消息大小、读写超时、发送队列和每用户连接数上限。
- 慢消费者断开并重新同步，避免阻塞房间广播。
- 心跳、异常关闭、重连、服务重启和滚动发布都有集成测试。

只有单实例压测表明确实需要横向扩展时，才设计房间归属和跨实例广播。

---

## 8. 发布、可靠性与可观测性

### 8.1 发布顺序

生产发布遵循：

1. 备份和发布前检查；
2. 单实例 migration job；
3. 启动新 API 并通过 readiness；
4. 渐进切流；
5. 观察错误、延迟和数据库指标；
6. 确认稳定后清理旧副本。

数据库优先使用 expand/contract migration，不假设所有 down migration 都安全。

### 8.2 健康检查与备份

- `/livez` 只判断进程是否存活；
- `/readyz` 检查数据库和必要依赖；
- 数据库使用自动备份/PITR；
- 定期执行恢复演练；
- Docker 命名卷不是备份。

### 8.3 可观测性

- JSON 结构化日志，统一 request ID、脱敏 user ID、room ID 和版本字段；
- 指标覆盖请求率、错误率、延迟、数据库池、WebSocket 连接和房间数；
- 对 API、数据库和关键外部服务使用追踪；
- 为错误率、延迟、容量、备份失败设置告警和 runbook；
- 定义日志、审计、房间事件和账号数据的保留期限。

---

## 9. 验收场景

| 层级 | 必须覆盖的场景 |
|---|---|
| 游戏回归 | 每日题、随机题、搜索、分享和会话恢复 |
| 数据 | 题库版本、每日题固定答案、并发猜测和旧记录兼容 |
| 身份 | 登录、刷新、Token 重用、设备退出、匿名合并和账号恢复 |
| 权限 | 用户越权、后台角色、资源归属和审计 |
| 多人 | 乱序、重复、丢事件、重连、慢消费者和服务重启 |
| 浏览器 | 键盘、移动端、无障碍、视觉回归和 XSS 防护 |
| 可靠性 | 渐进发布、回滚、备份恢复和事故 runbook |

---

## 10. 产品化实施顺序

技术栈迁移完成后，按以下顺序实施：

### Stage 1 — 数据完整性

- 决定现有运行时数据保留或丢弃。
- 固化业务不变量和回归场景。
- 明确个人数据的归属、保留和删除。

### Stage 2 — 身份与个人数据

- 实现账号、双 Token、auth session 和匿名合并。
- 增加跨设备统计与个人数据删除。
- 完成 XSS、Cookie、Origin、撤销和账号恢复测试。

### Stage 3 — 权限与后台

- 实现 RBAC、资源级授权和运营后台。
- 所有敏感操作进入审计日志。

### Stage 4 — 多人联机

- 实现持久房间状态、REST 命令和 WebSocket 事件。
- 完成幂等、sequence、snapshot resync、重连和排空。
- 达到单实例容量目标后再判断是否需要横向扩展。

### Stage 5 — 生产可靠性

- 落地监控、告警、备份、恢复、数据保留和事故处理。
- 完成素材许可和隐私说明检查。

---

## 11. 主要风险

| 风险 | 缓解 |
|---|---|
| 题库版本或每日题语义被破坏 | 快照版本一致性校验、业务不变量测试与黄金用例回归 |
| 内存索引与数据库版本不一致（若启用优化） | 启动版本校验 + 一致性测试 |
| 身份或后台越权 | 资源级授权、RBAC、审计和安全测试 |
| LocalStorage access token 被 XSS 窃取 | CSP、输出安全、第三方脚本限制和短期 token |
| refresh Cookie 被跨站滥用 | HttpOnly、Secure、SameSite、Origin 校验和轮换 |
| 内存房间在重启时丢失 | Postgres 权威状态和重连游标 |
| 数据库迁移不可逆 | expand/contract、备份和恢复演练 |
| 素材来源或许可不清 | 公开部署前审查并准备替换方案 |
| 过早建设多租户或多实例 | 由明确需求和容量指标触发 |

---

## 12. 待完成 ADR

| ADR | 关键问题 |
|---|---|
| 身份来源 | 自建凭据、OAuth/OIDC 或托管身份服务 |
| 数据处置 | Demo 会话丢弃还是导入 |
| 个人数据 | 保留期限、导出和删除流程 |
| 租户模型 | 只支持个人账号，还是未来需要组织空间 |
| 多实例房间 | 何时需要跨实例广播，房间如何归属 |
| 生产拓扑 | 自托管、托管平台或混合部署 |

---

## 参考资料

- [OWASP：Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP：HTML5 Local Storage](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#storage-apis)
- [OWASP：Content Security Policy](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
