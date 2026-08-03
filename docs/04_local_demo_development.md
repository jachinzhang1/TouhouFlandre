# 本地开发指南

本文面向希望在本地运行、调试或贡献东方角色芙一把（TouhouFlandre）的开发者。

## 环境要求

- Node.js 20 或更高版本；
- pnpm 11；
- Git；
- 可写的本地目录用于 SQLite 数据库。

仓库使用 pnpm workspace。请在仓库根目录执行本文命令。

## 安装与启动

```bash
pnpm install
pnpm db:push
pnpm seed
pnpm dev
```

默认服务地址：

- Web：`http://localhost:5173`
- API：`http://localhost:4000`
- 健康检查：`http://localhost:4000/api/health`

`pnpm dev` 会同时启动 API 与 Web。开发服务器支持热更新，Vite 会把 `/api` 请求代理到本地 API。

## 环境变量

将 `.env.example` 复制为 `.env` 后按需修改：

| 变量                | 作用                      | 默认值              |
| ------------------- | ------------------------- | ------------------- |
| `DATABASE_URL`      | Prisma 使用的 SQLite 地址 | 见 `.env.example`   |
| `API_PORT`          | API 监听端口              | `4000`              |
| `VITE_API_BASE_URL` | Web 请求的 API 根地址     | 空，使用同源 `/api` |

不要提交 `.env`、本地数据库或包含凭据的日志文件。

## 常用命令

| 命令                                         | 说明                         |
| -------------------------------------------- | ---------------------------- |
| `pnpm dev`                                   | 同时启动 Web 与 API          |
| `pnpm build`                                 | 构建所有 workspace 包        |
| `pnpm test`                                  | 运行共享游戏逻辑测试         |
| `pnpm typecheck`                             | 对所有包执行 TypeScript 检查 |
| `pnpm db:generate`                           | 生成 Prisma Client           |
| `pnpm db:push`                               | 初始化或更新本地数据库结构   |
| `pnpm seed`                                  | 导入演示题库                 |
| `pnpm --filter @touhoufriberg/data validate` | 校验角色与作品数据           |

提交改动前至少运行 `pnpm typecheck` 和 `pnpm test`。涉及构建配置或前端资源时还应运行 `pnpm build`。

## 项目结构

```text
apps/web/src/
  App.tsx                    页面、路由与客户端交互
  api.ts                     统一 API 客户端
  gameModes.ts               单人模式的界面配置
  components/                可复用头像与品牌图标
  hooks/                     题库摘要与角色搜索数据 Hook
  styles.css                 全局视觉系统与响应式样式
apps/api/src/
  server.ts         HTTP 路由与错误处理
  game.ts           会话、搜索与猜测服务
  db.ts             数据库访问
packages/shared/src/
  compare.ts        字段比较规则
  daily.ts          每日题选择
  fields.ts         当前启用的反馈字段
  modes.ts          可玩模式与内容类型定义
  search.ts         搜索归一化逻辑
  share.ts          无剧透分享文本
  types.ts          共享类型
packages/data/src/
  characters.demo.json
  works.demo.json
  schema.ts
prisma/
  schema.prisma
  seed.ts
```

## 开发约定

### 前端

- 业务状态以 API 返回的 `PublicGameSession` 为准；
- 不在客户端选择答案或重新计算反馈；
- 新增图标优先使用现有 `lucide-react` 依赖；
- 交互必须覆盖加载、空、错误、禁用和完成状态；
- 样式修改需要检查窄屏布局和减少动态效果设置。

### API

- 使用 Zod 校验路径、查询参数和请求体；
- 进行中的会话不得返回隐藏答案；
- 可预期的业务错误使用 `ApiError`；
- 新接口应保持 JSON 错误结构一致。
- 新游戏模式通过共享模式定义和服务端答案选择器注册，避免新增平行路由。

### 共享逻辑

- 比较、搜索、每日题和分享逻辑应保持无框架依赖；
- 修改反馈规则时必须添加覆盖边界情况的测试；
- 客户端与服务端共享的结构统一定义在 `packages/shared`。
- 猜测内容的字段与次数从 `GAME_CONTENT_DEFINITIONS` 读取；新增内容类型时建立独立定义与比较器。

### 题库

题库字段与来源要求见[东方内容与数据规范](./03_touhou_integration.md)。数据变更必须通过 schema 和跨记录校验。

## 数据库变更

修改 `prisma/schema.prisma` 后：

1. 运行 `pnpm db:push` 同步本地开发数据库并更新 Prisma Client；
2. 运行 `pnpm seed` 补齐题库字段；
3. 对已有数据增加必填列时采用可空列、回填、收紧约束的无损步骤；
4. 发布环境应为同一结构变化创建并审查正式 Prisma migration；
5. 验证旧会话无法恢复时客户端能清理本地会话 ID 并正常重建。

不要提交开发机生成的 SQLite 数据库。

## 故障排查

### Web 可以打开，但请求失败

确认 API 正在监听 `4000` 端口，并访问健康检查地址。若单独启动 Web，检查 Vite 代理或 `VITE_API_BASE_URL` 是否正确。

### Prisma Client 与 schema 不一致

运行：

```bash
pnpm db:generate
pnpm db:push
```

### 题库修改后页面仍显示旧数据

重新运行 `pnpm seed`。如果已存在进行中的浏览器会话，清除对应站点的本地存储后重新创建题目。

## 提交范围

一个提交应聚焦于单一功能或问题。避免同时提交本地日志、数据库文件、格式化无关文件或来源不明的媒体资源。用户可见行为发生变化时，请同步更新相关文档。
