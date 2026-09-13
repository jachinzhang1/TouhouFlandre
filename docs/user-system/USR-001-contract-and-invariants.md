# USR-001：契约与跨模块不变量

**类型**：contract / foundation
**优先级**：P0
**依赖**：无
**状态**：not started
**建议标签**：`user-system`, `contract`, `foundation`

## Problem

仓库目前只有游客多人令牌和单人/本地统计，没有账号领域、登录会话、用户资产或管理员权限。若直接分别开发页面和 API，用户名大小写、UID、会话失效、同步版本和多人身份很容易出现互相矛盾的定义。

## Required outcome

冻结用户系统对外可观察的领域词汇、页面状态、错误类别、认证边界、数据项版本和多人身份事件契约，使 `USR-002` 至 `USR-007` 可以在同一组输入输出上实现。HTTP 契约以 `contracts/openapi/openapi.yaml` 为源，WebSocket 事件沿用现有 `contracts/ws/` 约定；生成文件由仓库命令产生。

## In scope

- 定义账号、管理员、会话、停用、冷却、密保授权、管理员重置凭据、资料、头像解锁、数据项版本、冲突预览和多人身份的术语与状态转移。
- 为注册、登录、登出、当前用户、密保问题/答案、密码修改/重置、资料、同步、管理员列表/详情/操作补充 HTTP 契约和统一错误类别。
- 定义敏感字段永不返回的边界、回登录/原目标页面所需的客户端状态，以及管理员操作二次确认的命令语义。
- 定义同步版本摘要中“具体变更项”和游玩记录“统计摘要”的最小展示数据；定义预览快照过期标识。
- 定义多人房间使用账号资料的加入参数/事件投影和退出时的离开语义，不改变现有游客令牌协议。
- 写契约 fixture/示例和生成检查说明，明确 `apps/api/internal/generated/`、`apps/web/src/generated/`、`apps/api/.openapi.bundled.yaml` 为输出。

## Out of scope

- 数据库迁移、密码哈希、会话存储或业务 handler 实现（USR-002 负责）。
- 页面布局和组件实现（USR-003 至 USR-007 负责）。
- 新增邮箱、短信、第三方登录、合并同步、账号注销或管理员角色体系。

## Likely code areas

- `contracts/openapi/openapi.yaml`
- `contracts/ws/`
- `packages/shared/src/types.ts` 及必要的共享校验类型
- `apps/api/internal/generated/`、`apps/web/src/generated/`（仅通过生成命令更新）
- `docs/user-system-design.md`、`docs/user-system/decisions.md`

## Acceptance criteria

- [ ] 契约列出每个账号流程的成功、未认证、无权、停用、冷却、过期和冲突过期结果，并能区分凭据错误与网络错误。
- [ ] 契约明确用户名精确匹配、管理员模糊搜索、UID 字符串展示、一次性授权和敏感字段不返回的语义。
- [ ] 同步契约能表达单侧直接同步、双侧具体差异/统计摘要、整体保留方向和快照过期重新载入；不存在合并操作。
- [ ] 多人契约能表达“新房间使用账号资料、已有游客房间不切换、退出显示成员离开”，并保持现有游客接口兼容。
- [ ] 运行生成命令后生成物与契约一致，契约测试覆盖新增 operationId、状态码和错误编码；没有手工编辑生成文件。
- [ ] README 依赖表、决策记录和总规范中的术语相互链接且没有重复或冲突定义。

## Test plan

- OpenAPI lint/bundle、生成检查和现有 API 契约测试。
- 为新增状态和错误类别添加 schema fixture 校验，覆盖冷却倒计时、授权过期、快照过期和停用账号。
- 检查现有游客房间 REST/WS 契约 fixture 仍能通过。

## Dependencies and follow-ups

完成后解除 `USR-002` 的服务端模型和 `USR-003` 至 `USR-005` 的页面数据依赖；后续 Issue 不得在本地重新定义同名状态或错误。
