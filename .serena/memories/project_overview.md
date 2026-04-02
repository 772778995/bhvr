# 项目概述

## 名称
NotebookLM 自动化研究引擎

## 用途
基于 Google NotebookLM 的自动化深度研究工具。用户手动将文档上传到 NotebookLM，本系统自动生成研究问题，通过 NotebookLM API 逐一提问，收集回答，最终汇编完整的研究报告。利用 NotebookLM 零幻觉 + 来源引用的能力。

## 技术栈
- 运行时: Node.js + tsx（TypeScript 执行器）。
- Monorepo: npm workspaces + Turborepo（client/、server/、shared/）
- 后端: Hono.js + @hono/node-server + TypeScript
- 数据库: SQLite，通过 Drizzle ORM + @libsql/client（纯 JS，无需 native 编译）
- NotebookLM API: notebooklm-kit SDK（纯 HTTP RPC，无需浏览器）
- 前端（后续开发）: Vue 3 + Vite + TailwindCSS + shadcn-vue
- 数据验证: Zod

## 架构
单 Worker、单 Google 账号、FIFO 内存任务队列。所有 NotebookLM 交互均通过 HTTP RPC 完成。MVP 阶段不使用外部 LLM。

## 关键约束
- NotebookLM 没有公开 API，notebooklm-kit SDK 逆向了 Google 内部 RPC 协议
- 首次认证需运行 npx notebooklm login（打开浏览器），之后纯 HTTP
- @libsql/client 替代 better-sqlite3（系统无 C++ 编译工具链）
- Google 免费层级每日 50 次查询
