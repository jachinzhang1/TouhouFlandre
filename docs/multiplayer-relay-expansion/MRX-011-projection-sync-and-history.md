# MRX-011：完成多 encounter 投影、同步与按需历史 API

**类型**：功能/协议/安全 Issue  
**优先级**：P0  
**依赖**：MRX-009  
**建议标签**：`type:feature` `area:api` `area:contracts` `area:websocket` `area:security`

**决策依据**：[投影、能力与页面状态](./decisions.md#16-投影能力与页面状态)、[历史与负载边界](./decisions.md#17-历史与负载边界)、[契约与 WS v3](./decisions.md#15-契约与-ws-v3)

## 要解决的问题

玩法后端完成后，客户端仍需要一套不会泄露答案、不会因并发事件错序、也不会把所有历史棋盘塞进 snapshot 的读模型。当前 relay projection 只返回单一 shared board，当前 round archive 也不适合长期累积多张完整棋盘。

## 要做到什么程度

- 以 capability 而非单纯 role 投影 paired、encounter-ended、bye、near-death、eliminated、left 和 spectator。
- relay 所有查看者获得当前 stage 全部 encounter 的完整 turn/标签；只有 viewer 自己的活动 encounter 可能拥有动作 capability。
- 进行中 encounter 永不投影 answer；terminal encounter 返回 answer 和 outcome；同一投影函数供 realtime、replay、snapshot 和 history 复用。
- snapshot 返回 current stage、encounter summaries/details、standings、participant states、紧凑 stage summaries 和 sequence 水位，不嵌入无界完整历史。
- 增加分页 stage history 与终态 encounter detail API，使用不透明 cursor/稳定索引并在每次请求重新鉴权。
- WS v3 为 encounter 增量事件保留全房间连续 sequence；客户端可从任意断点 replay，缺口仍由 snapshot 补齐。
- 控制单事件/快照大小，历史查询按需水合角色与标签，避免 N×stage 全量 fan-out。

## 属于本 Issue

- API/WS/snapshot/history projector、DTO、授权、cursor/分页和 generated types。
- `encounter.*`、`stage.*` 事件的观察者投影、cursor frame、replay 和 reconnect tests。
- answer/token/跨房间 ID 泄漏测试、payload size 与查询数量基线。
- 供 Web 使用的 selector/domain reducer 基础类型，但不实现最终布局。

## 不属于本 Issue

- 不改变 pairing、turn、scoring 或 lifecycle 结果。
- 不将 relay 套用 race 匿名矩阵；完整标签是冻结需求。
- 不把聊天并入 game sequence，也不修改 chat channel。
- 不实现页面分页、提示和排行榜组件。

## 验收标准

- player、bye、eliminated 和 spectator 均能看到所有 relay 棋盘完整标签；任何人都看不到未结束 encounter 的答案字段。
- 非 encounter 成员即使伪造 encounterId 也只能读取授权视图，不能获得动作 capability 或提交动作。
- 一张棋盘的 turn 只更新该 encounter；其他棋盘的 React/domain state 不被清空或覆盖。
- 并发 encounter 事件拥有唯一递增 room sequence；断线、乱序、重复、真正缺口和 snapshot 对齐测试通过。
- 新连接只靠 snapshot + replay 可恢复当前 turn、各棋盘终态、bye、积分、濒死/淘汰与 stage barrier 等待状态。
- 100 个历史 stage fixture 下 snapshot 大小不随完整 turn 总量线性增长；历史分页无重复/遗漏，terminal answer 权限正确。
- v2 客户端被明确拒绝并获得刷新原因；v3 game-only/chat-capable 连接均保持原同步屏障。

## 可能涉及的代码

`apps/api/internal/multi/{projection.go,relay_projection.go,public_collections.go}`、`apps/api/internal/handler/{snapshot.go,ws.go}`、新增 history handler、`apps/api/internal/hub/`、`contracts/openapi/`、`contracts/ws/protocol.yaml`、`packages/shared/src/multi.ts`、`apps/web/src/hooks/useRoom.ts` 的协议 reducer 与同步测试。
