# Notebook Add Source MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the fastest useful MVP for “添加来源” in `/notebook/:id`, covering the source types shown in `docs/reference/notebooklm/notebook-addsource.png` and refreshing the source list after each successful add.

**Architecture:** Add a small backend ingestion surface under `/api/notebooks/:id/sources/add/*` that wraps `notebooklm-kit` source APIs for website, copied text, file upload, and web/drive search discovery. On the frontend, replace the current placeholder add action with a lightweight modal that mirrors the reference interaction model: top search area plus quick actions for file, website, drive, and copied text. Keep this MVP focused on working flows and source refresh; exclude favicon loading and other visual polish.

**Tech Stack:** Vue 3 + TypeScript + TailwindCSS, Hono + TypeScript, notebooklm-kit sources service, Drizzle ORM + SQLite only where already needed, Node test runner via `tsx`

---

## Scope Check

Reference UI:

- `docs/reference/notebooklm/notebook-addsource.png`

This MVP includes:

- Website URL add
- Copied text add
- File upload add
- Search web and add discovered results
- Search Drive and add discovered results
- Source list refresh after add

Out of scope for this MVP:

- Frontend-rendered website favicon logic
- Source content preview
- Drag-and-drop polish beyond basic file selection
- Batch editing of source metadata

---

## File Structure

### Backend

- Create: `server/src/routes/notebooks/source-add-validate.ts`
  - Request validation helpers for the add-source endpoints.
- Create: `server/src/routes/notebooks/source-add-validate.test.ts`
  - Unit tests for add-source payload parsing.
- Modify: `server/src/notebooklm/client.ts`
  - Add source-ingestion wrappers for url/text/file/search/discovered/status.
- Modify: `server/src/notebooklm/index.ts`
  - Export the new wrappers and related types.
- Modify: `server/src/routes/notebooks/index.ts`
  - Add ingestion endpoints under `/sources/add/*` and a processing-status endpoint.

### Frontend

- Modify: `client/src/api/notebooks.ts`
  - Add typed methods for the new add-source endpoints.
- Create: `client/src/utils/add-source-validators.ts`
  - Frontend guards for URL/text/search inputs.
- Create: `client/src/utils/add-source-validators.test.ts`
  - Unit tests for the frontend validators.
- Create: `client/src/components/notebook-workbench/AddSourceDialog.vue`
  - Lightweight modal matching the reference structure.
- Modify: `client/src/views/NotebookWorkbenchView.vue`
  - Own modal state, submit handlers, source refresh, and status polling.
- Modify: `client/src/components/notebook-workbench/SourcesPanel.vue`
  - Replace placeholder add action with dialog open.

---

### Task 1: Add Backend Validation Helpers For MVP Source Inputs

**Files:**
- Create: `server/src/routes/notebooks/source-add-validate.ts`
- Test: `server/src/routes/notebooks/source-add-validate.test.ts`

- [ ] **Step 1: Write failing tests for URL, text, and search payload parsing**

```ts
// server/src/routes/notebooks/source-add-validate.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseUrlBody,
  parseTextBody,
  parseSearchBody,
} from "./source-add-validate.js";

test("parseUrlBody accepts https url", () => {
  const result = parseUrlBody({ url: "https://example.com/article" });
  assert.equal(result.ok, true);
});

test("parseTextBody rejects empty title", () => {
  const result = parseTextBody({ title: "", content: "notes" });
  assert.equal(result.ok, false);
});

test("parseSearchBody defaults sourceType to web", () => {
  const result = parseSearchBody({ query: "agentic search" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.sourceType, "web");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/routes/notebooks/source-add-validate.test.ts`
Expected: FAIL with module-not-found for `source-add-validate.js`

- [ ] **Step 3: Implement validation helpers**

