# 本地持久化聊天记录实施计划

> **面向智能体工作者：** 必需子技能：使用 superpowers:subagent-driven-development 逐任务实施此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**当前状态：** 未开始

**目标：** 把所有聊天消息（手动对话 + 自动研究 Q&A）持久化到本地 SQLite，`GET /:id/messages` 改为查 DB，彻底放弃不可靠的 NotebookLM history API。

**架构：** 新增 `chat_messages` 表，存储所有对话消息。手动聊天路由在发送/收到消息后写入 DB；研究 orchestrator 每轮问答成功后写入 DB。前端已有的 `refreshMessages()` 调用路径不变，只是后端从 DB 返回数据。

**技术栈：** Node.js / TypeScript / Hono.js / Drizzle ORM / @libsql/client SQLite

---

## 背景与根本原因

- NotebookLM SDK（`notebooklm-kit`）发送消息时使用 `sourceIds` 作为 contextItems，服务器处理请求但**不将其记录为对话历史**
- NotebookLM history API（`hPTbtc` / `khqZz` RPC）是分页懒加载的，且对 SDK 发出的消息返回空结果
- 手动聊天目前靠前端乐观更新显示，页面刷新即丢失；自动研究消息完全没有持久化
- 正确方案：完全自维护消息历史，绕开 NotebookLM history API

## 当前代码中的未完成修改（需先回滚）

以下文件在本次调试过程中有**未完成的部分修改**，需要在任务 1 中清理：

- `server/src/research-runtime/types.ts`：已添加 `ResearchMessage` 接口和 `messages` 字段（DB 方案不需要放在 registry state 里，需移除）
- `server/src/research-runtime/orchestrator.ts`：已添加 `ResearchMessage` import 和部分消息构建代码（未保存 DB，需替换为 DB 写入）
- `server/src/notebooklm/client.ts`：已添加大量 debug 日志（可保留或移除，任务 1 一并清理）

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `server/src/db/schema.ts` | 修改 | 添加 `chatMessages` Drizzle table 定义 |
| `server/src/db/index.ts` | 修改 | 添加 `CREATE TABLE IF NOT EXISTS chat_messages` |
| `server/src/db/migrate.ts` | 修改 | 同步添加 `CREATE TABLE IF NOT EXISTS chat_messages` |
| `server/src/db/chat-messages.ts` | **新建** | DB 操作封装：`insertChatMessage`、`listChatMessages` |
| `server/src/routes/notebooks/index.ts` | 修改 | POST 路由保存消息；GET /messages 改查 DB |
| `server/src/research-runtime/orchestrator.ts` | 修改 | 每轮问答成功后调用 `insertChatMessage` |
| `server/src/research-runtime/types.ts` | 修改 | 移除 `ResearchMessage` 和 `messages` 字段（回滚） |
| `server/src/notebooklm/client.ts` | 修改 | 移除调试日志；`getNotebookMessages` 不再被 messages 路由调用（可保留函数体但不再使用） |

---

## 任务列表

### 任务 1：回滚未完成的临时修改，恢复代码干净状态

**当前状态：** 未开始

**文件：**
- 修改：`server/src/research-runtime/types.ts`
- 修改：`server/src/research-runtime/orchestrator.ts`
- 修改：`server/src/notebooklm/client.ts`

**意图：** 上一轮调试在 `types.ts` 加了 `ResearchMessage` 接口和 `messages?: ResearchMessage[]` 字段，在 `orchestrator.ts` 加了部分消息构建代码（但还没保存到 DB），在 `client.ts` 加了大量 debug 日志。这些都是半成品，需要先清理干净，再从正确路径实现。

- [ ] **步骤 1：清理 `types.ts`**

  从 `ResearchRuntimeState` 中删除 `messages?: ResearchMessage[]` 字段，删除 `ResearchMessage` 接口定义。这两个定义不应放在 registry state 里——消息由 DB 管理，不随 SSE payload 传输。

- [ ] **步骤 2：清理 `orchestrator.ts`**

  删除 `ResearchMessage` import，删除构建 `userMsg` / `assistantMsg` 的代码块，删除 `registry.update` 调用中的 `messages: [...]` 字段。`orchestrator.ts` 目前对 `registry.update` 的调用应恢复为只包含 `step`、`completedCount`、`activeConversationId`、`hiddenConversationIds`。

- [ ] **步骤 3：清理 `client.ts` 调试日志**

  删除 `listNotebookHistoryThreadIds` 中的两条 `logger.info`（打印 `rawResponse` 和 `parsed` 的）。删除 `listNotebookHistoryMessages` 中的两条 `logger.info`（打印 `rawResponse` 和 `parsed` 的）。删除 `askNotebookForResearch` 中新增的 `logger.info`（打印 `conversationId`、`messageIds`、`hasText` 的）。

