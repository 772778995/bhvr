# 自动研究改回 NotebookLM 单一数据源实施计划

> **面向智能体工作者：** 必需子技能：使用 superpowers:subagent-driven-development 逐任务实施此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**当前状态：** 已完成

**目标：** 去掉固定 20 轮和后端内存假消息，让自动研究持续运行并只展示 NotebookLM 原始会话的追加数据。

**架构：** 后端 orchestrator 改为持续研究循环，只保留最小运行元数据；NotebookLM gateway 统一负责发送消息与读取活动会话原始消息；前端只通过 `/messages` 展示原始消息并做追加合并，SSE 仅承载运行状态。

**技术栈：** Hono、TypeScript、Vue 3、NotebookLM SDK、SSE

---

### 任务 1：移除后端内存假消息来源

**当前状态：** 已完成

**文件：**
- 删除：`server/src/research-runtime/live-messages.ts`
- 删除：`server/src/research-runtime/live-messages.test.ts`
- 修改：`server/src/research-runtime/chat-asker.ts`
- 修改：`server/src/routes/notebooks/index.ts`

**意图：** `/messages` 必须恢复为只读 NotebookLM 原始数据，不能再优先返回后端内存中的消息正文副本。

- [x] **步骤 1：删除 `/messages` 中 live-messages 优先返回逻辑**
- [x] **步骤 2：删除自动研究 chat-asker 中的内存消息追加逻辑**
- [x] **步骤 3：删除 live-messages 相关文件与测试**
- [x] **步骤 4：运行相关测试与类型检查，确认消息来源回到 NotebookLM 原始读取链路**

### 任务 2：把自动研究从固定 20 轮批处理改为持续循环

**当前状态：** 已完成

**文件：**
- 修改：`server/src/research-runtime/orchestrator.ts`
- 修改：`server/src/research-runtime/types.ts`
- 修改：`server/src/research-runtime/registry.ts`
- 修改：`server/src/research-runtime/orchestrator.test.ts`

**意图：** 自动研究不能再依赖 `DEFAULT_TARGET_COUNT = 20`。它应持续运行，直到用户停止或后端报错。

- [x] **步骤 1：编写失败测试，覆盖“持续运行直到 stop/错误”而非固定完成的行为**
- [x] **步骤 2：移除固定 20 轮常量与整批问题生成流程**
- [x] **步骤 3：引入停止信号与持续循环控制**
- [x] **步骤 4：保留 `completedCount`，移除前端必须依赖的 `targetCount` 业务意义**
- [x] **步骤 5：运行 orchestrator 相关测试并验证通过**

### 任务 3：统一 NotebookLM 活动会话写入与读取路径

**当前状态：** 已完成

**文件：**
- 修改：`server/src/notebooklm/client.ts`
- 修改：`server/src/research-runtime/chat-asker.ts`
- 修改：`server/src/routes/notebooks/index.ts`
- 可能新增：`server/src/notebooklm/*.test.ts`

**意图：** 自动研究写入的是哪个 NotebookLM conversation/thread，`/messages` 就必须读取那个 conversation/thread 的原始消息，不能再出现“写一条链路、读另一条链路”的错位。

- [x] **步骤 1：梳理并测试当前 send-message 返回的 `conversationId/messageIds` 能否稳定标识活动会话**
- [x] **步骤 2：让研究运行态只保存最小活动会话标识，不保存消息正文**
- [x] **步骤 3：调整 `/messages` 的读取逻辑，优先读取当前活动会话的原始消息**
- [x] **步骤 4：当无活动会话时，再回退到 NotebookLM 历史读取策略**
- [x] **步骤 5：运行相关测试并验证消息读取与写入一致**

### 任务 4：前端消息刷新改为追加合并，不再整包覆盖

**当前状态：** 已完成

**文件：**
- 修改：`client/src/views/NotebookWorkbenchView.vue`
- 可能修改：`client/src/api/notebooks.ts`

**意图：** 消息刷新必须是“基于 id 的追加/更新合并”，不能把原有历史整包替换掉。

- [x] **步骤 1：实现消息合并函数，按 `id` 去重并保持顺序稳定**
- [x] **步骤 2：把初始加载和研究中的 `refreshMessages()` 改为使用合并函数**
- [x] **步骤 3：确保自动研究期间新增消息只会追加，不会清空旧消息**
- [x] **步骤 4：保留手动发送消息的最小 optimistic 体验，但不影响自动研究路径**

### 任务 5：收紧报告请求时机与研究控制 UI

**当前状态：** 已完成

**文件：**
- 修改：`client/src/views/NotebookWorkbenchView.vue`
- 修改：`client/src/components/notebook-workbench/StudioPanel.vue`

**意图：** `/report` 不应在页面初始化或研究完成后自动请求；自动研究 UI 也不应继续暗示固定轮次。

- [x] **步骤 1：移除页面初始化时对 `/report` 的自动读取**
- [x] **步骤 2：确保只有点击生成/查看报告时才请求报告接口**
- [x] **步骤 3：移除 Studio 中基于固定总轮次的展示语义**
- [x] **步骤 4：为持续研究增加停止入口或明确关闭动作**

### 任务 6：整体验证并提交

**当前状态：** 已完成

**文件：**
- 修改：本次涉及的全部文件

**意图：** 在合并前确认单一数据源边界重新成立。

- [x] **步骤 1：运行相关 server 测试**
- [x] **步骤 2：运行 `npx tsc --noEmit`**
- [x] **步骤 3：运行 `npx vue-tsc --noEmit`**
- [x] **步骤 4：运行 `npm run build`**
- [x] **步骤 5：提交并推送到 `main`**
