# Notebook Conversation History Mapping MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MVP conversation history layer for `/notebook/:id` by mapping NotebookLM chat response metadata into our own persisted conversation/message records and rendering that history in the workbench.

**Architecture:** Do not wait for a nonexistent NotebookLM history-read API. Instead, add a thin local persistence layer that stores each user turn, the assistant reply, and the NotebookLM conversation metadata (`conversationId`, `messageIds`) returned by `generation.chat()`. The read path for `/api/notebooks/:id/messages` then becomes our own DB-backed history for conversations created through this app, while the write path is a new chat endpoint that continues the same NotebookLM conversation correctly.

**Tech Stack:** Vue 3 + TypeScript, Hono, Drizzle ORM + SQLite, notebooklm-kit `generation.chat`, Node test runner via `tsx`

---

## Scope Check

This plan is intentionally separate from source-sidebar polish and add-source workflow. It only covers chat send/history persistence for conversations initiated inside our app.

Out of scope for this MVP:

- Backfilling old NotebookLM conversations created outside this app
- Streaming chat UI
- Citation rendering
- Multi-conversation switcher UI

---

## File Structure

### Backend

- Modify: `server/src/db/schema.ts`
  - Add `notebook_conversations` and `notebook_messages` tables.
- Modify: `server/src/db/migrate.ts`
  - Create the new chat persistence tables and indexes.
- Create: `server/src/chat-history/service.ts`
  - Persist and read conversation/message records.
- Create: `server/src/chat-history/service.test.ts`
  - Unit tests for mapping and continuation helpers.
- Modify: `server/src/notebooklm/client.ts`
  - Add a chat gateway that accepts `conversationId`, `conversationHistory`, and `sourceIds`, and returns normalized assistant metadata.
- Modify: `server/src/notebooklm/index.ts`
  - Export the new gateway function and related types.
- Modify: `server/src/routes/notebooks/index.ts`
  - Replace degraded empty history reads with DB-backed reads and add `POST /:id/chat/messages`.

### Frontend

- Modify: `client/src/api/notebooks.ts`
  - Add send-message request/response types and API method.
- Modify: `client/src/views/NotebookWorkbenchView.vue`
  - Implement send flow, refresh local messages, and show loading/error state.
- Modify: `client/src/components/notebook-workbench/ChatPanel.vue`
  - Replace readonly placeholder input with real input and disabled/loading states.

---

### Task 1: Add Chat History Persistence Tables And Helpers

**Files:**
- Modify: `server/src/db/schema.ts`
- Modify: `server/src/db/migrate.ts`
- Create: `server/src/chat-history/service.ts`
- Test: `server/src/chat-history/service.test.ts`

- [ ] **Step 1: Write the failing tests for message mapping and continuation lookup**

```ts
// server/src/chat-history/service.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssistantMessageRecord,
  getContinuationContextFromMessages,
} from "./service.js";

test("buildAssistantMessageRecord maps NotebookLM metadata into stored fields", () => {
  const record = buildAssistantMessageRecord("nb-1", "conv-1", {
    text: "answer",
    conversationId: "sdk-conv-1",
    messageIds: ["sdk-conv-1", "msg-2"],
    citations: [1, 2],
  });

  assert.equal(record.notebookId, "nb-1");
  assert.equal(record.conversationId, "conv-1");
  assert.equal(record.role, "assistant");
  assert.equal(record.content, "answer");
  assert.equal(record.sdkConversationId, "sdk-conv-1");
  assert.equal(record.sdkMessageId, "msg-2");
});

test("getContinuationContextFromMessages returns latest sdk conversation metadata", () => {
  const context = getContinuationContextFromMessages([
    {
      id: "m1",
      role: "user",
      content: "q1",
      sdkConversationId: null,
      sdkMessageId: null,
    },
    {
      id: "m2",
      role: "assistant",
      content: "a1",
      sdkConversationId: "sdk-conv-1",
      sdkMessageId: "msg-2",
    },
  ]);

  assert.deepEqual(context, {
    conversationId: "sdk-conv-1",
    conversationHistory: [{ role: "assistant", message: "a1" }],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/chat-history/service.test.ts`
Expected: FAIL with module-not-found for `./service.js`

- [ ] **Step 3: Add chat tables and minimal service implementation**

```ts
// server/src/db/schema.ts (add blocks)
export const notebookConversations = sqliteTable("notebook_conversations", {
  id: text("id").primaryKey(),
  notebookId: text("notebook_id").notNull(),
  title: text("title").notNull().default("新对话"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  notebookConversationUpdatedIdx: uniqueIndex("notebook_conversation_id_unique").on(table.id),
}));

export const notebookMessages = sqliteTable("notebook_messages", {
  id: text("id").primaryKey(),
  notebookId: text("notebook_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  sdkConversationId: text("sdk_conversation_id"),
  sdkMessageId: text("sdk_message_id"),
  status: text("status", { enum: ["sent", "done", "failed"] }).notNull().default("done"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

```ts
// server/src/db/migrate.ts (append SQL inside executeMultiple)
CREATE TABLE IF NOT EXISTS notebook_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  notebook_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '新对话',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notebook_messages (
  id TEXT PRIMARY KEY NOT NULL,
  notebook_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sdk_conversation_id TEXT,
  sdk_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'done',
  created_at INTEGER NOT NULL
);
```

```ts
// server/src/chat-history/service.ts
export interface StoredMessageLike {
  id: string;
  role: "user" | "assistant";
  content: string;
  sdkConversationId: string | null;
  sdkMessageId: string | null;
}

