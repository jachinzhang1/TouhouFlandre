# MPX-010 发布闸门清单

本文记录多人扩展默认开放前必须完成的本地验收、灰度开关、安全审计和回滚步骤。MPX-010 不是新规则设计入口；发现语义冲突时回到对应 MPX-002A 至 MPX-009 修正。

## 发布状态

| 项目                   | 状态             | 记录                                                             |
| ---------------------- | ---------------- | ---------------------------------------------------------------- |
| 代码默认暴露           | 已开启           | 后端与前端 flag 默认开启 N 人创建和聊天入口/发送；回滚时显式关闭 |
| 灰度公告               | 草稿已入库       | `docs/multiplayer-expansion/user-announcement-draft.md`          |
| 正式公告               | 待默认开放时发布 | 发布时更新公告正文和发布时间                                     |
| Postgres 升级/回滚演练 | 待执行           | 记录测试库连接、开始/结束时间、迁移版本和结果                    |
| 并发压力演练           | 待执行           | 记录错误率、p95 延迟、消息丢弃策略和样本规模                     |
| 安全审计               | 待执行           | P0/P1 必须为 0；P2 需负责人和后续 Issue                          |

## 灰度开关

默认值必须保持开启；灰度暂停或回滚时按能力分别关闭。关闭开关只能阻止新的暴露面，不能破坏已有 v2 房间的安全结束和授权历史读取。

| 环境变量                                  |   默认 | 作用                                                     |
| ----------------------------------------- | -----: | -------------------------------------------------------- |
| `MULTI_N_PLAYER_RACE_ENABLED`             | `true` | 后端允许新建/调高 `playerLimit > 2` 的 race 房间         |
| `NEXT_PUBLIC_MULTI_N_PLAYER_RACE_ENABLED` | `true` | Web 创建页显示 2..8 人 race 上限控件并提交 `playerLimit` |
| `MULTI_CHAT_SEND_ENABLED`                 | `true` | 后端允许写入新的房间聊天消息                             |
| `NEXT_PUBLIC_MULTI_CHAT_UI_ENABLED`       | `true` | Web 房间页挂载聊天入口                                   |
| `NEXT_PUBLIC_MULTI_CHAT_SEND_ENABLED`     | `true` | Web 聊天入口启用输入框和表情发送控件                     |

显式开启示例（与默认行为一致）：

```bash
MULTI_N_PLAYER_RACE_ENABLED=true
NEXT_PUBLIC_MULTI_N_PLAYER_RACE_ENABLED=true
MULTI_CHAT_SEND_ENABLED=true
NEXT_PUBLIC_MULTI_CHAT_UI_ENABLED=true
NEXT_PUBLIC_MULTI_CHAT_SEND_ENABLED=true
```

关闭 `MULTI_N_PLAYER_RACE_ENABLED` 后：

- 新创建 race 房间只能使用默认双人上限；
- lobby 房主不能把 `playerLimit` 调到 3..8；
- 已经存在的 N 人房间仍按数据库中的 `playerLimit` join、ready、guess、forfeit、finish 和读取 snapshot。

关闭 `MULTI_CHAT_SEND_ENABLED` 后：

- 新聊天发送返回 `CHAT_SEND_FORBIDDEN`；
- Web 可保持聊天入口和历史可读，但应关闭输入框和表情发送控件；
- 聊天历史读取、授权投影和房间对局流程不受影响；
- 已持久化消息仍按 player/spectator channel 权限读取。

## 自动化闸门

项目命令在 WSL 环境运行；git 操作仍按协作约定在 Windows 侧进行。

```bash
pnpm lint:openapi
pnpm check:openapi-refs
pnpm check:ws-protocol
pnpm typecheck
pnpm test
cd apps/api && go test ./...
task check:generated
pnpm --filter @touhouflandre/web build
```

多人浏览器矩阵：