```ts
// server/src/routes/notebooks/source-add-validate.ts
type Ok<T> = { ok: true; value: T };
type Err = { ok: false; message: string };
type ParseResult<T> = Ok<T> | Err;

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseUrlBody(body: unknown): ParseResult<{ url: string; title?: string }> {
  const obj = (body ?? {}) as Record<string, unknown>;
  const url = asTrimmedString(obj.url);
  const title = asTrimmedString(obj.title);
  if (!url || !isHttpUrl(url)) return { ok: false, message: "Invalid url" };
  return { ok: true, value: { url, ...(title ? { title } : {}) } };
}

export function parseTextBody(body: unknown): ParseResult<{ title: string; content: string }> {
  const obj = (body ?? {}) as Record<string, unknown>;
  const title = asTrimmedString(obj.title);
  const content = asTrimmedString(obj.content);
  if (!title) return { ok: false, message: "title is required" };
  if (!content) return { ok: false, message: "content is required" };
  return { ok: true, value: { title, content } };
}

export function parseSearchBody(
  body: unknown,
): ParseResult<{ query: string; sourceType: "web" | "drive"; mode: "fast" | "deep" }> {
  const obj = (body ?? {}) as Record<string, unknown>;
  const query = asTrimmedString(obj.query);
  const sourceType = asTrimmedString(obj.sourceType).toLowerCase() === "drive" ? "drive" : "web";
  const mode = asTrimmedString(obj.mode).toLowerCase() === "deep" ? "deep" : "fast";
  if (!query) return { ok: false, message: "query is required" };
  if (mode === "deep" && sourceType === "drive") {
    return { ok: false, message: "deep mode only supports web" };
  }
  return { ok: true, value: { query, sourceType, mode } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/routes/notebooks/source-add-validate.test.ts`
Expected: PASS with 3 tests passed

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/notebooks/source-add-validate.ts server/src/routes/notebooks/source-add-validate.test.ts
git commit -m "test: add mvp source ingestion validators"
```

---

### Task 2: Add NotebookLM Source-Ingestion Gateway Methods

**Files:**
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/notebooklm/index.ts`

- [ ] **Step 1: Write failing compile step by importing missing source-ingestion exports from the route layer**

```ts
// server/src/routes/notebooks/index.ts (temporary during implementation)
import {
  addSourceFromUrl,
  addSourceFromText,
  addSourceFromFile,
  searchWebSources,
  addDiscoveredSources,
  getSourceProcessingStatus,
} from "../../notebooklm/index.js";
```

- [ ] **Step 2: Run build to verify it fails**

Run: `npm run build --workspace server`
Expected: FAIL with missing exports in `server/src/notebooklm/index.ts`

- [ ] **Step 3: Implement the minimal gateway wrappers**

```ts
// server/src/notebooklm/client.ts (additions)
import { ResearchMode, SearchSourceType } from "notebooklm-kit";

export async function addSourceFromUrl(notebookId: string, input: { url: string; title?: string }) {
  const client = await getClient();
  const sourceId = await client.sources.addFromURL(notebookId, input);
  return { sourceIds: [sourceId], wasChunked: false };
}

export async function addSourceFromText(notebookId: string, input: { title: string; content: string }) {
  const client = await getClient();
  const result = await client.sources.addFromText(notebookId, input);
  if (typeof result === "string") return { sourceIds: [result], wasChunked: false };
  return { sourceIds: result.allSourceIds ?? result.sourceIds ?? [], wasChunked: result.wasChunked };
}

export async function addSourceFromFile(notebookId: string, input: { fileName: string; content: Buffer; mimeType?: string }) {
  const client = await getClient();
  const result = await client.sources.addFromFile(notebookId, input);
  if (typeof result === "string") return { sourceIds: [result], wasChunked: false };
  return { sourceIds: result.allSourceIds ?? result.sourceIds ?? [], wasChunked: result.wasChunked };
}

export async function searchWebSources(
  notebookId: string,
  input: { query: string; sourceType: "web" | "drive"; mode: "fast" | "deep" },
) {
  const client = await getClient();
  return client.sources.searchWebAndWait(notebookId, {
    query: input.query,
    mode: input.mode === "deep" ? ResearchMode.DEEP : ResearchMode.FAST,
    sourceType: input.sourceType === "drive" ? SearchSourceType.GOOGLE_DRIVE : SearchSourceType.WEB,
  });
}

export async function addDiscoveredSources(
  notebookId: string,
  input: { sessionId: string; webSources?: Array<{ title: string; url: string }>; driveSources?: Array<{ id: string; title: string; mimeType?: string }> },
) {
  const client = await getClient();
  const sourceIds = await client.sources.addDiscovered(notebookId, input);
  return { sourceIds };
}

export async function getSourceProcessingStatus(notebookId: string) {
  const client = await getClient();
  return client.sources.status(notebookId);
}
```