- [ ] **步骤 4：TypeScript 编译验证**

  运行：`cd server && npx tsc --noEmit`
  预期：0 错误

- [ ] **步骤 5：提交**

  提交信息：`回滚调试阶段的临时修改，清理未完成代码`

---

### 任务 2：添加 chat_messages 表 schema 与建表语句

**当前状态：** 未开始

**文件：**
- 修改：`server/src/db/schema.ts`
- 修改：`server/src/db/index.ts`
- 修改：`server/src/db/migrate.ts`

**意图：** 新增 `chat_messages` 表，用于持久化所有聊天消息。表结构设计为：每行一条消息，包含所属 notebook、角色、内容、来源类型（手动 vs 研究）和时间戳。`schema.ts` 供 Drizzle ORM 查询用；`index.ts` 和 `migrate.ts` 中的 `CREATE TABLE IF NOT EXISTS` 语句需同步添加（项目用的是手动 DDL 建表模式，非 Drizzle migrate 命令）。

表结构（DDL）：

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  notebook_id TEXT NOT NULL,
  role TEXT NOT NULL,          -- 'user' | 'assistant'
  content TEXT NOT NULL,
  source TEXT NOT NULL,        -- 'manual' | 'research'
  created_at INTEGER NOT NULL  -- Unix timestamp (ms)
);

CREATE INDEX IF NOT EXISTS chat_messages_notebook_id
ON chat_messages (notebook_id, created_at ASC);
```

Drizzle schema 对应：用 `sqliteTable`、`text`、`integer` 定义，`created_at` 用 `{ mode: "timestamp_ms" }`，`$defaultFn(() => new Date())`。

- [ ] **步骤 1：在 `schema.ts` 添加 Drizzle table 定义**

  按上面 DDL 结构用 Drizzle ORM 语法定义 `chatMessages` 表，导出供查询使用。

- [ ] **步骤 2：在 `index.ts` 添加建表语句**

  在 `client.executeMultiple(...)` 的 SQL 字符串里追加 `chat_messages` 的 `CREATE TABLE IF NOT EXISTS` 和 `CREATE INDEX IF NOT EXISTS` 语句，与现有表格式保持一致。

- [ ] **步骤 3：在 `migrate.ts` 同步添加相同建表语句**

  与步骤 2 完全相同的 SQL，加到 `migrate.ts` 的 `executeMultiple` 里。

- [ ] **步骤 4：TypeScript 编译验证**

  运行：`cd server && npx tsc --noEmit`
  预期：0 错误

- [ ] **步骤 5：提交**

  提交信息：`新增 chat_messages 表，持久化聊天消息`

---

### 任务 3：创建 DB 操作封装模块 chat-messages.ts

**当前状态：** 未开始

**文件：**
- 新建：`server/src/db/chat-messages.ts`

**意图：** 封装 `chat_messages` 表的两个核心操作：插入一条消息、按 notebook_id 查询全部消息（按 created_at 升序）。保持与项目其他 DB 操作一致的风格（直接使用 Drizzle ORM，不封装 class）。

接口设计：

```pseudo
interface ChatMessageRecord {
  id: string
  notebookId: string
  role: "user" | "assistant"
  content: string
  source: "manual" | "research"
  createdAt: Date
}

// 插入单条消息
async function insertChatMessage(record: Omit<ChatMessageRecord, "createdAt">): Promise<void>

// 查询 notebook 的全部消息，按 created_at 升序
async function listChatMessages(notebookId: string): Promise<ChatMessageRecord[]>
```

- [ ] **步骤 1：实现 `insertChatMessage`**

  使用 Drizzle `db.insert(chatMessages).values(...)` 写入。`createdAt` 用 `new Date()` 默认值（Drizzle schema 已配置 `$defaultFn`）。

- [ ] **步骤 2：实现 `listChatMessages`**

  使用 Drizzle `db.select().from(chatMessages).where(eq(chatMessages.notebookId, notebookId)).orderBy(asc(chatMessages.createdAt))` 查询。返回完整记录数组。

- [ ] **步骤 3：TypeScript 编译验证**

  运行：`cd server && npx tsc --noEmit`
  预期：0 错误

- [ ] **步骤 4：提交**

  提交信息：`新增聊天消息 DB 操作封装模块`

---

### 任务 4：手动聊天路由保存消息到 DB

**当前状态：** 未开始

**文件：**
- 修改：`server/src/routes/notebooks/index.ts`

**意图：** `POST /:id/chat/messages` 路由在收到用户请求后，把用户消息写入 DB；收到 NotebookLM 回复后，把助手消息写入 DB。这样手动聊天记录就有了持久化，刷新页面不丢失。

写入时机和字段：

```pseudo
// 用户消息：在调用 sendNotebookChatMessage 之前写入
insertChatMessage({
  id: crypto.randomUUID(),
  notebookId: id,
  role: "user",
  content: content,          // 用户发送的文本
  source: "manual",
})

