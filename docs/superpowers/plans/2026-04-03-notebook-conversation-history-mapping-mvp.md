# Notebook Workbench Chat Without Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:子智能体驱动开发 to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `/notebook/:id` to send chat messages to NotebookLM from the workbench without adding any local persistence layer.

**Architecture:** Keep chat state in the browser only for the current page session. The server adds a thin chat-send endpoint that forwards the prompt, enabled source IDs, and optional in-memory continuation context to NotebookLM. We explicitly do not store conversation/message records in SQLite and we do not attempt to reconstruct history after a reload.

**Tech Stack:** Vue 3 + TypeScript, Hono, notebooklm-kit `generation.chat`, Node test runner via `tsx`

---

## Scope Check

This plan only covers sending messages from the workbench during the current browser session.

In scope:

- Sending a prompt from the workbench UI
- Returning the assistant reply immediately
- Continuing the same NotebookLM conversation during the current page session by passing client-held context back to the server
- Keeping the existing degraded read endpoint behavior for history

Out of scope for this MVP:

- Any server-side persistence of conversations or messages
- Rehydrating chat history after page refresh or reopen
- Backfilling old NotebookLM conversations created outside this app
- Streaming chat UI
- Citation rendering
- Multi-conversation switcher UI

---

## File Structure

### Backend

- Modify: `server/src/notebooklm/client.ts`
  - Add a chat gateway wrapper for `generation.chat()` that accepts optional continuation context and source filtering.
- Modify: `server/src/notebooklm/index.ts`
  - Export the new gateway function and related types.
- Modify: `server/src/routes/notebooks/index.ts`
  - Add `POST /:id/chat/messages` for direct NotebookLM chat sends.

### Frontend

- Modify: `client/src/api/notebooks.ts`
  - Add send-message request/response types and API method.
- Modify: `client/src/views/NotebookWorkbenchView.vue`
  - Hold chat messages and NotebookLM continuation metadata in memory for the current page session.
- Modify: `client/src/components/notebook-workbench/ChatPanel.vue`
  - Replace the placeholder input with a working composer and sending state.

---

### Task 1: Add A NotebookLM Chat Gateway For Current-Session Continuation