- [ ] **Step 4: Export the wrappers and run build**

Run: `npm run build --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/notebooklm/client.ts server/src/notebooklm/index.ts
git commit -m "feat: add notebook source ingestion gateway methods"
```

---

### Task 3: Add Backend Endpoints For Add-Source MVP

**Files:**
- Modify: `server/src/routes/notebooks/index.ts`
- Modify: `server/src/routes/notebooks/source-add-validate.ts`

- [ ] **Step 1: Write the failing compile step by referencing a new route helper before implementation**

```ts
// server/src/routes/notebooks/index.ts (temporary during implementation)
const parsed = parseUrlBody(await c.req.json());
```

- [ ] **Step 2: Run build to verify it fails**

Run: `npm run build --workspace server`
Expected: FAIL until parser imports and endpoint handlers are wired

- [ ] **Step 3: Add the add-source endpoints**

```ts
// server/src/routes/notebooks/index.ts (additions)
notebooks.post("/:id/sources/add/url", async (c) => {
  return await withNotebookId(c, async (id) => {
    const parsed = parseUrlBody(await c.req.json().catch(() => ({})));
    if (!parsed.ok) return c.json({ success: false, message: parsed.message }, 400);
    const result = await addSourceFromUrl(id, parsed.value);
    return c.json(successResponse(result));
  });
});

notebooks.post("/:id/sources/add/text", async (c) => {
  return await withNotebookId(c, async (id) => {
    const parsed = parseTextBody(await c.req.json().catch(() => ({})));
    if (!parsed.ok) return c.json({ success: false, message: parsed.message }, 400);
    const result = await addSourceFromText(id, parsed.value);
    return c.json(successResponse(result));
  });
});

notebooks.post("/:id/sources/add/search", async (c) => {
  return await withNotebookId(c, async (id) => {
    const parsed = parseSearchBody(await c.req.json().catch(() => ({})));
    if (!parsed.ok) return c.json({ success: false, message: parsed.message }, 400);
    const result = await searchWebSources(id, parsed.value);
    return c.json(successResponse(result));
  });
});

notebooks.post("/:id/sources/add/discovered", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body = await c.req.json();
    const result = await addDiscoveredSources(id, body);
    return c.json(successResponse(result));
  });
});

notebooks.get("/:id/sources/status", async (c) => {
  return await withNotebookId(c, async (id) => {
    const result = await getSourceProcessingStatus(id);
    return c.json(successResponse(result));
  });
});
```

- [ ] **Step 4: Add file-upload endpoint and run targeted verification**

Run:

- `npm run build --workspace server`

Expected:

- URL/text/search/discovered/status routes compile
- file upload route can be implemented with `await c.req.formData()` and `addSourceFromFile()` without affecting the other handlers

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/notebooks/index.ts server/src/routes/notebooks/source-add-validate.ts
git commit -m "feat: add notebook source ingestion endpoints"
```

---

### Task 4: Add Frontend Validators And API Methods For Source Ingestion

**Files:**
- Create: `client/src/utils/add-source-validators.ts`
- Create: `client/src/utils/add-source-validators.test.ts`
- Modify: `client/src/api/notebooks.ts`

- [ ] **Step 1: Write failing validator tests**

```ts
// client/src/utils/add-source-validators.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { isValidHttpUrl, normalizeSearchQuery } from "./add-source-validators.js";

test("isValidHttpUrl accepts https", () => {
  assert.equal(isValidHttpUrl("https://example.com"), true);
});