export function buildAssistantMessageRecord(
  notebookId: string,
  conversationId: string,
  response: {
    text?: string;
    conversationId?: string;
    messageIds?: [string, string];
    citations?: number[];
  },
) {
  return {
    id: crypto.randomUUID(),
    notebookId,
    conversationId,
    role: "assistant" as const,
    content: response.text ?? "",
    sdkConversationId: response.conversationId ?? null,
    sdkMessageId: response.messageIds?.[1] ?? null,
    status: "done" as const,
    createdAt: new Date(),
  };
}

export function getContinuationContextFromMessages(messages: StoredMessageLike[]) {
  const latestAssistant = [...messages].reverse().find((message) => {
    return message.role === "assistant" && message.sdkConversationId && message.sdkMessageId;
  });

  if (!latestAssistant?.sdkConversationId) {
    return { conversationId: undefined, conversationHistory: [] as Array<{ role: "user" | "assistant"; message: string }> };
  }

  return {
    conversationId: latestAssistant.sdkConversationId,
    conversationHistory: messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role, message: message.content })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/chat-history/service.test.ts`
Expected: PASS with 2 tests passed

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.ts server/src/db/migrate.ts server/src/chat-history/service.ts server/src/chat-history/service.test.ts
git commit -m "feat: add notebook chat history persistence layer"
```

---

### Task 2: Add NotebookLM Chat Gateway That Returns Persistable Metadata

**Files:**
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/notebooklm/index.ts`

- [ ] **Step 1: Write failing compile step by importing a non-existent gateway export from the route layer**

```ts
// server/src/routes/notebooks/index.ts (temporary import during implementation)
import { sendNotebookChatMessage } from "../../notebooklm/index.js";
```

- [ ] **Step 2: Run build to verify it fails**

Run: `npm run build --workspace server`
Expected: FAIL with missing export `sendNotebookChatMessage`

- [ ] **Step 3: Implement the new gateway wrapper**

```ts
// server/src/notebooklm/client.ts (additions)
export interface NotebookChatRequest {
  prompt: string;
  sourceIds?: string[];
  conversationId?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; message: string }>;
}

export interface NotebookChatResponse {
  text: string;
  conversationId?: string;
  messageIds?: [string, string];
  citations: number[];
}

export async function sendNotebookChatMessage(
  notebookId: string,
  request: NotebookChatRequest,
): Promise<NotebookChatResponse> {
  const client = await getClient();
  const result = await client.generation.chat(notebookId, request.prompt, {
    sourceIds: request.sourceIds,
    conversationId: request.conversationId,
    conversationHistory: request.conversationHistory,
  });

  if (!result.text) {
    throw new Error("Empty response from NotebookLM");
  }

  return {
    text: result.text,
    conversationId: result.conversationId,
    messageIds: result.messageIds,
    citations: result.citations ?? [],
  };
}
```

```ts
// server/src/notebooklm/index.ts (add exports)
export {
  sendNotebookChatMessage,
  type NotebookChatRequest,
  type NotebookChatResponse,
} from "./client.js";
```

- [ ] **Step 4: Run build to verify it passes**

Run: `npm run build --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/notebooklm/client.ts server/src/notebooklm/index.ts
git commit -m "feat: expose notebook chat gateway metadata for history persistence"
```

---

### Task 3: Replace Degraded Message Reads With DB-Backed History And Add Send Route

**Files:**
- Modify: `server/src/routes/notebooks/index.ts`
- Modify: `server/src/chat-history/service.ts`

- [ ] **Step 1: Write the failing route-level behavior test as service-level coverage**

```ts
// server/src/chat-history/service.test.ts (append)
import test from "node:test";
import assert from "node:assert/strict";
import { toChatMessagesResponse } from "./service.js";

test("toChatMessagesResponse sorts messages by createdAt ascending", () => {
  const result = toChatMessagesResponse([
    {
      id: "2",
      role: "assistant",
      content: "a1",
      status: "done",
      createdAt: new Date("2026-04-03T10:01:00Z"),
    },
    {
      id: "1",
      role: "user",
      content: "q1",
      status: "sent",
      createdAt: new Date("2026-04-03T10:00:00Z"),
    },
  ] as any);

  assert.deepEqual(result.map((item) => item.id), ["1", "2"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/chat-history/service.test.ts`
Expected: FAIL with missing export `toChatMessagesResponse`

- [ ] **Step 3: Implement read/write service methods and route wiring**

```ts
// server/src/chat-history/service.ts (additions)
export interface ChatMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: "sent" | "done" | "failed";
}

export function toChatMessagesResponse(rows: Array<{
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  status: "sent" | "done" | "failed";
}>): ChatMessageDto[] {
  return [...rows]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      status: row.status,
    }));
}
```

```ts
// server/src/routes/notebooks/index.ts (replace GET /:id/messages and add POST route)
notebooks.get("/:id/messages", async (c) => {
  return await withNotebookId(c, async (id) => {
    const messages = await listNotebookMessages(id);
    return c.json(successResponse(toChatMessagesResponse(messages)));
  });
});

