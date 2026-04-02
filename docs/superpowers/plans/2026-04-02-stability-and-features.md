# 稳定性 & 功能增强 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 MVP 缺失的稳定性机制（任务恢复、重试、日志、配额），并搭建前端 UI 骨架。

**Architecture:** 6 个独立任务，其中 Task 1-4 完全可并行（互不依赖），Task 5 依赖 Task 1+2 完成后做集成验证，Task 6（前端）可与任何后端任务并行。

**Tech Stack:** Node.js + tsx, Hono.js, Drizzle ORM + @libsql/client, notebooklm-kit, pino (日志), Vue 3 + Vite + TailwindCSS

---

## 并行分组

```
┌─────────────────────────────────────────────────────────┐
│                    可并行执行                              │
│                                                         │
│  Task 1: 结构化日志        Task 2: 任务恢复               │
│  Task 3: 错误重试          Task 4: 配额管理               │
│  Task 6: 前端 UI 骨架                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
              Task 5: 集成验证 (E2E)
              (依赖 Task 1-4 全部完成)
```

---

## Task 1: 结构化日志

**目标:** 用 pino 替换所有 `console.log` / `console.error`，符合 AGENTS.md 规范。

**Files:**
- Create: `server/src/lib/logger.ts` — 创建 pino logger 单例
- Modify: `server/src/index.ts` — 服务启动日志
- Modify: `server/src/worker/queue.ts` — 任务执行日志
- Modify: `server/src/worker/research.ts` — 研究流程各阶段日志
- Modify: `server/src/db/migrate.ts` — 迁移日志

**思路:**

```
// server/src/lib/logger.ts
// 导出 pino 实例，配置 pretty transport (dev) 和 JSON (prod)
// level 根据 NODE_ENV 决定: dev=debug, prod=info
```

- [ ] 安装 `pino` + `pino-pretty` (devDep)
- [ ] 创建 `server/src/lib/logger.ts`
- [ ] 全局搜索 `console.log` / `console.error`，逐一替换为 `logger.info` / `logger.error`
- [ ] 启动服务器验证日志输出格式正确
- [ ] Commit

---

## Task 2: 任务恢复（Task Recovery）

**目标:** 服务器重启时，从 DB 恢复中断的任务（`pending` / `generating_questions` / `asking` / `summarizing` 状态），重新入队。

**Files:**
- Create: `server/src/worker/recovery.ts` — 恢复逻辑
- Modify: `server/src/index.ts` — 启动时调用恢复

**思路:**

```
// recovery.ts
// 查询 DB 中 status NOT IN ('done', 'error') 的 task
// 对于 asking 状态: 检查哪些 question 已完成，从未完成的继续
// 对于其他中间状态: 根据已有数据决定从哪一步恢复
// 将恢复的任务重新 enqueue 到 taskQueue
```

关键决策：
- `pending` → 直接重新入队，从头开始
- `generating_questions` → 问题可能没生成完，重新入队从头开始
- `asking` → 已有的 question(status=done) 保留，从第一个 pending/error 的 question 继续
- `summarizing` → 重新生成报告

- [ ] 创建 `server/src/worker/recovery.ts`，实现 `recoverInterruptedTasks()` 函数
- [ ] 修改 `server/src/worker/research.ts`，支持"从中间恢复"（跳过已回答的 question）
- [ ] 在 `server/src/index.ts` 启动时调用恢复函数
- [ ] 手动测试：启动 → 提交任务 → 杀掉服务器 → 重启 → 观察任务是否继续
- [ ] Commit

---

## Task 3: 错误处理 & 重试

**目标:** 单个 question 失败时自动重试（最多 3 次，指数退避），避免一个网络错误导致整个研究任务失败。

**Files:**
- Create: `server/src/lib/retry.ts` — 通用重试工具函数
- Modify: `server/src/worker/research.ts` — 在 askNotebook 调用处包装重试

**思路:**

```
// retry.ts
// retry(fn, { maxAttempts: 3, baseDelay: 3000, backoffFactor: 2 })
// 每次失败后 delay * backoffFactor^attempt
// 最终仍失败则抛出最后一个错误
```

- [ ] 创建 `server/src/lib/retry.ts`
- [ ] 在 `research.ts` 的 askNotebook 调用处使用 retry 包装
- [ ] 区分可重试错误（网络、超时）和不可重试错误（认证过期）
- [ ] Commit