**Files:**
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/notebooklm/index.ts`

**Intent:** Expose a focused gateway for workbench chat that can continue a NotebookLM conversation when the client sends `conversationId` and `conversationHistory`, while keeping all state ephemeral.

- [ ] **Step 1: Write the failing compile step**

  Add a temporary import in `server/src/routes/notebooks/index.ts` for `sendNotebookChatMessage` before the export exists.

- [ ] **Step 2: Run build to verify it fails**

  Run: `npm run build --workspace server`
  Expected: FAIL because `sendNotebookChatMessage` is not exported yet.

- [ ] **Step 3: Implement the gateway wrapper**

  Add these backend types and behavior in `server/src/notebooklm/client.ts`:

  - `NotebookChatHistoryItem` with `{ role: "user" | "assistant"; message: string }`
  - `NotebookChatRequest` with:
    - `prompt: string`
    - `sourceIds?: string[]`
    - `conversationId?: string`
    - `conversationHistory?: NotebookChatHistoryItem[]`
  - `NotebookChatResponse` with:
    - `text: string`
    - `conversationId?: string`
    - `messageIds?: [string, string]`
    - `citations: unknown[]`

  Implement `sendNotebookChatMessage(notebookId, request)` to:

  - Reuse the existing auth/quota/client flow already used by `askNotebookForResearch`
  - Call `client.generation.chat(notebookId, request.prompt, options)`
  - Pass `sourceIds`, `conversationId`, and `conversationHistory` when provided
  - Throw an error if NotebookLM returns empty text
  - Dispose the SDK client on auth-expiry style failures, matching existing client behavior

- [ ] **Step 4: Export the gateway from the public NotebookLM module**

  Update `server/src/notebooklm/index.ts` to re-export:

  - `sendNotebookChatMessage`
  - `NotebookChatHistoryItem`
  - `NotebookChatRequest`
  - `NotebookChatResponse`

- [ ] **Step 5: Run build to verify it passes**

  Run: `npm run build --workspace server`
  Expected: PASS

- [ ] **Step 6: Commit**

  ```bash
  git add server/src/notebooklm/client.ts server/src/notebooklm/index.ts server/src/routes/notebooks/index.ts
  git commit -m "feat: add notebook workbench chat gateway"
  ```

---

### Task 2: Add A Direct Chat Send Route Without Persistence

**Files:**
- Modify: `server/src/routes/notebooks/index.ts`

**Intent:** Provide a workbench endpoint that sends one prompt to NotebookLM, using currently enabled sources plus client-provided continuation metadata, and returns only the new assistant turn plus updated conversation metadata.

- [ ] **Step 1: Write the failing compile step**

  Add a temporary call in the route module to a missing helper or response field used by the new chat endpoint.

- [ ] **Step 2: Run build to verify it fails**

  Run: `npm run build --workspace server`
  Expected: FAIL because the new route code references a missing symbol or mismatched response shape.

- [ ] **Step 3: Implement `POST /:id/chat/messages`**

  Add a new route in `server/src/routes/notebooks/index.ts`.

  Request body:

  - `content: string`
  - `conversationId?: string`
  - `conversationHistory?: Array<{ role: "user" | "assistant"; message: string }>`

  Route behavior:

  - Trim and validate `content`; reject empty content with HTTP 400 and `INVALID_CONTENT`
  - Load notebook sources via existing helpers
  - Load source state overrides and filter to enabled source IDs using existing source-state utilities already used elsewhere in the notebook routes module; do not add new persistence
  - Call `sendNotebookChatMessage()` with:
    - `prompt: content`
    - enabled `sourceIds`
    - `conversationId` from the request when present
    - `conversationHistory` from the request when present
  - Return a success payload shaped like:
    - `conversationId: string | null` where the value comes from NotebookLM when provided, otherwise `null`
    - `message: { id, role, content, createdAt, status }`
    - `messageIds?: [string, string]`

  Response rules:

  - The returned message should always be the assistant turn only
  - `id` should use `response.messageIds?.[1]` when available, otherwise a generated UUID
  - `role` is always `assistant`
  - `createdAt` should be the current server timestamp in ISO format
  - `status` should be `done`

- [ ] **Step 4: Preserve the existing degraded history read behavior**

  Keep `GET /:id/messages` and `GET /:id/chat/messages` as degraded empty reads. Do not replace them with DB-backed history.

- [ ] **Step 5: Run targeted verification**

  Run: `npm run build --workspace server`
  Expected:

  - build passes
  - the new chat send route compiles cleanly
  - no database or chat-history files were introduced

- [ ] **Step 6: Commit**

  ```bash
  git add server/src/routes/notebooks/index.ts
  git commit -m "feat: add direct notebook workbench chat route"
  ```

---

### Task 3: Wire The Workbench Chat UI To The Direct Send API

**Files:**
- Modify: `client/src/api/notebooks.ts`
- Modify: `client/src/views/NotebookWorkbenchView.vue`
- Modify: `client/src/components/notebook-workbench/ChatPanel.vue`

**Intent:** Let the user send prompts from the workbench and see replies immediately, while keeping all conversation state in memory only for the current page session.

- [ ] **Step 1: Write the failing client compile step**

  Add a temporary `notebooksApi.sendMessage(...)` call in `NotebookWorkbenchView.vue` before the API method exists.

- [ ] **Step 2: Run build to verify it fails**

  Run: `npm run build --workspace client`
  Expected: FAIL because `sendMessage` does not exist yet.

- [ ] **Step 3: Implement the client API method**

  In `client/src/api/notebooks.ts`, add:

  - `SendMessageHistoryItem` with `{ role: "user" | "assistant"; message: string }`
  - `SendMessageRequest` with:
    - `content: string`
    - `conversationId?: string`
    - `conversationHistory?: SendMessageHistoryItem[]`
  - `SendMessageResponse` with:
    - `conversationId: string | null`
    - `message: ChatMessage`
    - `messageIds?: [string, string]`

  Add `sendMessage(id, body)` that POSTs to `/api/notebooks/${id}/chat/messages`.

- [ ] **Step 4: Implement in-memory send flow in `NotebookWorkbenchView.vue`**

  Add page-session-only state:

  - `sending = ref(false)`
  - `activeConversationId = ref<string | null>(null)`
  - `conversationHistory = ref<Array<{ role: "user" | "assistant"; message: string }>>([])`

  Update page lifecycle behavior:

  - Reset `messages`, `activeConversationId`, and `conversationHistory` when notebook ID changes
  - Continue to load server messages on first paint, but accept that they will usually be empty under the degraded endpoint

  Implement `onSendMessage(content: string)` to:

  - Ignore empty content and duplicate submits while `sending` is true
  - Optimistically append a user message to `messages`
  - Build the request from the current in-memory `activeConversationId` and `conversationHistory`
  - Await `notebooksApi.sendMessage()`
  - Append the returned assistant message to `messages`
  - Update `activeConversationId` from the response
  - Rebuild `conversationHistory` so it reflects the full current in-memory transcript in `{ role, message }` form
  - Surface failures through the existing notice area
  - If the send fails, remove the optimistic user message so the UI does not falsely imply delivery

- [ ] **Step 5: Replace the placeholder chat input in `ChatPanel.vue`**

  Update the component API to accept:

  - `messages: ChatMessage[]`
  - `sending: boolean`
  - `onSend: (content: string) => void`

  UI behavior:

  - Use a local `draft` ref
  - Submit on button click and Enter key
  - Ignore blank messages
  - Disable input and button while `sending` is true
  - Change button text to `发送中...` while sending
  - Keep the existing message list rendering style unless a small change is needed for usability

- [ ] **Step 6: Add an explicit empty-state notice for non-persistent history**

  Make it clear in the chat panel or existing page notice that conversation history is only kept for the current page session and will not survive refresh.

- [ ] **Step 7: Run targeted verification**

  Run:

  - `npm run build --workspace client`
  - `npm run build --workspace server`

  Expected:

  - client build passes
  - server build passes
  - the workbench can send a message and display the reply during the current session
  - refreshing the page clears the unsaved conversation, by design

- [ ] **Step 8: Commit**

  ```bash
  git add client/src/api/notebooks.ts client/src/views/NotebookWorkbenchView.vue client/src/components/notebook-workbench/ChatPanel.vue
  git commit -m "feat: wire notebook workbench chat without persistence"
  ```

---

## Self-Review

- Spec coverage: the plan now covers direct chat send, optional NotebookLM continuation metadata, and in-memory client session handling only.
- Placeholder scan: no persistence-layer TODOs remain.
- Type consistency: `conversationId`, `conversationHistory`, and `messageIds` are used consistently across server and client.
- Scope guard: no database schema, migration, or local chat-history service changes are included.
