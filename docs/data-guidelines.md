# 数据规范

本文规定 TouhouFlandre 题库的字段、标准化方式、来源要求和贡献流程。目标是让反馈结果可复现、可解释，并减少不同译名或设定解读造成的歧义。

## 收录范围

题库以《东方 Project》官方作品中可明确识别、具有稳定设定的角色为主。每条角色记录可以分别控制是否：

- 允许作为隐藏答案（`enabledAsAnswer`）。
- 允许作为玩家猜测（`enabledAsGuess`）。

资料不完整、身份存在重大争议或字段无法可靠核验的角色，可以保留为资料记录，但不应启用为答案。

## 数据文件

角色与作品数据位于 `packages/data/src`：

| 文件 | 用途 |
|---|---|
| `characters.demo.json` | 角色记录。 |
| `works.demo.json` | 作品记录。 |
| `schema.ts` | Zod 数据结构。 |
| `validate.ts` | 跨记录完整性校验。 |

所有 ID 必须稳定且唯一。已发布 ID 不应仅因译名调整而变化，否则会破坏历史会话和外部引用。

## Excel 编辑流程

角色与作品数据共享同一个 Excel 文件 `packages/data/src/catalog.demo.xlsx`，内含 `characters` 与 `works` 两张工作表：

| 命令 | 作用 |
|---|---|
| `pnpm --filter @touhouflandre/data xlsx:out` | 从 `characters.demo.json` 与 `works.demo.json` 生成 `catalog.demo.xlsx`（两张工作表）。 |
| `pnpm --filter @touhouflandre/data xlsx:in` | 从 `catalog.demo.xlsx` 的两张工作表分别校验并写回对应的 JSON。 |
| `pnpm --filter @touhouflandre/data xlsx:merge <base.json>` | 角色数据三方合并（见下文）。 |
| `pnpm --filter @touhouflandre/data xlsx:works:merge <base.json>` | 作品数据三方合并。 |

`catalog.demo.xlsx` 是生成物，已被 `.gitignore` 忽略，不提交到仓库；`xlsx:out` 前如已有手工编辑过的 xlsx，请先 `xlsx:in` 导回，再重新导出。

单元格规则：多值字段（如 `species`、`abilityTags`）用 `|` 分隔；布尔字段填写 `true/false`（也接受 `1/0/yes/no/是/否`）；可选字段留空表示无值，必填字段留空或填非法值会在导回时被 schema 校验拒绝。导回前请先运行「内容贡献检查」。

三方合并用于「Excel 是从旧版本 JSON 导出、工作区 JSON 已前进、Excel 只包含对既有记录的手工编辑」的场景：`base.json` 是导出那份 Excel 时的旧 JSON；合并仅应用 Excel 相对 base 有变化的单元格，不会用陈旧列覆盖上游对同一记录的新改动。合并只影响对应数据集的工作表与 JSON 文件。

## 角色字段

| 字段 | 必填 | 用途 |
|---|---|---|
| `id` | 是 | 稳定的机器可读标识。 |
| `avatarUrl` | 是 | 仓库内角色肖像的公开访问路径。 |
| `names` | 是 | 多语言名称、罗马字与别名。 |
| `firstAppearance` | 是 | 初登场作品 ID。 |
| `species` | 是 | 标准化种族集合。 |
| `abilityDisplay` | 是 | 面向玩家展示的能力说明。 |
| `abilityTags` | 是 | 用于能力归类和规则扩展的标准化标签。 |
| `affiliations` | 是 | 阵营或稳定组织关系。 |
| `locations` | 是 | 主要活动或居住地点。 |
| `roles` | 是 | 主角、Boss 等角色定位。 |
| `hairColors` | 是 | 标准化发色集合。 |
| `playable` | 是 | 是否曾作为自机角色。 |
| `difficultyTier` | 是 | 题库难度分层。 |
| `sourceRefs` | 是 | 支撑该记录的来源链接。 |

字段 TypeScript 定义以 `packages/shared/src/types.ts` 为准，运行时校验以 `packages/data/src/schema.ts` 为准。

## 名称与搜索

名称字段既用于展示，也是角色搜索词元的主要来源：

| 数据 | 搜索行为 | 维护要求 |
|---|---|---|
| `names.zhHans` | 独立搜索简体中文名，并作为主显示名。 | 使用项目采用的稳定简体译名。 |
| `names.zhHant` | 独立搜索繁体中文名。 | 有明确繁体写法时填写，不用简体值占位。 |
| `names.ja`、`names.en`、`names.romaji` | 分别搜索日文名、英文名和罗马字。 | 保留各字段对应的语言或转写形式。 |
| `names.aliases` | 每个数组项都是独立搜索词元。 | 只收录社区稳定使用的别名、简称或明确维护的角色缩写。 |
| `firstAppearance.workId` | 派生作品中文标题、作品 ID、正作编号和作品拼音首字母。 | 作品级搜索数据统一维护在作品记录中，不在每个角色上重复填写。 |

