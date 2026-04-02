# 代码库结构

## Monorepo 布局
```
notebooklm/                    # 项目根目录
├── package.json               # npm workspaces 根配置
├── turbo.json                 # Turborepo 构建编排配置
├── tsconfig.json              # TypeScript 根配置
├── AGENTS.md                  # AI 代理项目上下文
├── README.md                  # 项目说明
├── CONTRIBUTING.md            # 贡献指南
├── .gitignore
├── server/                    # 后端 workspace
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # Hono 服务入口（@hono/node-server, 端口 3000）
│       ├── db/
│       │   ├── schema.ts      # Drizzle schema: research_tasks + questions 表
│       │   ├── index.ts       # 数据库连接（@libsql/client）
│       │   └── migrate.ts     # SQL 迁移脚本
│       ├── notebooklm/
│       │   ├── client.ts      # NotebookLM SDK 封装（认证、提问、列出笔记本）
│       │   └── index.ts       # barrel exports
│       ├── routes/
│       │   ├── auth/index.ts       # GET /api/auth/status
│       │   ├── health/index.ts     # GET /api/health
│       │   └── research/index.ts   # CRUD /api/research
│       └── worker/
│           ├── queue.ts       # 内存 FIFO 任务队列
│           └── research.ts    # 研究编排逻辑（生成问题→逐一提问→汇编报告）
├── client/                    # 前端 workspace（Vue 3，尚未开发）
│   ├── package.json
│   └── ...
├── shared/                    # 共享类型 workspace
│   └── src/types/index.ts     # ApiResponse 类型
└── data/                      # 运行时数据（gitignored）
    └── notebooklm.db          # SQLite 数据库
```

## API 路由
| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | /                        | 服务器信息 |
| GET  | /api/health              | 健康检查（含队列状态） |
| GET  | /api/auth/status         | NotebookLM 认证状态 |
| POST | /api/research            | 创建研究任务 |
| GET  | /api/research            | 列出所有任务 |
| GET  | /api/research/:id        | 任务详情（含问题和回答） |
| GET  | /api/research/:id/status | 轻量级进度查询 |

## 数据库表
- research_tasks: 研究任务（id, notebook_id, topic, num_questions, status, report, timestamps）
- questions: 研究问题（id, task_id, question_text, answer_text, order, status, timestamps）