```bash
MULTI_N_PLAYER_RACE_ENABLED=true \
MULTI_CHAT_SEND_ENABLED=true \
NEXT_PUBLIC_MULTI_N_PLAYER_RACE_ENABLED=true \
NEXT_PUBLIC_MULTI_CHAT_UI_ENABLED=true \
NEXT_PUBLIC_MULTI_CHAT_SEND_ENABLED=true \
pnpm --filter @touhouflandre/web test:e2e -- e2e/multiplayer.spec.ts
```

浏览器矩阵必须覆盖：

- race 2/3/4/8 人 lobby、playing、finished、mobile；
- relay 两人共享棋盘；
- spectator、claim-seat、断线重连、refresh restore、finished retention；
- player/spectator 聊天可见性、纯文本渲染、闭麦不接收/不回放；
- 单局放弃、对局离场、guess/forfeit/send 并发边界。

## 迁移与回滚演练

升级演练使用真实 Postgres 测试库：

1. 记录演练库 URL 别名、当前迁移版本和开始时间。
2. 备份测试库或创建一次性演练库。
3. 执行 `go tool goose -dir apps/api/migrations up`。
4. 运行 `cd apps/api && go test ./...` 与 `task check:generated`。
5. 仅在一次性测试库验证 `down`，记录可恢复到的版本和数据影响。
6. 生产应用回滚不执行 destructive down；保留 expand schema、新 member/score/chat 数据和 v2 room 读取能力，通过 flag 关闭新入口。

回滚顺序：

1. 关闭 `NEXT_PUBLIC_MULTI_N_PLAYER_RACE_ENABLED` 和 `NEXT_PUBLIC_MULTI_CHAT_UI_ENABLED`，重新发布 Web。
2. 关闭 `MULTI_N_PLAYER_RACE_ENABLED` 和 `MULTI_CHAT_SEND_ENABLED`，重启 API。
3. 保留 v2 WS、snapshot 和 chat history 读取，让已有房间自然结束或由房主关闭。
4. 公告渠道同步标记为灰度暂停或回滚，避免用户说明与线上能力不一致。

## 安全审计

发布前逐项记录结论：

- 玩家视图不泄漏对手角色名、标签值、答案或未授权棋盘字段。
- spectator 消息不向 player 投影；spectator claim-seat 后旧连接失效，重连 player 不恢复 spectator channel。
- 聊天内容按纯文本渲染，HTML/XSS payload 不进入 DOM。
- 日志、错误响应、WS frame、前端 DOM 和本地统计导出不包含 guest token、token hash、内部权限数据或房间成员身份。
- chat cursor 为服务端签发的不透明值；伪造、跨房间、越过高水位和过期 cursor 稳定拒绝或要求 resync。
- join/claim-seat/final-ready/playerLimit、guess/forfeit/send 和 spectatorCap 并发结果符合房间行锁提交顺序。
- 慢消费者、WS 队列满、服务重启和 `sync.complete` 前断线不会造成授权消息丢失；重复帧只渲染一次。

## 指标与告警

灰度期间至少观察下列指标或等价日志聚合：

- `roomsByStatus`、`membersByStatus`、`activeRounds`：房间和成员终态是否堆积；
- `wsConnections`、`reconnectsTotal`：重连风暴和连接泄漏；
- `guessLatency.p95`：guess/forfeit 事务是否退化；
- `chatMessages{channel,kind}`：聊天流量是否异常；
- `chatRejected{code}`：限流、flag 关闭和格式错误是否符合预期；
- `chatProjection{path}`：history/replay 投影失败必须为 0。

建议灰度阈值：

- API 5xx 或 WS 非预期关闭率连续 10 分钟高于 1%：暂停扩大灰度；
- `chatProjection` 出现非 0：立即关闭聊天发送并保留历史读取；
- `guessLatency.p95` 高于 1500ms 且持续 10 分钟：关闭 N 人创建并排查数据库锁等待；
- 发现 P0/P1 越权：立即关闭相关 flag，公告同步回滚状态。
