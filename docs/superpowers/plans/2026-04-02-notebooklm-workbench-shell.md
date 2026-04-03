# NotebookLM Workbench Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个参考 Google NotebookLM 的单页 `notebook/:id` 工作台壳子，并新增对应的后端接口壳，读取类接口返回 stub 数据，写入类接口统一返回“功能正在建设中”。

**Architecture:** 前端新增独立的 `notebook/:id` 工作台路由，按顶部、来源、对话、Studio 四个区域拆分组件；后端新增 `/api/notebooks/:id/...` 路由组，按 notebooks、sources、chat、studio、research 五类能力分组。第一版不接入真实 NotebookLM 能力，只确保页面结构、接口边界和统一占位反馈稳定可用。

**Tech Stack:** Vue 3 + vue-router + TypeScript + TailwindCSS + Vite, Hono + TypeScript, npm workspaces + Turborepo

---

## File Structure

### Frontend

- Modify: `client/src/router/index.ts`
  - 新增 `notebook/:id` 路由
- Modify: `client/src/App.vue`
  - 让旧页面和新工作台路由共存
- Create: `client/src/views/NotebookWorkbenchView.vue`
  - 新工作台主页面容器，负责并行拉取数据与页面状态管理
- Create: `client/src/components/notebook-workbench/NotebookTopBar.vue`
  - 顶部标题与少量操作按钮
- Create: `client/src/components/notebook-workbench/SourcesPanel.vue`
  - 左栏来源区
- Create: `client/src/components/notebook-workbench/ChatPanel.vue`
  - 中栏对话区
- Create: `client/src/components/notebook-workbench/StudioPanel.vue`
  - 右栏 Studio 区
- Create: `client/src/api/notebooks.ts`
  - Notebook 工作台专用类型与 API 请求封装
- Create: `client/src/utils/not-implemented.ts`
  - 统一的“功能正在建设中”前端反馈帮助函数

### Backend

- Modify: `server/src/index.ts`
  - 挂载新的 notebooks 路由组
- Create: `server/src/routes/notebooks/index.ts`
  - `/api/notebooks/:id` 路由入口
- Create: `server/src/routes/notebooks/stub-data.ts`
  - 读取类接口使用的 stub 数据构造逻辑
- Create: `server/src/routes/notebooks/response.ts`
  - 统一成功/未实现响应帮助函数

### Verification

- Reuse: `client/package.json`
  - 使用已有 `build` / `dev` 脚本验证
- Reuse: `server/package.json`
  - 使用已有 `build` / `dev` 脚本验证

---

## Task 1: Add Notebook Workbench Route Skeleton

**Files:**
- Modify: `client/src/router/index.ts`
- Modify: `client/src/App.vue`
- Create: `client/src/views/NotebookWorkbenchView.vue`

- [ ] **Step 1: Add the new route entry**

伪代码：

```text
router routes:
  /                  -> HomeView
  /task/:id          -> TaskDetailView
  /notebook/:id      -> NotebookWorkbenchView
```

要求：

- 不删除现有 `home` 和 `task-detail` 路由
- 新路由名称明确，例如 `notebook-workbench`

- [ ] **Step 2: Keep the global app shell compatible with both old and new pages**

伪代码：

```text
App:
  keep shared RouterView
  do not force notebook-specific layout into old pages
```

要求：

- 不让旧 research 页被新工作台布局污染
- 如果现有全局 header 会妨碍新页面，可改成更轻量的通用容器

- [ ] **Step 3: Create a minimal workbench view that can render with static placeholders first**

伪代码：

```text
NotebookWorkbenchView:
  read route param id
  if id missing:
    render page error state
  else:
    render placeholder layout with top / left / center / right sections
```

要求：

- 先保证页面能打开，不依赖真实接口
- 先不要接具体业务交互

- [ ] **Step 4: Run a targeted client build check**

Run: `npm run build --workspace client`

Expected:

- client 构建通过
- 新路由页面可以被类型检查通过

- [ ] **Step 5: Commit**

```bash
git add client/src/router/index.ts client/src/App.vue client/src/views/NotebookWorkbenchView.vue
git commit -m "feat(client): add notebook workbench route shell"
```

---

## Task 2: Build the Three-Panel Workbench UI

**Files:**
- Modify: `client/src/views/NotebookWorkbenchView.vue`
- Create: `client/src/components/notebook-workbench/NotebookTopBar.vue`
- Create: `client/src/components/notebook-workbench/SourcesPanel.vue`
- Create: `client/src/components/notebook-workbench/ChatPanel.vue`
- Create: `client/src/components/notebook-workbench/StudioPanel.vue`

- [ ] **Step 1: Define the component split before writing markup**

伪结构：

