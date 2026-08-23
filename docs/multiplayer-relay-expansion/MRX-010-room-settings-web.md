# MRX-010：交付接力创建页与大厅配置体验

**类型**：功能/Web Issue  
**优先级**：P1  
**依赖**：MRX-004  
**建议标签**：`type:feature` `area:web` `area:a11y` `area:test`

**决策依据**：[房间配置与开局](./decisions.md#3-房间配置与开局)、[灰度与可观测性](./decisions.md#18-灰度与可观测性)

## 要解决的问题

创建页只在 race 显示 2..8 连续人数滑杆，大厅把 relay 写成“固定 2 人”，也没有淘汰设置或奇数人数阻塞反馈。需要复用稳定控件原语，同时为 relay 暴露独立的模式设置；不能复制 race 表单布局，也不能让两个模式共享同一份淘汰语义、草稿状态或说明文案。

## 要做到什么程度

- 抽取可复用的 `PlayerLimitControl`，由 mode-specific form adapter 提供 allowed values、min/max/step；race 保持 step 1，relay 使用 step 2。
- 创建 relay 时显示 2/4/6/8 人上限滑杆和一个明确的淘汰 `switch`；默认关闭。
- switch 可复用无业务含义的控件 primitive，但 race 绑定 `raceEliminationEnabled`，relay 绑定 `relayEliminationEnabled`；切换 mode 时清理或隔离另一模式草稿。
- 房主大厅可在服务端允许时修改两项设置，使用单次原子 PATCH；请求期间禁用并以权威响应回填。
- 有人 ready 后控件锁定；奇数 roster 全员 ready 时显示服务端 `startBlockedReason`，不伪造倒计时。
- 大厅人数/空席/观战/准备列表复用现有 N 人布局，移除 relay “固定 2 人”的硬编码。
- feature flag 关闭时隐藏 N 人控件并维持双人 relay；后端拒绝仍是最终保护。
- 控件具备 label、value output、键盘操作、focus、disabled 和错误 live region。

## 属于本 Issue

- `MultiLobby` 创建表单、`RoomLobby` 房主设置、共享人数/无语义 switch primitive 和 mode-specific setting section。
- API client、表单状态、错误映射、rollout config 和组件/Playwright 测试。
- 2/4/6/8 人大厅的桌面/移动视觉基线。

## 不属于本 Issue

- 不实现游戏中棋盘、积分、轮空或最终排名；MRX-012 负责。
- 不在前端重新判断能否开局；只根据权威 room projection 展示。
- 不改变 race 的控件范围和积分赛说明。
- 不把 `RaceEliminationSwitch` 的竞速人数判断或文案直接用于 relay；仅可下沉无玩法语义的展示 primitive。
- 不在 flag 关闭时发送隐藏的多人 relay 设置。

## 验收标准

- relay 滑杆只能产出 2/4/6/8，键盘方向键步进 2；race 仍可产出 2..8 的每个整数。
- 创建与大厅 relay switch 默认/保存/刷新/重连状态一致；请求只发送 `relayEliminationEnabled`，实际 2 人开局时 UI 结果仍显示传统 BO。
- 设置请求原子失败时两项本地草稿不会部分显示为已应用，错误可被辅助技术读出。
- 奇数玩家、存在未准备/离线玩家、配置锁定和 settings 竞争均展示服务端权威状态。
- 8 人昵称、ready 状态、空席与 spectator 数在桌面/移动无重叠和横向页面溢出。
- flag 关闭后双人 relay 创建/大厅/ready 流程与当前版本相同。
- race 设置组件测试在 relay Web module 未启用时仍全部通过；两种开关同页切换不会相互污染。

## 可能涉及的代码

`apps/web/src/components/{MultiLobby.tsx,RoomLobby.tsx,PlayerLimitControl.tsx}`、mode-specific room settings components、`apps/web/src/config/multiplayerRollout.ts`、transport DTO adapter、相关 component/e2e tests。