notebooks.post("/:id/chat/messages", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body = await c.req.json<{ content?: string; conversationId?: string }>().catch(() => ({}));
    const content = body.content?.trim() ?? "";

    if (!content) {
      return c.json({ success: false, message: "content is required", errorCode: "INVALID_CONTENT" }, 400);
    }

    const sources = await getNotebookSources(id);
    const stateMap = await listSourceStateMap(id);
    const merged = mergeSourceStates(sources, stateMap);
    const sourceIds = listEnabledSourceIds(merged);

    const conversation = await getOrCreateConversation(id, body.conversationId);
    const existingMessages = await listConversationMessages(conversation.id);
    const continuation = getContinuationContextFromMessages(existingMessages);

    await createUserMessage(id, conversation.id, content);

    const response = await sendNotebookChatMessage(id, {
      prompt: content,
      sourceIds,
      conversationId: continuation.conversationId,
      conversationHistory: continuation.conversationHistory,
    });

    await createAssistantMessage(buildAssistantMessageRecord(id, conversation.id, response));

    const nextMessages = await listNotebookMessages(id);
    return c.json(successResponse({ conversationId: conversation.id, messages: toChatMessagesResponse(nextMessages) }));
  });
});
```

- [ ] **Step 4: Run targeted verification**

Run:

- `node --import tsx --test src/chat-history/service.test.ts`
- `npm run build --workspace server`

Expected:

- service tests pass
- server build passes
- `/api/notebooks/:id/messages` no longer depends on degraded empty SDK read

- [ ] **Step 5: Commit**

```bash
git add server/src/chat-history/service.ts server/src/chat-history/service.test.ts server/src/routes/notebooks/index.ts
git commit -m "feat: persist notebook workbench chat messages"
```

---

### Task 4: Wire The Workbench Chat UI To The New Message APIs

**Files:**
- Modify: `client/src/api/notebooks.ts`
- Modify: `client/src/views/NotebookWorkbenchView.vue`
- Modify: `client/src/components/notebook-workbench/ChatPanel.vue`

- [ ] **Step 1: Write the failing client compile step by referencing a missing send API method**

```ts
// client/src/views/NotebookWorkbenchView.vue (temporary during implementation)
await notebooksApi.sendMessage(notebookId.value, { content: draft.value });
```

- [ ] **Step 2: Run build to verify it fails**

Run: `npm run build --workspace client`
Expected: FAIL with missing `sendMessage` on `notebooksApi`

- [ ] **Step 3: Implement the client API and UI wiring**

```ts
// client/src/api/notebooks.ts (additions)
export interface SendMessageRequest {
  content: string;
  conversationId?: string;
}

export interface SendMessageResponse {
  conversationId: string;
  messages: ChatMessage[];
}

sendMessage(id: string, body: SendMessageRequest) {
  return request<SendMessageResponse>(`/api/notebooks/${id}/chat/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
},
```

```ts
// client/src/views/NotebookWorkbenchView.vue (shape only)
const activeConversationId = ref("");
const sending = ref(false);

async function onSendMessage(content: string) {
  if (!notebookId.value || !content.trim() || sending.value) return;

  sending.value = true;
  notice.value = "";
  try {
    const result = await notebooksApi.sendMessage(notebookId.value, {
      content,
      conversationId: activeConversationId.value || undefined,
    });
    activeConversationId.value = result.conversationId;
    messages.value = result.messages;
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "发送消息失败");
  } finally {
    sending.value = false;
  }
}
```

```vue
<!-- client/src/components/notebook-workbench/ChatPanel.vue (shape only) -->
<script setup lang="ts">
import { ref } from "vue";
const draft = ref("");
function handleSubmit() {
  const value = draft.value.trim();
  if (!value) return;
  props.onSend(value);
  draft.value = "";
}
</script>
```

- [ ] **Step 4: Run targeted verification**

Run:

- `npm run build --workspace client`
- `npm run build --workspace server`

Expected:

- client build passes
- server build passes
- workbench can send a message, receive a reply, and re-open with persisted history

- [ ] **Step 5: Commit**

```bash
git add client/src/api/notebooks.ts client/src/views/NotebookWorkbenchView.vue client/src/components/notebook-workbench/ChatPanel.vue
git commit -m "feat: wire notebook workbench chat to persisted history api"
```

---

## Self-Review

- Spec coverage: this plan covers persistence, metadata mapping, send route, read route, and UI wiring.
- Placeholder scan: no `TODO`/`TBD` placeholders remain.
- Type consistency: uses `conversationId`, `messageIds`, `sourceIds`, and `ChatMessage` consistently across backend and frontend tasks.
