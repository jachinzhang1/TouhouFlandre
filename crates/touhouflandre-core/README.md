# touhouflandre-core

纯 Rust 的角色猜测规则库。提供六字段比较、精确与等价命中，以及简单作答过程的状态推进。默认只依赖 `thiserror`，无需数据库、网络、异步运行时或界面框架。

这仍然是角色猜测规则库：字段包括初登场作品、年份、种族、阵营、地点和头发颜色。它没有把任意题材、任意多人玩法统一为一套通用游戏引擎。

## 使用

同一 workspace 的应用可以通过路径依赖使用：

```toml
touhouflandre-core = { path = "../../crates/touhouflandre-core" }
```

需要序列化语义类型时启用可选的 `serde` feature：

```toml
touhouflandre-core = { path = "../../crates/touhouflandre-core", features = ["serde"] }
```

从仓库根目录运行纯内存示例：

```sh
cargo run -p touhouflandre-core --example memory
```

示例把两个角色直接放入内存，指定答案，连续作答并自行输出反馈；不需要数据库或服务器。

```rust
use touhouflandre_core::{AnswerMatchPolicy, AttemptState, Catalog, Character};

fn main() -> Result<(), touhouflandre_core::Error> {
    let characters = [Character {
        id: "answer".into(),
        enabled_as_guess: true,
        ..Default::default()
    }];
    let catalog = Catalog::new(AnswerMatchPolicy::Strict, &characters)?;
    let state = AttemptState { limit: Some(6), ..Default::default() };
    let outcome = catalog.apply_guess(&state, "answer", "answer", None)?;
    assert!(outcome.guess.is_correct);
    assert!(outcome.state.closed);
    assert_eq!(state.used, 0); // 输入状态没有被修改。
    Ok(())
}
```

## 两层接口

`Catalog::evaluate_guess(answer_id, guess_id, fields)` 只判定一次猜测，不检查历史和剩余次数。它适合已有状态机的玩法，由调用者根据 `is_correct` 和 `match_kind` 继续推进状态。

`Catalog::apply_guess(state, answer_id, guess_id, fields)` 在判定前检查作答状态、重复 ID 和剩余次数，成功后返回 `AttemptOutcome { state, guess }`。它增加一次消耗、记录猜测 ID，并在猜对或次数用尽时关闭这一段作答。

`consume_attempt(state)` 只消耗一次机会，不添加猜测 ID。超时、空过是否应计次，由调用者决定；包内没有时钟或超时策略。

`AttemptState::limit = None` 表示不限制次数，`Some(0)` 表示没有可用次数。`used` 包括猜测与其他被调用者计次的动作，因此必须不小于历史 ID 数量。所有操作均返回新状态；校验错误不会修改输入。状态校验顺序是结构与计数溢出、是否关闭、重复猜测、次数限制，再验证题库中的角色。

这不是多人状态机。若某玩法使用双方共享的重复历史、每人独立的次数限制，或三次空过判负，应使用 `evaluate_guess` 并由自己的状态机处理。玩家、房间、回合切换、计分和排名不属于本包。

## 判定约定

- `Strict` 只接受相同 ID；`PublicFieldsV1` 额外接受完整六字段等价的可猜角色。
- `fields = None` 返回默认六字段反馈；`Some(&[])` 不返回字段反馈。显式字段的顺序与重复键会保留。反馈字段选择不会改变等价命中规则。
- 年份策略 `numberExact` 只返回精确或未命中，其余策略保留方向提示。方向状态描述答案相对猜测的年份位置。
- 空值、忽略首尾空白与 ASCII 大小写后的 `unknown`、`未知`，以及年份 `0`，均表示未知。集合中包含任何未知值时，整个字段视为未知。
- 已知字符串不做大小写折叠或去空格。集合按原字符串去重排序。初登场作品 ID 相同是精确匹配；ID 不同但已知媒介类型相同为部分匹配，媒介类型不参与等价分组。
- 等价分组使用结构化字段值，不依赖 JSON 编码。分组标识使用 `equivalent:` 加字典序最小的角色 ID；`distinct_ids_by_group` 保留调用者提供的第一个代表及其顺序。
- `match_answer` 是不验证角色存在性或可猜性的底层操作，相同 ID 始终为精确命中。正式提交猜测应使用 `evaluate_guess` 或 `apply_guess`。

## 调用者的职责

应用层负责加载与冻结题库、选题、权限、并发与事务、幂等请求、保存与恢复、隐藏答案，以及判断整场游戏是否结束。`Catalog` 在构建时复制比较所需事实，外部修改输入不会改变已创建的题库。

输出仅包含角色 ID、命中类型和字段状态，不包含名称、头像、中文标签、图标、箭头或展示值。调用者应以自己的题库和展示规则补全这些内容，并自行维护既有 HTTP、WebSocket 或存储格式。可选的 `serde` 不会引入应用的传输协议或数据库模型。

```sh
cargo test -p touhouflandre-core --no-default-features
cargo test -p touhouflandre-core --features serde
```