搜索会分别归一化查询和每个词元，再执行连续子串匹配；不同词元不会首尾拼接，也不会通过空格拆词后跨字段组合。需要增加稳定检索词时，应补充语义对应的名称、别名或作品数据。角色 `id` 是内部标识，不是默认搜索字段；若某个面向玩家的称呼与 ID 相同，仍应将它明确记录为名称或别名。完整匹配规则见[架构说明](./architecture.md#匹配模型)。

贡献名称数据时应遵循：

- 不把临时昵称、梗或主观称呼写入正式名称。
- 不在多个字段重复同一字符串。
- 别名不得包含侮辱性或可能造成误解的内容。
- 译名调整必须在 Issue 或 PR 中写明依据。

## 作品与初登场

初登场应指角色首次在官方作品中被明确呈现的作品。角色记录只保存 `workId`，指向作品表中的稳定 ID。用于反馈和搜索的作品标题、媒介、发布年份、正作编号、时代与拼音首字母由 `packages/data` 在加载时从作品记录自动派生，避免同一作品资料在多个角色中重复维护。

作品的 `pinyinInitials` 是必填数组，用于维护中文标题的稳定拼音首字母检索词。填写时遵循以下规则：

- 只使用小写 ASCII 字母和数字；
- 同一作品内不得重复，不同作品也不得使用完全相同的缩写；
- 通常同时收录去掉“东方”的常用缩写和完整标题缩写，例如《东方红魔乡》在 JSON 中填写 `["hmx", "dfhmx"]`，在 Excel 中填写 `hmx|dfhmx`；
- 根据正式标题、惯用简称和消歧需要人工确认，不从中文标题自动生成。

拼音首字母会在 seed 时展开进角色快照。因此新增或修改缩写后必须重新 seed；新题库版本立即可用，已经开始的单人会话和多人场次继续使用旧快照，不会被追溯修改。

作品 `type` 用于“初登场作品”反馈的同类媒介部分匹配；可填写 `ftg`、`stg`、`print`、`music_cd`、`other`，旧版泛用游戏值 `game` 为兼容历史数据保留。

客串、背景出现、后续设定补充等边界情况应在 Issue 或 PR 中给出来源与判定理由。

## 多值字段

`species`、`abilityTags`、`affiliations`、`locations`、`roles` 和 `hairColors` 均采用数组。写入时应使用统一词汇，避免同义词被误判为不同值。

公开反馈中的多值字段为 `species`、`affiliations`、`locations` 和 `hairColors`，比较时遵循集合规则：

- 集合完全相同：完全匹配。
- 存在至少一个相同值：部分匹配。
- 没有交集：不匹配。

## 难度分层

`difficultyTier` 用于管理答案池，不代表角色强度：

| 值 | 收录原则 |
|---|---|
| `easy` | 主要主角或辨识度很高的角色。 |
| `normal` | 正作中的常见角色，资料较完整。 |
| `hard` | 出场较少或需要更多作品知识的角色。 |
| `lunatic` | 书籍、音乐 CD 等较深范围的角色。 |
| `extra` | 仅在旧作中登场的角色。 |

难度调整应基于题库区分度和实际游玩反馈，不应仅按个人印象决定。

题库预设的标签、说明、选池范围和规则集中定义在
`packages/shared/src/questionScope.ts` 的 `QUESTION_DIFFICULTY_PRESET_DEFINITIONS`；
服务端权威规则集中定义在 `apps/api/internal/game/question_scope.go` 的
`questionScopePresetDefinitions`。增删预设时还应同步 OpenAPI 枚举并重新生成契约类型。
每日题可用难度由共享层的 `DAILY_QUESTION_DIFFICULTY_PRESETS` 与服务端定义中的
`AvailableInDaily` 独立控制；Extra 当前不开放每日题。

## 来源与争议处理

每条角色记录必须包含至少一个可公开访问的来源。来源优先级如下：

1. 官方作品、设定文档与官方出版物。
2. 官方新闻或创作指南。
3. 具有明确引用的社区资料库。
4. 其他可核查的二手资料。

发生冲突时，保留可信度更高且更接近原始材料的说法。若无法得出稳定结论，应缩减字段精度、使用更宽泛的标准化值，或暂时关闭该角色的答案资格。不要用投票结果代替来源判断。

## 内容贡献检查

提交题库更新前应完成以下检查：

1. 运行 `pnpm --filter @touhouflandre/data typecheck`。
2. 运行 `pnpm --filter @touhouflandre/data validate`。
3. 确认角色记录引用的 `workId` 已存在。
4. 确认 ID、名称、别名和作品拼音缩写没有冲突。
5. 确认 `avatarUrl` 指向 `apps/web/public/characters` 中存在的文件。
6. 运行 `task db:seed`，确认角色及头像出现在搜索页，并用新增的名称、别名或作品缩写验证检索结果。
7. 运行 `pnpm test` 与 `cd apps/api && go test ./...`。
8. 在 Issue 或 PR 中列出涉及字段的资料来源。
9. 对会影响反馈结果的更新补充或调整比较逻辑测试。

纯排版或译名修正也应保持 JSON 格式稳定，避免夹带无关字段重排。

## 图像与版权

角色像素头像来自苗库里的“东方全角色像素肖像素材包”。素材存放在 `apps/web/public/characters`，详细授权与署名信息见 [`THIRD_PARTY_ASSETS.md`](../THIRD_PARTY_ASSETS.md)。这些图片不适用仓库的 MIT 许可证，版权仍归原作者所有。

首页视觉素材、平台图标和其他第三方资源也必须记录在 [`THIRD_PARTY_ASSETS.md`](../THIRD_PARTY_ASSETS.md)。不得引入原作提取图片、游戏截图或来源不明的同人图片。引入图像资源时，必须同时记录作者、原始地址、许可证与必要署名方式，并确认许可证允许仓库分发和网站使用。

TouhouFlandre 是非官方同人项目。使用名称和设定时应遵守[东方 Project 二次创作指南](https://touhou-project.news/guideline/)，并在站点和发行物中保留非官方声明。

## 参考资料

- [东方 Project 官方新闻站](https://touhou-project.news/)
- [东方 Project 二次创作指南](https://touhou-project.news/guideline/)
- [Touhou Wiki 角色列表](https://en.touhouwiki.net/wiki/Characters)