```text
NotebookWorkbenchView
  -> NotebookTopBar
  -> SourcesPanel
  -> ChatPanel
  -> StudioPanel
```

要求：

- 每个组件只负责一个区域
- 页面容器只负责组合和状态分发

- [ ] **Step 2: Implement the top bar shell**

伪代码：

```text
NotebookTopBar props:
  title
  primaryActions

render:
  left: notebook title
  right: 1~2 action buttons
```

要求：

- 只保留简化动作按钮
- 不实现分享/设置的真实逻辑

- [ ] **Step 3: Implement the sources panel shell**

伪代码：

```text
SourcesPanel props:
  sources
  onAddSource

render:
  title
  add source button
  search area
  source list or empty state
```

要求：

- 空状态文案和结构接近截图语义
- 不实现真实上传

- [ ] **Step 4: Implement the chat panel shell**

伪代码：

```text
ChatPanel props:
  messages
  onSend

render:
  title
  center empty state if no messages
  bottom input bar
```

要求：

- 中栏保持视觉焦点
- 发送入口一直可见

- [ ] **Step 5: Implement the Studio panel shell**

伪代码：

```text
StudioPanel props:
  tools
  onOpenTool
  onOpenResearch

render:
  tools grid
  output empty state
  bottom action button for research entry
```

要求：

- 卡片命名贴近 spec
- 自动课题研究入口显式可见

- [ ] **Step 6: Assemble the full three-panel layout in the workbench view**

伪代码：

```text
layout:
  top bar
  content grid:
    left = sources
    center = chat
    right = studio
```

要求：

- 结构接近截图
- 不追求像素级一致
- 旧页面不受影响

- [ ] **Step 7: Run a targeted client build check**

Run: `npm run build --workspace client`

Expected:

- 三栏组件和主页面构建通过

- [ ] **Step 8: Commit**

```bash
git add client/src/views/NotebookWorkbenchView.vue client/src/components/notebook-workbench
git commit -m "feat(client): add notebook workbench panels"
```

---

## Task 3: Add Notebook-Oriented Client API Layer

**Files:**
- Create: `client/src/api/notebooks.ts`
- Modify: `client/src/views/NotebookWorkbenchView.vue`

- [ ] **Step 1: Define the minimal view-model types for the new page**

伪代码：

```text
Notebook:
  id, title, description, updatedAt

Source:
  id, title, type, status, summary

ChatMessage:
  id, role, content, createdAt, status

StudioTool:
  id, name, description, available

ResearchEntry:
  id, name, status, message
```

要求：

- 类型名和 spec 保持一致
- 仅保留页面渲染必需字段

- [ ] **Step 2: Add client request helpers for the notebook routes**

伪代码：

```text
api.notebooks.getNotebook(id)
api.notebooks.getSources(id)
api.notebooks.getMessages(id)
api.notebooks.getStudioTools(id)
api.notebooks.getResearchEntry(id)
```

要求：

- 不复用旧 `research` 路径
- 使用统一响应解包逻辑

- [ ] **Step 3: Update the workbench page to load data in parallel**

伪代码：

```text
onMounted:
  parallel fetch all read endpoints
  store loading / error / data states
```

要求：

- notebook id 缺失时不发请求
- 任一请求失败时显示页面级错误态

- [ ] **Step 4: Run a targeted client build check**

Run: `npm run build --workspace client`

Expected:

- API 类型与视图状态一致
- 并行加载逻辑通过类型检查

- [ ] **Step 5: Commit**

```bash
git add client/src/api/notebooks.ts client/src/views/NotebookWorkbenchView.vue
git commit -m "feat(client): load notebook workbench stub data"
```

---

## Task 4: Add Notebook Route Group on the Server

**Files:**
- Modify: `server/src/index.ts`
- Create: `server/src/routes/notebooks/index.ts`
- Create: `server/src/routes/notebooks/stub-data.ts`
- Create: `server/src/routes/notebooks/response.ts`

- [ ] **Step 1: Create a uniform response helper for success and not-implemented cases**

伪代码：

```text
ok(data, message?) -> { success: true, data, message }
notImplemented(message?) -> { success: false, message: "功能正在建设中", errorCode: "NOT_IMPLEMENTED" }
```

要求：

- 响应结构与 spec 一致
- 前端可直接消费

- [ ] **Step 2: Create stub builders for notebook page data**

伪代码：

```text
buildNotebook(id)
buildSources(id)
buildMessages(id)
buildStudioTools(id)
buildResearchEntry(id)
```

要求：

- stub 数据稳定
- 字段和前端类型保持一致
- 可按 notebook id 生成固定结果

- [ ] **Step 3: Add read endpoints under /api/notebooks/:id**

伪代码：

```text
GET /api/notebooks/:id
GET /api/notebooks/:id/sources
GET /api/notebooks/:id/chat/messages
GET /api/notebooks/:id/studio/tools
GET /api/notebooks/:id/research
```

