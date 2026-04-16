# 来源处理中轮询与就绪反馈 MVP 实施计划

> **面向智能体工作者：** 必需子技能：使用 `superpowers:subagent-driven-development` 逐任务实施此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**当前状态：** 未开始

**目标：** 在来源导入完成后轮询 NotebookLM 的处理状态，并在工作台里给出明确的就绪反馈。

**架构：** 后端只暴露一个来源处理状态接口，前端负责轮询节奏和状态归一化。UI 只保留 `idle`、`processing`、`ready`、`error` 四种稳定状态，避免引入更细的中间态。

**技术栈：** Vue 3 + TypeScript、Hono + TypeScript、`notebooklm-kit`、现有 Notebook 工作台组件

---

## Scope Check

This plan is intentionally separate from add-source ingestion, source visual polish, and notebook list page work.

This MVP includes:

- Backend status endpoint normalization
- Frontend polling lifecycle
- Readiness banner/notice feedback
- Source-list status refresh after processing completes

Out of scope for this MVP:

- Per-source progress percentages
- Realtime push updates from server
- Animated upload/processing timelines
- Source preview or content inspection

---

## 文件结构

### Backend

- Modify: `server/src/notebooklm/client.ts`
  - Normalize source processing status if needed.
- Modify: `server/src/notebooklm/index.ts`
  - Export the normalized status type/function if needed.
- Modify: `server/src/routes/notebooks/index.ts`
  - Add or finalize `GET /api/notebooks/:id/sources/status`.

### Frontend

- Modify: `client/src/api/notebooks.ts`
  - Add status polling response type and API method.
- Create: `client/src/utils/source-processing.ts`
  - Centralize client-side readiness state derivation.
- Create: `client/src/utils/source-processing.test.ts`
  - Unit tests for readiness-state helpers.
- Modify: `client/src/views/NotebookWorkbenchView.vue`
  - Manage polling timer lifecycle, busy state, and source refresh after readiness.
- Modify: `client/src/components/notebook-workbench/SourcesPanel.vue`
  - Show lightweight processing/ready hints.

---

### Task 1: Normalize Source Processing Status On The Backend

**Files:**
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/notebooklm/index.ts`
- Modify: `server/src/routes/notebooks/index.ts`

- [ ] **Step 1: Define the normalized processing response shape**

Pseudocode:

```text
type SourceProcessingStatus = {
  allReady: boolean
  processing: string[]
}
```

Requirements:

- Keep the response minimal for MVP
- Do not mix source list payload into this endpoint

- [ ] **Step 2: Add or finalize `GET /api/notebooks/:id/sources/status`**

Pseudocode:

```text
GET /api/notebooks/:id/sources/status:
  validate notebook id
  call gateway status function
  return successResponse({ allReady, processing })
```

Requirements:

- Reuse the existing auth guard and route helpers
- Keep errors aligned with current notebooks route behavior

- [ ] **Step 3: Run targeted verification**

Run:

- `npm run build --workspace server`

Expected:

- server build passes
- status endpoint is available to frontend polling logic

- [ ] **Step 4: Commit**

```bash
git add server/src/notebooklm/client.ts server/src/notebooklm/index.ts server/src/routes/notebooks/index.ts
git commit -m "feat: expose normalized source processing status"
```

---

### Task 2: Add Client Readiness-State Helpers

**Files:**
- Create: `client/src/utils/source-processing.ts`
- Create: `client/src/utils/source-processing.test.ts`

- [ ] **Step 1: Define the client-side readiness model**

Pseudocode:

```text
type SourceProcessingUiState =
  | "idle"
  | "processing"
  | "ready"
  | "error"
```

Requirements:

- The model must be simple enough to reuse in both the banner/notice area and source panel
- Do not invent extra transitional states unless the current UI needs them

- [ ] **Step 2: Add helper behavior and tests**

Pseudocode:

```text
deriveUiState(input):
  if request failed -> error
  else if processing.length > 0 -> processing
  else if allReady -> ready
  else -> idle

shouldContinuePolling(input):
  return input.processing.length > 0
