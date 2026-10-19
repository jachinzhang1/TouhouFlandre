# TouhouFlandre core 提取记录

本项由 2026-10-18 用户指令“开始提取，你管 rust 版就行”授权，仅修改
`wtf/rust-rewrite-everything-belike` 的 Rust worktree。基线为 `411426b`；原 Go
checkout 不在范围内。变更可通过撤销本项代码恢复，不修改数据库结构或运行数据。

## 范围与完成条件

- 新增可独立使用的 `crates/touhouflandre-core`，以普通值接收角色、规则和作答状态；
  不依赖数据库、异步运行时、HTTP、房间、玩家或展示组件。
- 字段比较、答案等价、重复检查和作答额度只保留一份规则实现。
- API 适配层继续维护既有 JSON、字段顺序、历史记录兼容、名称与头像。
- 单人使用作答状态推进；竞速和接力共用判定，保留各自历史范围、个人额度和结束规则。
- 事务、锁、幂等检查、时钟采样和提交后发布顺序保持不变。
- 包的纯内存测试与示例、现有规则和接口测试、独立 PostgreSQL 集成、格式、Clippy
  和依赖边界检查通过。

## 执行分工

- 规则包：`crates/touhouflandre-core/**`，含测试、示例与使用说明。
- 兼容验证：新增 API 适配器黄金样例测试，固定提取前的输出。
- 边界验证：扩展现有架构检查及负例。
- 协调者：Cargo 配置、应用适配、单人接入、错误传播、构建配置与文档，最后统一验证。

## 验证记录

下表记录原提取阶段的验证，命令中的包名已按用户后续要求统一为 `touhouflandre-core`。

状态：完成。证据来自本次变更，运行环境为本机 Rust 1.99.0；PostgreSQL 使用本地
5433 端口的开发数据库服务，以 `postgres` 为管理连接，为每个集成用例创建并清理
UUID 命名的独立数据库。

| 检查 | 结果 |
| --- | --- |
| `cargo test -p touhouflandre-core --no-default-features --locked --offline` | 20 项规则/作答测试和 1 项文档测试通过。 |
| `cargo test -p touhouflandre-core --features serde --locked --offline` | 上述测试及 3 项序列化测试通过。 |
| `cargo run -p touhouflandre-core --example memory --locked --offline` | 无数据库、无服务运行的两次作答示例通过。 |
| `cargo test --workspace --locked --offline -- --include-ignored` | 154 项测试通过（130 项 API、23 项核心包测试及 1 项文档测试），无忽略项。 |
| `cargo fmt --all --check` | 通过。 |
| `cargo clippy --workspace --all-targets --locked --offline -- -D warnings` | 通过。 |
| `cargo build --workspace --release --locked --offline --bins` | 原生 release 二进制构建通过。 |
| `pnpm check:multiplayer-boundaries` | 17 项守卫测试及 89 个 Rust 文件边界检查通过。 |
| `pnpm check:rust-contracts` / `pnpm check:ws-protocol` | 305 个 DTO、32 个 operation 及 WebSocket 契约检查通过。 |
| `pnpm typecheck` / `pnpm test` | TypeScript 类型检查及 408 项测试通过。 |

兼容基线保存在 `apps/api/tests/fixtures/guessing-api-before-extraction.json`：
9 份完整响应在替换判定实现前捕获，覆盖字段选择、顺序、重复字段和显示数据。
应用适配测试另覆盖旧 JSON 签名、完整状态数组与可见列映射、接力历史和 HTTP/event
区分；集成回归覆盖重复/无效猜测不计次、超时与陈旧重放、次数耗尽和最后一手命中。
错误测试确认核心错误可通过 source 检查且角色 ID 不进入 HTTP 错误或诊断日志。

独立审查发现应用快照原先公开可变的字段可能与核心快照脱节，已改为只读访问器。
已有事务、幂等、锁、时钟采样和提交后发布代码保持原有顺序。默认核心依赖树仅含
`thiserror` 及其过程宏；CI 增加独立无 feature 测试，生产 Dockerfile 增加 crate 源码。
未运行 Docker 应用构建或浏览器 E2E；本项验证范围是原生构建、服务集成及既有前端测试。

## 包名调整

按用户要求将包名、目录、Rust 导入名、锁文件、构建/CI、架构守卫及文档统一为
`touhouflandre-core` / `touhouflandre_core`，未变更规则行为。更名后重新通过工作区
全部目标编译、核心包默认及 serde 测试、27 项 API 规则/适配测试、17 项架构守卫测试
和格式检查。原提取阶段的数据库、前端和 release 验证未重复运行。
