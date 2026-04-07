# AGENTS.md — NotebookLM 自动化研究引擎

## 项目概述

基于 Google NotebookLM 的自动化深度研究工具。用户手动将文档上传到 NotebookLM，然后本系统自动生成研究问题，通过 NotebookLM API 逐一提问，收集回答，最终汇编完整的研究报告。充分利用 NotebookLM 零幻觉 + 来源引用的能力。

## 技术栈

- **运行时**: Node.js + tsx（TypeScript 执行器）
- **Monorepo**: npm workspaces + Turborepo（`client/`、`server/`、`shared/`）
- **后端**: Hono.js + @hono/node-server + TypeScript
- **数据库**: SQLite，通过 Drizzle ORM + @libsql/client 操作
- **NotebookLM API**: `notebooklm-kit` SDK（纯 HTTP RPC，API 调用无需浏览器）
- **前端**: Vue 3 + Vite + UnoCSS。新 UI 默认避免 Element Plus / shadcn-vue 这类强视觉烙印的套件，优先 headless primitives + 本地样式。若需引入复杂交互 primitive，优先考虑 Reka UI。
- **数据验证**: Zod

## 架构

```
POST /api/research {notebook_url, topic, num_questions}
  → 创建 research_task（status: pending）
  → FIFO 队列取出任务
  → [步骤 1] 让 NotebookLM "生成 N 个研究问题" → 解析问题列表
  → [步骤 2] 通过 SDK chat API 逐一提问 → 存储回答
  → [步骤 3] 让 NotebookLM "汇编完整研究报告" → 存储报告
  → task.status = done
```

单 Worker、单 Google 账号、FIFO 任务队列。所有 NotebookLM 交互均通过 HTTP RPC（notebooklm-kit SDK）完成。流程中无浏览器自动化。MVP 阶段不使用外部 LLM——所有智能能力来自 NotebookLM 本身。

## 核心目录

```
server/src/
├── db/            # Drizzle schema + 数据库连接（@libsql/client SQLite）
├── routes/        # API 路由处理（auth、research、health）
├── notebooklm/    # NotebookLM SDK 客户端（认证、提问、列出笔记本）
└── worker/        # 任务队列 + 研究编排逻辑
```

## NotebookLM API 说明

- **notebooklm-kit** SDK 通过 Google 内部的 batchexecute RPC 协议通信（纯 HTTP POST，无需浏览器）。
- 认证需要首次通过 `npx notebooklm login` 手动登录（会启动浏览器）。会话保存在 `~/.notebooklm/storage-state.json`。
- 登录后，服务端从 storage-state.json 读取 cookies，并请求 NotebookLM 首页提取认证令牌（SNlM0e）。
- SDK 在每次请求中发送 `Cookie` 请求头 + POST body 中的认证令牌。
- SDK 支持：列出/创建笔记本、添加来源、聊天（支持流式）、生成制品（音频、视频、幻灯片、测验、闪卡）。
- Google 免费层级限制每日 50 次查询。

## 编码规范

- 使用 TypeScript 严格模式。
- 路由组织参考 hono-open-api-starter 模式。
- 数据库：使用 Drizzle ORM + `drizzle-orm/libsql`。数据库列名使用 `snake_case`。
- ID：使用 `crypto.randomUUID()` 生成文本主键。
- 生产代码禁止使用 `console.log`——如需日志请使用结构化日志。
- 前端界面避免做成通用后台套件风格、模板化 AI 产品风格或明显 Electron 套壳风格；优先通过排版、密度、边界和局部 token 建立自己的视觉识别。
- 当前研究工作台及其后续相关页面，默认采用“仿书页 / 档案页 / 研究手稿”方向：暖纸色背景、墨色文字、衬线标题、版心式分隔，避免科技控制台感。
- 中文阅读型界面优先保证可读性：长期可见的正文、列表、表单输入和主要按钮文案不要默认压到 `text-xs`；`text-xs` 仅用于短标签和次级元信息，主要内容默认至少 `text-base`，并配合更宽松的 `line-height`。

## 重要约束

- NotebookLM 没有公开 API。notebooklm-kit SDK 逆向了 Google 的内部 RPC 协议——Google 更新时可能失效。
- 首次认证需要运行 `npx notebooklm login`（会打开浏览器窗口）。之后所有操作均为纯 HTTP。
- `data/` 目录（SQLite 数据库）已被 gitignore。
- 永远不要提交 `.env`、`data/` 或 `~/.notebooklm/` 文件。
