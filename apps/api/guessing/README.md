# guessing

`guessing` 是可复用的角色猜测规则包，只依赖 Go 标准库。题库、答案和作答状态由调用方以普通 Go 值传入，包负责判定一次猜测并推进一次作答序列，无需数据库、HTTP 服务或多人房间。

本包位于现有 [Go module](../go.mod) 内，尚未拆为独立 module，也没有独立发布版本。其他 Go 项目使用包含本包的模块版本后，可通过以下路径导入；本地开发也可将该 module 替换为本仓库的 `apps/api` 目录：

```go
import "github.com/TouhouFlandre/touhouflandre/apps/api/guessing"
```

## 纯内存调用

在函数内运行以下片段，除 `guessing` 外还需导入标准库 `fmt`：

```go
catalog, err := guessing.NewCatalog(guessing.AnswerMatchStrict, []guessing.Character{
    {ID: "early", EnabledAsGuess: true, FirstAppearance: guessing.FirstAppearance{ReleaseYear: 1997}},
    {ID: "middle", EnabledAsGuess: true, FirstAppearance: guessing.FirstAppearance{ReleaseYear: 1998}},
    {ID: "target", EnabledAsGuess: true, FirstAppearance: guessing.FirstAppearance{ReleaseYear: 2002}},
})
if err != nil {
    panic(err)
}

state := guessing.AttemptState{Limit: 3}
fields := []guessing.FieldRule{
    {Key: guessing.FieldReleaseYear, CompareStrategy: "numberDirection"},
}
for _, guessID := range []string{"early", "middle", "target"} {
    outcome, err := catalog.ApplyGuess(state, "target", guessID, fields)
    if err != nil {
        panic(err)
    }
    state = outcome.State
    fmt.Println(state.Used, outcome.Guess.Feedback[0].Status, outcome.Guess.IsCorrect, state.Closed)
}
```

输出只包含作答进度和反馈：

```text
1 higher false false
2 higher false false
3 exact true true
```

完整的可执行示例见 [example_test.go](./example_test.go)，其中也包含不维护作答历史的 `Catalog.Evaluate` 用法。

## API 与状态约定

| API | 职责 |
| --- | --- |
| `NewCatalog(policy, characters)` | 校验 ID 和策略，深拷贝输入，建立不可变的题库与等价组；构建后可并发读取。 |
| `Catalog.Evaluate(answerID, guessID, fields)` | 检查猜测存在且可猜，检查答案存在，返回命中类型和字段反馈；不管理历史或次数。 |
| `Catalog.ApplyGuess(state, answerID, guessID, fields)` | 检查作答序列、重复角色 ID 和额度，接受猜测后返回新状态；只有接受的猜测消耗次数。 |
| `ConsumeAttempt(state)` | 消耗一次额度，返回新状态，不追加角色 ID；由调用方先判断超时、空过等动作是否应计数。 |
| `Catalog.Match(answerID, guessID)` | 对已知 ID 做底层答案判定，不检查是否存在或可猜；接收用户提交时使用 `Evaluate` 或 `ApplyGuess`。 |

`AttemptState` 描述调用方划定的一段作答序列：

- `GuessedIDs` 决定重复检测范围；历史与次数必须属于同一段作答序列，例如单人会话或当前玩家的作答记录。
- `Used` 计入已接受猜测和由调用方确认消耗的其他动作，因此可以大于 `len(GuessedIDs)`。`Used` 与 `Limit` 均不得为负，`Used` 不得小于历史长度。
- `Limit == 0` 表示不限次数；正数表示该序列的总额度。
- 命中或额度耗尽后，返回状态的 `Closed` 为 `true`。它只关闭这段作答序列，不代表房间、整场比赛或其他玩家的作答结束。调用方也可因外部原因主动关闭序列。

`ApplyGuess` 和 `ConsumeAttempt` 都不会修改输入状态或其历史切片。调用方应在成功后保存返回的新状态；遇到错误时保留原状态。二者不读取时钟、不调度超时、不执行 I/O。重复提交按角色 ID 判断，不按等价组判断。

`ApplyGuess` 先检查序列，再检查题库。需要保持既有业务错误优先级时，可以先调用 `Catalog.ValidateGuess` 检查角色，或在加载题库前调用 `AttemptState.ValidateGuess` 检查历史与额度。题库验证、作答状态验证不能替代外层鉴权及事务内的并发校验。

## 首版规则

当前固定支持六个角色字段：初登场作品、初登场年份、种族、阵营、地点和头发颜色。它们由 `DefaultFields()` 按稳定顺序返回。扩展到歌曲、物品等题材的规则接口不在本次提取范围内。

- `strict` 仅接受相同角色 ID；`public_fields_v1` 也接受六字段规范值完全一致的角色。
- 等价组只包含 `EnabledAsGuess` 且六字段全部已知的角色；集合值会排序、去重，缺失值或 `unknown` / `未知` 不建立等价关系。已知字符串保留原始拼写。
- `fields == nil` 使用全部默认字段；非 nil 的空切片返回空反馈；显式列表保留顺序。选择哪些反馈字段不会改变完整六字段的答案等价判定。
- 对已知年份，`numberExact` 策略只返回相同或不匹配；默认 `numberDirection` 中，`higher` / `lower` 指向答案相对于猜测的年份方向。任一侧年份未知时仍返回 `unknown`。
- 答案池由调用方选择。包不要求可猜角色必须属于答案池。

结果只有角色 ID、命中类型和字段状态，没有答案对象、角色名称、头像、中文标签、颜色或箭头。调用方负责把语义结果转换成网页、命令行或其他展示形式。

## 与应用的边界

外层负责题库来源和版本、答案选择、保存与恢复、鉴权、并发控制、幂等重试、时钟、多人轮次与计分，以及结果显示。共享同一份 `AttemptState` 的并发写入仍需由调用方通过事务、锁或版本检查协调；不可变题库不提供会话存储或并发提交控制。

本项目通过以下应用层接入：

- `internal/catalog` 从数据库读取版本化题库快照。
- `internal/game` 保留字段配置、加载缓存、应用数据转换和展示适配，猜测计算委托给 `guessing`。
- 单人业务层使用 `ApplyGuess` 和 `ConsumeAttempt` 推进会话作答状态，并保存结果。
- 竞速和接力通过 `Evaluate` 复用判定，继续由各自的状态机管理历史、额度、轮次和结束条件。尤其是共享棋盘历史与个人额度，不能直接混入同一个 `AttemptState`。

原 API 响应和数据库序列化继续由应用适配层维护，本包的类型不作为新的 HTTP 或存储格式。更多说明见[架构说明](../../../docs/architecture.md)和[开发指南](../../../docs/development.md)。

## 独立验证

在 `apps/api` 下运行以下命令，不需要 Postgres、种子题库或前端：

```bash
go test ./guessing
go test ./guessing -run Example
```
