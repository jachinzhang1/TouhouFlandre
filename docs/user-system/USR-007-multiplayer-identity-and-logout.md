# USR-007：多人身份与退出房间集成

**类型**：feature / integration
**优先级**：P1
**依赖**：USR-001、USR-002、USR-003、USR-004
**状态**：not started
**建议标签**：`user-system`, `multiplayer`, `integration`

## Problem

现有多人房间以游客令牌和房间范围身份为中心。账号登录、多人游戏使用名称/头像、管理员强制下线或退出登录尚未与房间离开状态连接，容易出现房间仍认为用户在线、身份中途切换或其他成员看不到离开。

## Required outcome

把账号资料接入新建/加入房间的身份初始化，并实现可靠的退出编排：已有游客房间不切换；退出登录先尝试离开，任何网络结果都完成认证退出，并让本人和其他成员看到一致的离开/异常状态。现有游客多人流程保持兼容。

## In scope

- 新建/加入多人房间时从当前账号读取多人游戏使用名称和当前头像，生成账号身份；登录账号名称自动作为多人游戏使用名称的初始身份。
- 已有游客房间保持游客身份；登录/资料修改不回写正在进行的游客对局，身份切换只对之后新游戏生效。
- 账号退出流程与 `useRoom`/`RoomPage`/房间客户端状态协调：若在房间先调用 leave，再清理认证和房间本地状态，最后回到登录页。
- leave 成功、失败、超时和网络中断的统一处理：即使失败也完成退出，向本人提示“已退出登录，但房间状态同步异常”，服务端/WS 向其他成员显示该成员已离开。
- 停用账号、管理员强制下线或会话撤销触发的房间成员离开；保留现有 `left` 成员的快照/房间保留期语义。
- 账号头像/名称在房间投影和多人统计中只使用允许公开的资料，不传播密码、密保或会话令牌；断线重连不把游客令牌升级为账号身份。

## Out of scope

- 新的多人赛制、席位模型、聊天权限或重写房间事件流；沿用现有 `apps/api/internal/multi/` 规则。
- 登录/资料页面本身（USR-003、USR-004）、管理员操作页面（USR-006）。
- 账号注销、跨房间身份迁移或正在进行对局的中途换名。

## Likely code areas

- `apps/api/internal/handler/auth.go`、`apps/api/internal/handler/rooms.go`
- `apps/api/internal/multi/`、`apps/api/internal/hub/`
- `apps/web/src/hooks/useRoom.ts`、`apps/web/src/components/RoomPage.tsx`、`apps/web/src/components/RoomLobby.tsx`
- `apps/web/src/lib/api.ts`、多人状态/本地存储模块
- `contracts/openapi/openapi.yaml`、`contracts/ws/`（通过生成命令）
- `apps/api/internal/server/*multi*_test.go`、`apps/web/src/hooks/useRoom*.test.ts`

## Acceptance criteria

- [ ] 登录账号新建或加入房间时自动使用账号多人名称和头像；已有游客房间在登录、改名或换头像后不切换身份。
- [ ] 账号登出入口在房间内先发起 leave；leave 成功后正常退出，失败/网络中断仍清理认证并回登录页，同时本人看到异常提示。
- [ ] 其他成员在可用实时连接和重新载入快照两种情况下都看到该成员 `left`/离开状态；不会把离开成员错误显示为在线或可操作玩家。
- [ ] 停用账号、强制下线和会话撤销能触发同等成员离开处理；管理员强制自己下线回到登录页。
- [ ] 现有游客创建/加入/离开、断线重连和对局结算测试继续通过；账号身份不得泄露秘密字段。
- [ ] 退出期间的重复点击、页面刷新和 WS 断开不会恢复受保护页面，也不会发送重复或越权的房间命令。

## Test plan

- Go 房间集成测试：账号/游客身份初始化、停用/强制下线离开、leave 幂等和 `left` 事件投影。
- Web hook/组件测试：房间内登出成功、失败、超时、刷新和重复点击；目标页面/登录状态清理。
- 浏览器双会话测试：成员 A 退出，成员 B 通过实时事件和刷新快照都能看到离开；游客流程回归。
- `go test ./...`、前端测试、类型检查、构建和 WebSocket 契约生成检查。

## Dependencies and follow-ups

依赖认证/资料服务和前端认证外壳。完成后解除 `USR-008` 的跨域回归；任何未来“登录中途切换房间身份”的需求必须另立产品决策，不在本 Issue 扩展。