```

Test cases:

- processing IDs present -> `processing`
- all ready and no processing -> `ready`
- failed request -> `error`
- empty initial state -> `idle`

- [ ] **Step 3: Run targeted verification**

Run:

- `node --import tsx --test src/utils/source-processing.test.ts`
- `npm run build --workspace client`

Expected:

- helper tests pass
- client build passes

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/source-processing.ts client/src/utils/source-processing.test.ts
git commit -m "feat: add source processing ui state helpers"
```

---

### Task 3: Add Frontend Polling Lifecycle To The Notebook Workbench

**Files:**
- Modify: `client/src/api/notebooks.ts`
- Modify: `client/src/views/NotebookWorkbenchView.vue`

- [ ] **Step 1: Add the source processing status API method**

Pseudocode:

```text
notebooksApi.getSourceProcessingStatus(id):
  GET /api/notebooks/:id/sources/status
```

Requirements:

- Keep response typing local to `client/src/api/notebooks.ts`
- Reuse the existing generic request helper

- [ ] **Step 2: Define polling lifecycle in the workbench view**

Pseudocode:

```text
state:
  sourceProcessingState
  sourceProcessingIds
  pollingTimer

startPolling():
  if timer already exists -> return
  poll immediately
  repeat every N seconds

stopPolling():
  clear timer

pollOnce():
  call getSourceProcessingStatus
  update ui state
  if allReady:
    refresh sources
    stop polling
```

Requirements:

- Polling must stop on component unmount
- Polling must stop when route notebook id changes
- Polling must not create overlapping timers

- [ ] **Step 3: Hook polling into add-source success paths**

Pseudocode:

```text
after add source success:
  refresh sources once
  startPolling()
```

Requirements:

- Polling should not start during unrelated actions like report generation
- Source toggle should not trigger processing polling

- [ ] **Step 4: Run targeted verification**

Run:

- `npm run build --workspace client`

Expected:

- workbench compiles
- polling lifecycle can start, stop, and refresh source data after readiness

- [ ] **Step 5: Commit**

```bash
git add client/src/api/notebooks.ts client/src/views/NotebookWorkbenchView.vue
git commit -m "feat: add workbench polling for source processing readiness"
```

---

### Task 4: Show Clear Readiness Feedback In The Sources UI

**Files:**
- Modify: `client/src/components/notebook-workbench/SourcesPanel.vue`
- Modify: `client/src/views/NotebookWorkbenchView.vue`

- [ ] **Step 1: Define the MVP feedback surfaces**

Pseudocode:

```text
feedback surfaces:
  top-level notice/banner in workbench
  small inline hint in sources panel header or above list
  optional per-source text if source.id is still processing
```

Requirements:

- Prefer text feedback over complex visual indicators
- Keep the messaging short and stable

- [ ] **Step 2: Decide the user-facing copy for each state**

Suggested copy set:

- `processing`: `来源处理中，完成后会自动刷新。`
- `ready`: `来源已就绪。`
- `error`: `来源状态检查失败，请稍后重试。`

Requirements:

- Do not spam repeated success notices every polling cycle
- `ready` notice may be transient or shown only once after a processing cycle completes

- [ ] **Step 3: Pass readiness state into the sources panel**

Pseudocode:

```text
SourcesPanel props:
  sourceProcessingState
  processingSourceIds
```

Requirements:

- Keep the panel stateless regarding polling itself
- The parent view owns polling and derived state

- [ ] **Step 4: Run targeted verification**

Run:

- `npm run build --workspace client`

Expected:

- sources panel compiles with the new readiness props
- processing and ready states can be represented without changing source toggle behavior

- [ ] **Step 5: Commit**

```bash
git add client/src/components/notebook-workbench/SourcesPanel.vue client/src/views/NotebookWorkbenchView.vue
git commit -m "feat: show source readiness feedback in workbench"
```

---

## Self-Review

- Spec coverage: covers backend status endpoint normalization, client readiness helpers, polling lifecycle, and UI readiness feedback.
- Placeholder scan: implementation details are intentionally expressed as pseudocode only, per request.
- Type consistency: the same `allReady`, `processing`, and `SourceProcessingUiState` concepts are used throughout the plan.