---

## Task 4: Google 配额管理

**目标:** 追踪每日 NotebookLM 查询次数（免费层 50 次/天），超限时阻止新请求。

**Files:**
- Create: `server/src/lib/quota.ts` — 配额计数器
- Modify: `server/src/notebooklm/client.ts` — 在 askNotebook 中检查配额
- Modify: `server/src/routes/health/index.ts` — 在 health 接口暴露配额信息

**思路:**

```
// quota.ts
// 内存计数器: { date: "YYYY-MM-DD", count: number }
// 每次 askNotebook 调用前 checkQuota()，调用后 incrementQuota()
// 日期变更时自动重置
// 暴露 getQuotaStatus() → { date, used, limit, remaining }
```

注意：MVP 阶段用内存计数即可（重启后重置为 0，保守但安全）。后续可持久化到 DB。

- [ ] 创建 `server/src/lib/quota.ts`
- [ ] 在 `askNotebook` 调用前后集成配额检查
- [ ] 在 health 路由暴露配额状态
- [ ] 超限时 `POST /api/research` 应返回 429
- [ ] Commit

---

## Task 5: 集成验证 (E2E)

**依赖: Task 1-4 全部完成**

**目标:** 跑一次完整的研究流程，验证所有新增机制协同工作。

**Files:** 无新增文件

- [ ] 启动服务器 (`npm run dev:server`)
- [ ] 检查 `GET /api/auth/status` 返回 authenticated
- [ ] 检查 `GET /api/health` 返回配额信息和队列状态
- [ ] 提交研究任务 `POST /api/research`（用小的 notebook，numQuestions=2）
- [ ] 轮询 `GET /api/research/:id/status` 直到完成
- [ ] 验证 `GET /api/research/:id` 返回完整的 questions + report
- [ ] 在流程进行中杀掉服务器并重启，验证任务恢复
- [ ] 验证日志输出为结构化 JSON / pretty 格式
- [ ] Commit（如有修复）

---

## Task 6: 前端 UI 骨架

**目标:** 搭建最小可用的 Vue 3 前端：提交研究任务 + 查看任务列表 + 查看任务详情（含报告）。

**Files:**
- Modify: `client/package.json` — 添加依赖 (tailwindcss, shadcn-vue 或手写)
- Create: `client/src/api/client.ts` — API 请求封装
- Create: `client/src/views/HomeView.vue` — 任务列表页
- Create: `client/src/views/TaskDetailView.vue` — 任务详情页（含进度、问答、报告）
- Create: `client/src/components/CreateTaskForm.vue` — 提交研究任务表单
- Create: `client/src/components/TaskCard.vue` — 任务卡片组件
- Modify: `client/src/App.vue` — 路由集成
- Modify: `client/vite.config.ts` — API 代理到后端 3000 端口

**思路:**

三个页面：
1. **首页 (/)** — 顶部表单提交任务 + 下方任务列表
2. **详情页 (/task/:id)** — 状态进度条 + 问答列表 + 最终报告（Markdown 渲染）

用 vue-router 做路由，fetch 封装调后端 API，vite proxy 解决跨域。

样式：TailwindCSS，保持简洁。暂不引入 shadcn-vue（YAGNI）。

- [ ] 安装依赖：`vue-router`, `tailwindcss`, `@tailwindcss/vite`, `marked`（Markdown 渲染）
- [ ] 配置 TailwindCSS + vite proxy
- [ ] 创建 `api/client.ts` — 封装 fetch 调用
- [ ] 创建 `CreateTaskForm.vue` — notebook URL + topic + numQuestions 表单
- [ ] 创建 `TaskCard.vue` — 显示任务状态、进度
- [ ] 创建 `HomeView.vue` — 组合表单 + 列表
- [ ] 创建 `TaskDetailView.vue` — 进度 + 问答 + 报告
- [ ] 配置 vue-router，修改 `App.vue`
- [ ] 启动前后端验证完整流程
- [ ] Commit

---

## 执行顺序总结

| 阶段 | 任务 | 可并行 |
|------|------|--------|
| 1 | Task 1 (日志) + Task 2 (恢复) + Task 3 (重试) + Task 4 (配额) + Task 6 (前端) | 全部并行 |
| 2 | Task 5 (E2E 验证) | 等阶段 1 全部完成 |