// 助手消息：在 sendNotebookChatMessage 成功返回后写入
insertChatMessage({
  id: response.messageIds?.[1] ?? crypto.randomUUID(),
  notebookId: id,
  role: "assistant",
  content: response.text,
  source: "manual",
})
```

两次 `insertChatMessage` 都在 `try` 块内，写 DB 失败时记录 warn 日志但不影响 HTTP 响应（用户仍能看到回复）。

- [ ] **步骤 1：导入 `insertChatMessage`**

  在路由文件顶部 import `insertChatMessage` from `../db/chat-messages.js`。

- [ ] **步骤 2：在路由 try 块内写入用户消息和助手消息**

  按上面伪代码，在调用 `sendNotebookChatMessage` 前后各插入一条记录。写 DB 失败用 `logger.warn` 记录，不 throw。

- [ ] **步骤 3：TypeScript 编译验证**

  运行：`cd server && npx tsc --noEmit`
  预期：0 错误

- [ ] **步骤 4：提交**

  提交信息：`手动聊天消息持久化到本地 DB`

---

### 任务 5：GET /messages 路由改为查询本地 DB

**当前状态：** 未开始

**文件：**
- 修改：`server/src/routes/notebooks/index.ts`

**意图：** `GET /:id/messages` 和 `GET /:id/chat/messages`（向后兼容别名）目前调用 `getNotebookMessages`，后者触发 NotebookLM history RPC，一直返回空。改为直接调用 `listChatMessages(id)` 从本地 DB 查询，并把结果映射成前端期望的 `ChatMessage` 格式（`{ id, role, content, createdAt: ISO string, status: "done" }`）。

删除这两个路由中的以下逻辑（不再需要）：
- `const runtime = getRuntimeState(id)` 调用
- `activeConversationId`、`hiddenConversationIds` 的读取
- `getNotebookMessages(id, { hiddenThreadIds, activeThreadId })` 调用
- 相关 `logger.info` 日志

映射逻辑：

```pseudo
const records = await listChatMessages(id)
return records.map(r => ({
  id: r.id,
  role: r.role,
  content: r.content,
  createdAt: r.createdAt.toISOString(),
  status: "done",
}))
```

- [ ] **步骤 1：导入 `listChatMessages`**

  在路由文件顶部 import `listChatMessages` from `../db/chat-messages.js`。

- [ ] **步骤 2：替换 `GET /:id/messages` 实现**

  删除 `getRuntimeState`、`getNotebookMessages` 调用，替换为 `listChatMessages` + 映射。

- [ ] **步骤 3：同样替换 `GET /:id/chat/messages` 别名路由**

  与步骤 2 相同的改法，保持两个路由返回格式一致。

- [ ] **步骤 4：TypeScript 编译验证**

  运行：`cd server && npx tsc --noEmit`
  预期：0 错误

- [ ] **步骤 5：提交**

  提交信息：`消息查询接口改为查本地 DB，放弃 NotebookLM history API`

---

### 任务 6：研究 orchestrator 每轮问答后写入 DB

**当前状态：** 未开始

**文件：**
- 修改：`server/src/research-runtime/orchestrator.ts`

**意图：** 每轮自动研究问答成功后，把问题（user）和回答（assistant）写入 `chat_messages` 表，`source` 为 `"research"`。这样前端通过 SSE 触发的 `refreshMessages()` 就能从 DB 拿到最新消息。

写入位置：在 `result.success` 为 true 的分支里，调用 `registry.update` 之前写入：

```pseudo
// 在 result.success 分支内，registry.update 之前
const now = new Date()
await insertChatMessage({
  id: crypto.randomUUID(),
  notebookId,
  role: "user",
  content: question,
  source: "research",
})
await insertChatMessage({
  id: crypto.randomUUID(),
  notebookId,
  role: "assistant",
  content: result.answer,   // result.answer 在此分支内有值
  source: "research",
})
```

写入失败时：用 `logger.warn` 记录，不中断研究循环（消息丢失比研究中断代价小）。

- [ ] **步骤 1：导入 `insertChatMessage`**

  在 `orchestrator.ts` 顶部 import `insertChatMessage` from `../db/chat-messages.js`。

- [ ] **步骤 2：在成功分支写入 Q&A 消息**

  按伪代码，在 `result.success` 分支内写入用户问题和助手回答。两次 `await insertChatMessage` 用 try/catch 包裹，失败时 `logger.warn`，不 throw。

- [ ] **步骤 3：TypeScript 编译验证**

  运行：`cd server && npx tsc --noEmit`
  预期：0 错误

- [ ] **步骤 4：提交**

  提交信息：`自动研究 Q&A 持久化到本地 DB`

---

### 任务 7：前端去掉乐观更新，统一通过 DB 读取消息

**当前状态：** 未开始

**文件：**
- 修改：`client/src/views/NotebookWorkbenchView.vue`

**意图：** 手动发送消息后，前端目前做乐观更新（立即把 user 消息加到 UI，再追加 assistant 消息）。现在后端已持久化，改为发送后调用 `refreshMessages()` 从 DB 获取，统一数据来源。这样刷新页面也有完整历史。

具体改动：
- 删除 `onSendMessage` 里的 `optimisticMessage` 构建和 `messages.value = [...messages.value, optimisticMessage]`
- 删除成功后的 `messages.value = [...messages.value, result.message]` 追加
- 改为在 `sendMessage` 成功/失败后都调用 `await refreshMessages()`
- 删除 `activeConversationId` 和 `conversationHistory` 的 ref 定义及相关更新逻辑（这些是为 NotebookLM 多轮对话设计的，现在消息由 DB 管理，多轮上下文由 `conversationHistory` 字段通过 API body 传递的逻辑也可以保留，只是显示层不再依赖它们）

注意：`activeConversationId` 和 `conversationHistory` 仍然需要传给 `sendMessage` API（用于 SDK 构建请求），只是不再用于前端消息显示。

- [ ] **步骤 1：移除乐观更新逻辑**

  在 `onSendMessage` 函数中，删除 `optimisticMessage` 相关代码（构建、push 到 messages）以及成功后的 `messages.value = [...messages.value, result.message]` 行。

- [ ] **步骤 2：改为 send 后 refresh**

  在 `sendMessage` 调用成功后，调用 `await refreshMessages()` 拉取最新消息。在 catch 块里也调用一次（清理乐观更新残留——现在没有乐观更新了，实际 catch 里不需要特殊处理）。

- [ ] **步骤 3：TypeScript 编译验证**

  运行：`cd client && npx tsc --noEmit`（或 `npm run build`）
  预期：0 错误

- [ ] **步骤 4：提交**

  提交信息：`前端消息显示统一走 DB，移除乐观更新`

---

### 任务 8：端到端验证

**当前状态：** 未开始

**意图：** 启动服务，手动验证两条核心路径都正常工作。

- [ ] **步骤 1：验证手动聊天持久化**

  启动服务器。在前端发送一条手动消息，收到回复后刷新页面，确认消息仍然显示（证明已写入 DB，不是乐观更新）。

- [ ] **步骤 2：验证自动研究 Q&A 显示**

  启动一次自动研究（设置 1-2 轮即可）。观察前端中间栏：每轮完成后（SSE progress 事件触发 `refreshMessages()`）应显示新增的问题和回答。研究完成后刷新页面，消息仍然存在。

- [ ] **步骤 3：TypeScript 全项目编译**

  运行：`cd server && npx tsc --noEmit`，`cd client && npx tsc --noEmit`
  预期：两个均 0 错误

---

## 自审

**规范覆盖检查：**
- ✅ 手动聊天消息持久化 → 任务 4
- ✅ 自动研究 Q&A 持久化 → 任务 6
- ✅ GET /messages 从 DB 返回 → 任务 5
- ✅ 前端移除乐观更新 → 任务 7
- ✅ 回滚临时调试代码 → 任务 1
- ✅ 建表 → 任务 2
- ✅ DB 封装 → 任务 3

**类型一致性：**
- `ChatMessageRecord` 在任务 3 定义，任务 4、5、6 使用 → ✅ 一致
- `source` 字段值 `"manual"` / `"research"` 在任务 2（schema）定义，任务 4、6 使用 → ✅ 一致
- 返回前端的格式 `{ id, role, content, createdAt: ISO, status: "done" }` 在任务 5 定义 → ✅ 与前端 `ChatMessage` 接口匹配

**状态一致性：** 文件名、计划头部、各任务状态均为 `未开始` → ✅ 一致
