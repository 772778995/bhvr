# NotebookLM 自动化研究引擎

基于 Google NotebookLM 的自动化深度研究工具。用户手动将文档上传到 NotebookLM，然后本系统自动生成研究问题，通过 API 逐一提问，收集回答，最终汇编完整的研究报告。

## 功能特性

- **零幻觉研究**：所有回答均由 NotebookLM 基于上传文档生成，自带来源引用
- **自动化流程**：提交一个主题，系统自动生成问题、逐一提问、汇编报告
- **全栈 TypeScript**：客户端与服务端之间端到端类型安全
- **共享类型**：通用类型定义在 `shared/` 包中，客户端与服务端共享
- **Monorepo 结构**：基于 npm workspaces 的 Monorepo，使用 Turborepo 进行构建编排

## 技术栈

- [Node.js](https://nodejs.org) 作为 JavaScript 运行时
- [tsx](https://github.com/privatenumber/tsx) 作为 TypeScript 执行器
- [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) 作为包管理器 + Monorepo 方案
- [Hono](https://hono.dev) 作为后端框架
- [@hono/node-server](https://github.com/honojs/node-server) 作为 Node.js HTTP 适配器
- [Drizzle ORM](https://orm.drizzle.team) + [@libsql/client](https://github.com/tursodatabase/libsql-client-ts) 作为数据库层（SQLite）
- [notebooklm-kit](https://github.com/nicepkg/notebooklm-kit) 作为 NotebookLM SDK
- [Vue 3](https://vuejs.org) + [Vite](https://vitejs.dev) 作为前端（后续开发）
- [Turborepo](https://turbo.build) 作为 Monorepo 构建编排工具
- [Zod](https://zod.dev) 作为数据验证库

## 项目结构

```
.
├── client/               # Vue 3 前端（后续开发）
├── server/               # Hono 后端
│   └── src/
│       ├── db/           # Drizzle schema + 数据库连接
│       ├── routes/       # API 路由（auth、research、health）
│       ├── notebooklm/   # NotebookLM SDK 客户端封装
│       └── worker/       # 任务队列 + 研究编排逻辑
├── shared/               # 共享 TypeScript 类型定义
│   └── src/types/
├── package.json          # 根 package.json（含 workspaces 配置）
└── turbo.json            # Turborepo 配置
```

## 快速开始

### 前置条件

确保已安装 [Node.js](https://nodejs.org)（v20+）和 npm v10.9.2+：

```bash
node --version   # 需要 >= 20
npm --version    # 需要 >= 10.9.2
```

> **注意（tsx 版本固定）**：根 `package.json` 中的 `overrides.tsx: "~4.20.0"` 将 tsx 锁定在
> 4.20.x，低于 `drizzle-kit@0.31.10` 声明的 `^4.21.0`。原因：tsx 4.21 依赖 esbuild 0.27.x，
> 而 vite 6 依赖 esbuild 0.25.x；两者在 Node 24 + npm 11 环境下共存时会触发 esbuild 安装脚本
> 的版本校验错误。tsx 4.20.x 在功能上完全兼容 drizzle-kit，`npm ls` 会显示 `invalid` 警告但
> 不影响运行。待 vite 7 / drizzle-kit 对齐到同一 esbuild 大版本后可移除此 override。

### 安装依赖

```bash
npm install
```

### 首次认证

NotebookLM 没有公开 API，需要首次手动登录获取会话凭证：

```bash
npx notebooklm login
```

此命令会打开浏览器窗口，登录你的 Google 账号后，会话信息保存到 `~/.notebooklm/storage-state.json`。之后所有操作均为纯 HTTP，无需浏览器。

### 初始化数据库

```bash
npx tsx server/src/db/migrate.ts
```

### 启动开发服务器

```bash
# 启动后端服务（默认端口 3450）
npm run dev:server
```

> **注意（默认端口为 3450）**：服务器默认监听 **3450** 而非常见的 3000，原因是 Windows 会通过
> Hyper-V / WSL 保留 3000–3001 等端口，导致 `listen EACCES` 错误。如需使用其他端口：
>
> ```powershell
> # PowerShell（Windows）
> $env:PORT=8080; npm run dev:server
> ```
>
> ```bash
> # POSIX（macOS / Linux）
> PORT=8080 npm run dev:server
> ```

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 服务器信息 |
| `GET` | `/api/health` | 健康检查（含队列状态） |
| `GET` | `/api/auth/status` | 检查 NotebookLM 认证状态 |
| `POST` | `/api/research` | 创建研究任务 |
| `GET` | `/api/research` | 列出所有任务 |
| `GET` | `/api/research/:id` | 任务详情（含问题和回答） |
| `GET` | `/api/research/:id/status` | 轻量级进度查询 |

### 创建研究任务示例

```bash
curl -X POST http://localhost:3450/api/research \
  -H "Content-Type: application/json" \
  -d '{
    "notebookUrl": "https://notebooklm.google.com/notebook/YOUR_NOTEBOOK_ID",
    "topic": "你的研究主题",
    "numQuestions": 5
  }'
```

## 重要说明

- **Google 免费层级**：每日限制 50 次查询。
- **API 稳定性**：notebooklm-kit SDK 逆向了 Google 的内部 RPC 协议，Google 更新时可能失效。
- `data/`、`.env`、`~/.notebooklm/` 不应提交到版本控制。

## 许可证

MIT