test("normalizeSearchQuery trims whitespace", () => {
  assert.equal(normalizeSearchQuery("  ai agents  "), "ai agents");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/utils/add-source-validators.test.ts`
Expected: FAIL with module-not-found for `add-source-validators.js`

- [ ] **Step 3: Implement validators and API methods**

```ts
// client/src/utils/add-source-validators.ts
export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeSearchQuery(value: string): string {
  return value.trim();
}
```

```ts
// client/src/api/notebooks.ts (additions)
addSourceFromUrl(id: string, body: { url: string; title?: string }) {
  return request<{ sourceIds: string[]; wasChunked: boolean }>(`/api/notebooks/${id}/sources/add/url`, {
    method: "POST",
    body: JSON.stringify(body),
  });
},

addSourceFromText(id: string, body: { title: string; content: string }) {
  return request<{ sourceIds: string[]; wasChunked: boolean }>(`/api/notebooks/${id}/sources/add/text`, {
    method: "POST",
    body: JSON.stringify(body),
  });
},

searchSources(id: string, body: { query: string; sourceType: "web" | "drive"; mode: "fast" | "deep" }) {
  return request<any>(`/api/notebooks/${id}/sources/add/search`, {
    method: "POST",
    body: JSON.stringify(body),
  });
},

addDiscoveredSources(id: string, body: Record<string, unknown>) {
  return request<{ sourceIds: string[] }>(`/api/notebooks/${id}/sources/add/discovered`, {
    method: "POST",
    body: JSON.stringify(body),
  });
},

getSourceProcessingStatus(id: string) {
  return request<{ allReady: boolean; processing: string[] }>(`/api/notebooks/${id}/sources/status`);
},
```

- [ ] **Step 4: Run targeted verification**

Run:

- `node --import tsx --test src/utils/add-source-validators.test.ts`
- `npm run build --workspace client`

Expected:

- validator tests pass
- client build passes with new source-ingestion API methods

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/add-source-validators.ts client/src/utils/add-source-validators.test.ts client/src/api/notebooks.ts
git commit -m "feat: add client validation and api methods for source ingestion"
```

---

### Task 5: Build The Add-Source Dialog MVP And Refresh Flow

**Files:**
- Create: `client/src/components/notebook-workbench/AddSourceDialog.vue`
- Modify: `client/src/views/NotebookWorkbenchView.vue`
- Modify: `client/src/components/notebook-workbench/SourcesPanel.vue`

- [ ] **Step 1: Write the failing compile step by importing a missing dialog component**

```ts
// client/src/views/NotebookWorkbenchView.vue (temporary during implementation)
import AddSourceDialog from "@/components/notebook-workbench/AddSourceDialog.vue";
```

- [ ] **Step 2: Run build to verify it fails**

Run: `npm run build --workspace client`
Expected: FAIL with missing file `AddSourceDialog.vue`

- [ ] **Step 3: Implement the dialog and view wiring**

```vue
<!-- client/src/components/notebook-workbench/AddSourceDialog.vue -->
<script setup lang="ts">
interface Props {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onAddUrl: (payload: { url: string; title?: string }) => void;
  onAddText: (payload: { title: string; content: string }) => void;
  onSearch: (payload: { query: string; sourceType: "web" | "drive"; mode: "fast" | "deep" }) => void;
  onPickFile: (file: File) => void;
}
</script>
```

```ts
// client/src/views/NotebookWorkbenchView.vue (shape only)
const addSourceOpen = ref(false);
const addSourceBusy = ref(false);

async function refreshSources() {
  if (!notebookId.value) return;
  sources.value = await notebooksApi.getSources(notebookId.value);
}

async function onAddSourceUrl(payload: { url: string; title?: string }) {
  if (!notebookId.value) return;
  addSourceBusy.value = true;
  try {
    await notebooksApi.addSourceFromUrl(notebookId.value, payload);
    await refreshSources();
    addSourceOpen.value = false;
  } finally {
    addSourceBusy.value = false;
  }
}
```

```vue
<!-- client/src/components/notebook-workbench/SourcesPanel.vue (shape only) -->
<button type="button" @click="onAddSource">添加</button>
```

- [ ] **Step 4: Add processing polling and run targeted verification**

Run:

- `npm run build --workspace client`
- `npm run build --workspace server`

Expected:

- add-source dialog opens from the sources panel
- one successful add refreshes the source list
- polling can call `/api/notebooks/:id/sources/status` until `allReady === true`

- [ ] **Step 5: Commit**

```bash
git add client/src/components/notebook-workbench/AddSourceDialog.vue client/src/views/NotebookWorkbenchView.vue client/src/components/notebook-workbench/SourcesPanel.vue
git commit -m "feat: add notebook source dialog mvp"
```

---

## Self-Review

- Spec coverage: this plan covers the add-source reference flow and splits backend ingestion from frontend dialog work.
- Placeholder scan: no favicon-related tasks or open-ended polish placeholders remain.
- Type consistency: `sourceType`, `mode`, `sourceIds`, and processing-status fields are consistent across tasks.