要求：

- 统一返回 success/data 结构
- notebook id 缺失或非法时返回明确错误

- [ ] **Step 4: Add write endpoints that return not-implemented responses**

伪代码：

```text
POST /api/notebooks/:id/sources
POST /api/notebooks/:id/chat/messages
POST /api/notebooks/:id/studio/:tool
POST /api/notebooks/:id/research
  -> return notImplemented()
```

要求：

- 所有未实现写接口的 message 保持一致
- 不写假成功逻辑

- [ ] **Step 5: Mount the new route group in the server entry**

伪代码：

```text
app.route("/api/notebooks", notebooksRoute)
```

要求：

- 保留现有 auth/research/health 路由
- 根接口说明可补充 notebooks 入口

- [ ] **Step 6: Run a targeted server build check**

Run: `npm run build --workspace server`

Expected:

- Hono 路由与返回类型编译通过

- [ ] **Step 7: Commit**

```bash
git add server/src/index.ts server/src/routes/notebooks
git commit -m "feat(server): add notebook workbench stub routes"
```

---

## Task 5: Wire Unfinished Actions to Friendly Feedback

**Files:**
- Create: `client/src/utils/not-implemented.ts`
- Modify: `client/src/components/notebook-workbench/SourcesPanel.vue`
- Modify: `client/src/components/notebook-workbench/ChatPanel.vue`
- Modify: `client/src/components/notebook-workbench/StudioPanel.vue`
- Modify: `client/src/views/NotebookWorkbenchView.vue`

- [ ] **Step 1: Define a single frontend helper for unfinished actions**

伪代码：

```text
showNotImplemented(optionalLabel):
  present user-friendly message("功能正在建设中")
```

要求：

- 页面内所有未实现按钮复用同一逻辑
- 不把相同文案散落在多个组件里

- [ ] **Step 2: Connect sources actions to the unified helper**

伪代码：

```text
onAddSourceClick -> showNotImplemented()
```

- [ ] **Step 3: Connect chat actions to the unified helper**

伪代码：

```text
onSendMessage -> showNotImplemented()
```

- [ ] **Step 4: Connect Studio tool clicks and research entry to the unified helper**

伪代码：

```text
onToolClick -> showNotImplemented(toolName)
onResearchClick -> showNotImplemented("自动课题研究")
```

- [ ] **Step 5: Run a targeted client build check**

Run: `npm run build --workspace client`

Expected:

- 所有按钮事件已接线
- 没有未使用的 props / emits / handlers

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/not-implemented.ts client/src/components/notebook-workbench client/src/views/NotebookWorkbenchView.vue
git commit -m "feat(client): add consistent not implemented feedback"
```

---

## Task 6: Verify Integrated Shell Without Breaking Existing Research Pages

**Files:**
- Modify: `docs/` only if verification reveals required follow-up notes

- [ ] **Step 1: Run both package builds**

Run: `npm run build --workspace server && npm run build --workspace client`

Expected:

- server build PASS
- client build PASS

- [ ] **Step 2: Run the monorepo test command**

Run: `npm test`

Expected:

- existing test/build pipeline still passes

- [ ] **Step 3: Smoke-check the existing research pages manually**

手动检查清单：

```text
open /
confirm home page still renders

open /task/<existing-or-fake-id>
confirm old task detail route still resolves to existing page shell
```

要求：

- 新工作台不能破坏旧页面路由

- [ ] **Step 4: Smoke-check the new notebook workbench manually**

手动检查清单：

```text
open /notebook/demo-notebook
confirm top bar renders
confirm sources/chat/studio panels render
confirm stub data appears
confirm unfinished actions show friendly feedback
confirm no white screen for missing/invalid id cases
```

- [ ] **Step 5: Commit any final fit-and-finish fixes**

```bash
git add .
git commit -m "fix: polish notebook workbench shell verification issues"
```

仅在验证阶段产生实际修复时执行此提交；若无改动则跳过。

---

## Self-Review Checklist

在执行前，先对照 spec 做一次快速核对：

- 页面是否是单页 `notebook/:id` 工作台，而不是扩展成多页面系统
- 顶部是否保持简化，不去实现低价值菜单
- 左中右三栏是否分别对应来源、对话、Studio
- 读取类接口是否全部走 stub 数据
- 写入类接口是否全部统一返回“功能正在建设中”
- 自动课题研究是否只是入口占位，没有接入真实流程
- 旧 research 模块是否保持独立且不受破坏

再做一次占位词扫描，确保计划中没有：

- `TODO`
- `TBD`
- “后续再说”式任务描述
- 引用未定义类型或未定义接口名

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-02-notebooklm-workbench-shell.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
