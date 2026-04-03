# Notebook Add Source Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an “Add Source” workflow in `/notebook/:id` that closely follows NotebookLM UX (search web, upload file, add website, add Google Drive, paste text), including modal interaction and source-list refresh.

**Architecture:** Build a dedicated backend source-ingestion surface under `/api/notebooks/:id/sources/*` that wraps `notebooklm-kit` add/search APIs and returns normalized responses. Frontend introduces an `AddSourceDialog` modal (based on the reference screenshot) with tab/button flows for each source type, and triggers post-action source refresh plus processing polling. Keep NotebookLM as source-of-truth for source data; no local source content persistence.

**Tech Stack:** Vue 3 + TypeScript + TailwindCSS, Hono + TypeScript, notebooklm-kit (`sources.add*`, `searchWebAndWait`, `addDiscovered`, `status`), Drizzle ORM + SQLite (only existing extension tables)

---

## Scope Check

This is independent from the sidebar icon/toggle feature and is intentionally planned as a separate implementation plan. It can be delivered and tested alone.

Reference UI for this plan:

- `docs/reference/notebooklm/notebook-addsource.png`

---

## File Structure

### Backend

- Modify: `server/src/notebooklm/client.ts`
  - Add source ingestion wrappers for URL/text/file/youtube/gdrive/web-search/discovered/status.
- Modify: `server/src/notebooklm/index.ts`
  - Export new source-ingestion wrapper functions and related types.
- Create: `server/src/routes/notebooks/source-add-validate.ts`
  - Request payload validation and normalization helpers.
- Create: `server/src/routes/notebooks/source-add-validate.test.ts`
  - Unit tests for validation helpers.
- Modify: `server/src/routes/notebooks/index.ts`
  - Add source-ingestion endpoints.

### Frontend

- Modify: `client/src/api/notebooks.ts`
  - Add typed methods for all source-ingestion endpoints.
- Create: `client/src/utils/add-source-validators.ts`
  - Frontend input validation helpers.
- Create: `client/src/utils/add-source-validators.test.ts`
  - Unit tests for frontend validators.
- Create: `client/src/components/notebook-workbench/AddSourceDialog.vue`
  - Modal UI matching NotebookLM add-source interaction model.
- Modify: `client/src/components/notebook-workbench/SourcesPanel.vue`
  - Wire Add button to open modal.
- Modify: `client/src/views/NotebookWorkbenchView.vue`
  - Own modal state, submit handlers, loading states, and source refresh/polling hooks.

---

### Task 1: Add Backend Validation Helpers For Source Ingestion Inputs

**Files:**
- Create: `server/src/routes/notebooks/source-add-validate.ts`
- Test: `server/src/routes/notebooks/source-add-validate.test.ts`

- [ ] **Step 1: Write failing tests for URL/text/search validation**

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
  const parsed = parseUrlBody({ url: "https://example.com" });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.url, "https://example.com");
});

test("parseTextBody rejects empty content", () => {
  const parsed = parseTextBody({ title: "Notes", content: "   " });
  assert.equal(parsed.ok, false);
});

test("parseSearchBody defaults to fast+web", () => {
  const parsed = parseSearchBody({ query: "agentic ai" });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.mode, "fast");
    assert.equal(parsed.value.sourceType, "web");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/routes/notebooks/source-add-validate.test.ts`
Expected: FAIL with module-not-found for `source-add-validate.js`

- [ ] **Step 3: Implement validation helpers (minimal passing version)**

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
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
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
): ParseResult<{ query: string; mode: "fast" | "deep"; sourceType: "web" | "drive" }> {
  const obj = (body ?? {}) as Record<string, unknown>;
  const query = asTrimmedString(obj.query);
  const modeRaw = asTrimmedString(obj.mode).toLowerCase();
  const sourceTypeRaw = asTrimmedString(obj.sourceType).toLowerCase();

  if (!query) return { ok: false, message: "query is required" };

  const mode = modeRaw === "deep" ? "deep" : "fast";
  const sourceType = sourceTypeRaw === "drive" ? "drive" : "web";

  if (mode === "deep" && sourceType === "drive") {
    return { ok: false, message: "deep mode only supports web sourceType" };
  }

  return { ok: true, value: { query, mode, sourceType } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/routes/notebooks/source-add-validate.test.ts`
Expected: PASS with 3 tests passed

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/notebooks/source-add-validate.ts server/src/routes/notebooks/source-add-validate.test.ts
git commit -m "test: add validation helpers for source ingestion payloads"
```

---

### Task 2: Add NotebookLM Gateway Methods For Add-Source Operations

**Files:**
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/notebooklm/index.ts`

- [ ] **Step 1: Write failing backend compile check by referencing new exports from route layer**

```ts
// server/src/routes/notebooks/index.ts (temporary import to force compile failure before implementation)
import {
  addSourceFromUrl,
  addSourceFromText,
  addSourceFromFile,
  addSourceFromYouTube,
  addSourceFromDrive,
  searchWebSources,
  addDiscoveredSources,
  getSourceProcessingStatus,
} from "../../notebooklm/index.js";
```

- [ ] **Step 2: Run build to verify it fails**

Run: `npm run build --workspace server`
Expected: FAIL with missing exports in `server/src/notebooklm/index.ts`

- [ ] **Step 3: Implement source-ingestion wrappers in gateway**

```ts
// server/src/notebooklm/client.ts (additions)
import { ResearchMode, SearchSourceType } from "notebooklm-kit";

export async function addSourceFromUrl(notebookId: string, input: { url: string; title?: string }) {
  const client = await getClient();
  const sourceId = await client.sources.addFromURL(notebookId, input);
  return { sourceId };
}

export async function addSourceFromText(notebookId: string, input: { title: string; content: string }) {
  const client = await getClient();
  const result = await client.sources.addFromText(notebookId, input);
  if (typeof result === "string") return { sourceIds: [result], wasChunked: false };
  return { sourceIds: result.allSourceIds ?? result.sourceIds ?? [], wasChunked: result.wasChunked };
}

export async function addSourceFromFile(
  notebookId: string,
  input: { fileName: string; content: Buffer; mimeType?: string },
) {
  const client = await getClient();
  const result = await client.sources.addFromFile(notebookId, input);
  if (typeof result === "string") return { sourceIds: [result], wasChunked: false };
  return { sourceIds: result.allSourceIds ?? result.sourceIds ?? [], wasChunked: result.wasChunked };
}

export async function addSourceFromYouTube(notebookId: string, input: { urlOrId: string; title?: string }) {
  const client = await getClient();
  const sourceId = await client.sources.addYouTube(notebookId, input);
  return { sourceId };
}

export async function addSourceFromDrive(
  notebookId: string,
  input: { fileId: string; title?: string; mimeType?: string },
) {
  const client = await getClient();
  const sourceId = await client.sources.addGoogleDrive(notebookId, input);
  return { sourceId };
}

export async function searchWebSources(
  notebookId: string,
  input: { query: string; mode: "fast" | "deep"; sourceType: "web" | "drive" },
) {
  const client = await getClient();
  const result = await client.sources.searchWebAndWait(notebookId, {
    query: input.query,
    mode: input.mode === "deep" ? ResearchMode.DEEP : ResearchMode.FAST,
    sourceType: input.sourceType === "drive" ? SearchSourceType.GOOGLE_DRIVE : SearchSourceType.WEB,
  });
  return result;
}

export async function addDiscoveredSources(
  notebookId: string,
  input: {
    sessionId: string;
    webSources?: Array<{ url: string; title: string; id?: string; type?: string }>;
    driveSources?: Array<{ fileId: string; mimeType: string; title: string; id?: string }>;
  },
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

```ts
// server/src/notebooklm/index.ts (export additions)
export {
  addSourceFromUrl,
  addSourceFromText,
  addSourceFromFile,
  addSourceFromYouTube,
  addSourceFromDrive,
  searchWebSources,
  addDiscoveredSources,
  getSourceProcessingStatus,
} from "./client.js";
```

- [ ] **Step 4: Run build to verify it passes**

Run: `npm run build --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/notebooklm/client.ts server/src/notebooklm/index.ts
git commit -m "feat: add notebooklm gateway methods for source ingestion workflows"
```

---

### Task 3: Add Source-Ingestion REST Endpoints

**Files:**
- Modify: `server/src/routes/notebooks/index.ts`
- Read/Reuse: `server/src/routes/notebooks/response.ts`
- Read/Reuse: `server/src/routes/notebooks/validate.ts`

- [ ] **Step 1: Write failing compile check for new route handlers imports**

```ts
// server/src/routes/notebooks/index.ts (imports)
import {
  parseUrlBody,
  parseTextBody,
  parseSearchBody,
} from "./source-add-validate.js";
```

- [ ] **Step 2: Run build to verify it fails (if Task 1 not wired yet)**

Run: `npm run build --workspace server`
Expected: FAIL on missing helper import or route type mismatch

- [ ] **Step 3: Implement add-source endpoints**

```ts
// server/src/routes/notebooks/index.ts (append routes)
notebooks.post("/:id/sources/add/url", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseUrlBody(body);
    if (!parsed.ok) {
      return c.json({ success: false, message: parsed.message, errorCode: "INVALID_URL_INPUT" }, 400);
    }
    const result = await addSourceFromUrl(id, parsed.value);
    return c.json(successResponse(result), 202);
  });
});

notebooks.post("/:id/sources/add/text", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseTextBody(body);
    if (!parsed.ok) {
      return c.json({ success: false, message: parsed.message, errorCode: "INVALID_TEXT_INPUT" }, 400);
    }
    const result = await addSourceFromText(id, parsed.value);
    return c.json(successResponse(result), 202);
  });
});

notebooks.post("/:id/sources/add/file", async (c) => {
  return await withNotebookId(c, async (id) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ success: false, message: "file is required", errorCode: "INVALID_FILE_INPUT" }, 400);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await addSourceFromFile(id, {
      fileName: file.name,
      mimeType: file.type || undefined,
      content: bytes,
    });
    return c.json(successResponse(result), 202);
  });
});

notebooks.post("/:id/sources/add/youtube", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body = (await c.req.json().catch(() => ({}))) as { urlOrId?: string; title?: string };
    const urlOrId = (body.urlOrId ?? "").trim();
    if (!urlOrId) {
      return c.json({ success: false, message: "urlOrId is required", errorCode: "INVALID_YOUTUBE_INPUT" }, 400);
    }
    const result = await addSourceFromYouTube(id, { urlOrId, title: body.title?.trim() || undefined });
    return c.json(successResponse(result), 202);
  });
});

notebooks.post("/:id/sources/add/gdrive", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body = (await c.req.json().catch(() => ({}))) as { fileId?: string; title?: string; mimeType?: string };
    const fileId = (body.fileId ?? "").trim();
    if (!fileId) {
      return c.json({ success: false, message: "fileId is required", errorCode: "INVALID_DRIVE_INPUT" }, 400);
    }
    const result = await addSourceFromDrive(id, {
      fileId,
      title: body.title?.trim() || undefined,
      mimeType: body.mimeType?.trim() || undefined,
    });
    return c.json(successResponse(result), 202);
  });
});

notebooks.post("/:id/sources/search/web", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseSearchBody(body);
    if (!parsed.ok) {
      return c.json({ success: false, message: parsed.message, errorCode: "INVALID_SEARCH_INPUT" }, 400);
    }
    const result = await searchWebSources(id, parsed.value);
    return c.json(successResponse(result));
  });
});

notebooks.post("/:id/sources/add/discovered", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      webSources?: Array<{ url: string; title: string; id?: string; type?: string }>;
      driveSources?: Array<{ fileId: string; mimeType: string; title: string; id?: string }>;
    };

    const sessionId = (body.sessionId ?? "").trim();
    if (!sessionId) {
      return c.json({ success: false, message: "sessionId is required", errorCode: "INVALID_DISCOVERED_INPUT" }, 400);
    }

    const result = await addDiscoveredSources(id, {
      sessionId,
      webSources: body.webSources,
      driveSources: body.driveSources,
    });

    return c.json(successResponse(result), 202);
  });
});

notebooks.get("/:id/sources/processing", async (c) => {
  return await withNotebookId(c, async (id) => {
    const status = await getSourceProcessingStatus(id);
    return c.json(successResponse(status));
  });
});
```

- [ ] **Step 4: Run backend build verification**

Run: `npm run build --workspace server`
Expected: PASS with all new route handlers type-safe

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/notebooks/index.ts
git commit -m "feat: add source ingestion and search endpoints for notebook workbench"
```

---

### Task 4: Add Frontend API Client + Validators For Add-Source Flows

**Files:**
- Modify: `client/src/api/notebooks.ts`
- Create: `client/src/utils/add-source-validators.ts`
- Test: `client/src/utils/add-source-validators.test.ts`

- [ ] **Step 1: Write failing tests for frontend URL/query validators**

```ts
// client/src/utils/add-source-validators.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { isHttpUrl, normalizeSearchMode } from "./add-source-validators.js";

test("isHttpUrl accepts https and rejects ftp", () => {
  assert.equal(isHttpUrl("https://example.com"), true);
  assert.equal(isHttpUrl("ftp://example.com"), false);
});

test("normalizeSearchMode only returns fast/deep", () => {
  assert.equal(normalizeSearchMode("deep"), "deep");
  assert.equal(normalizeSearchMode("other"), "fast");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/utils/add-source-validators.test.ts`
Expected: FAIL with module-not-found

- [ ] **Step 3: Implement validators + add API methods**

```ts
// client/src/utils/add-source-validators.ts
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeSearchMode(raw: string): "fast" | "deep" {
  return raw === "deep" ? "deep" : "fast";
}

export function normalizeSearchSourceType(raw: string): "web" | "drive" {
  return raw === "drive" ? "drive" : "web";
}
```

```ts
// client/src/api/notebooks.ts (append new request methods)
searchWebSources(id: string, body: { query: string; mode: "fast" | "deep"; sourceType: "web" | "drive" }) {
  return request<{
    sessionId: string;
    web: Array<{ url: string; title: string; id?: string; type?: string }>;
    drive: Array<{ fileId: string; mimeType: string; title: string; id?: string }>;
  }>(`/api/notebooks/${id}/sources/search/web`, {
    method: "POST",
    body: JSON.stringify(body),
  });
},

addUrlSource(id: string, body: { url: string; title?: string }) {
  return request<{ sourceId: string }>(`/api/notebooks/${id}/sources/add/url`, {
    method: "POST",
    body: JSON.stringify(body),
  });
},

addTextSource(id: string, body: { title: string; content: string }) {
  return request<{ sourceIds: string[]; wasChunked: boolean }>(`/api/notebooks/${id}/sources/add/text`, {
    method: "POST",
    body: JSON.stringify(body),
  });
},

addYouTubeSource(id: string, body: { urlOrId: string; title?: string }) {
  return request<{ sourceId: string }>(`/api/notebooks/${id}/sources/add/youtube`, {
    method: "POST",
    body: JSON.stringify(body),
  });
},

addDriveSource(id: string, body: { fileId: string; title?: string; mimeType?: string }) {
  return request<{ sourceId: string }>(`/api/notebooks/${id}/sources/add/gdrive`, {
    method: "POST",
    body: JSON.stringify(body),
  });
},

addDiscoveredSources(id: string, body: {
  sessionId: string;
  webSources?: Array<{ url: string; title: string; id?: string; type?: string }>;
  driveSources?: Array<{ fileId: string; mimeType: string; title: string; id?: string }>;
}) {
  return request<{ sourceIds: string[] }>(`/api/notebooks/${id}/sources/add/discovered`, {
    method: "POST",
    body: JSON.stringify(body),
  });
},

addFileSource(id: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<{ sourceIds: string[]; wasChunked: boolean }>(`/api/notebooks/${id}/sources/add/file`, {
    method: "POST",
    body: form,
  });
},

getSourceProcessing(id: string) {
  return request<{ allReady: boolean; processing: string[] }>(`/api/notebooks/${id}/sources/processing`);
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/utils/add-source-validators.test.ts`
Expected: PASS with 2 tests passed

- [ ] **Step 5: Run frontend build verification**

Run: `npm run build --workspace client`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/api/notebooks.ts client/src/utils/add-source-validators.ts client/src/utils/add-source-validators.test.ts
git commit -m "feat: add frontend source-ingestion API client and validators"
```

---

### Task 5: Build AddSourceDialog UI (NotebookLM-like)

**Files:**
- Create: `client/src/components/notebook-workbench/AddSourceDialog.vue`
- Modify: `client/src/views/NotebookWorkbenchView.vue`
- Modify: `client/src/components/notebook-workbench/SourcesPanel.vue`

- [ ] **Step 1: Add dialog component shell with props/events and fail build first**

```vue
<!-- client/src/components/notebook-workbench/AddSourceDialog.vue -->
<script setup lang="ts">
interface Props {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmitWebSearch: (payload: { query: string; mode: "fast" | "deep"; sourceType: "web" | "drive" }) => void;
  onSubmitUrl: (payload: { url: string; title?: string }) => void;
  onSubmitText: (payload: { title: string; content: string }) => void;
  onSubmitFile: (file: File) => void;
  onSubmitYouTube: (payload: { urlOrId: string; title?: string }) => void;
  onSubmitDrive: (payload: { fileId: string; title?: string; mimeType?: string }) => void;
}

defineProps<Props>();
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
    <div class="w-full max-w-3xl rounded-2xl border border-gray-200 bg-white p-6">
      <p class="text-sm text-gray-700">AddSourceDialog skeleton</p>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Run build to verify it fails until parent wiring is added**

Run: `npm run build --workspace client`
Expected: FAIL because parent components do not yet pass required props

- [ ] **Step 3: Implement dialog body matching reference interaction model**

```vue
<!-- client/src/components/notebook-workbench/AddSourceDialog.vue (main structure) -->
<script setup lang="ts">
import { ref } from "vue";
import { isHttpUrl, normalizeSearchMode, normalizeSearchSourceType } from "@/utils/add-source-validators";

interface Props {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmitWebSearch: (payload: { query: string; mode: "fast" | "deep"; sourceType: "web" | "drive" }) => void;
  onSubmitUrl: (payload: { url: string; title?: string }) => void;
  onSubmitText: (payload: { title: string; content: string }) => void;
  onSubmitFile: (file: File) => void;
  onSubmitYouTube: (payload: { urlOrId: string; title?: string }) => void;
  onSubmitDrive: (payload: { fileId: string; title?: string; mimeType?: string }) => void;
}

const props = defineProps<Props>();

const query = ref("");
const mode = ref<"fast" | "deep">("fast");
const sourceType = ref<"web" | "drive">("web");

const urlInput = ref("");
const textTitle = ref("");
const textContent = ref("");
const youtubeInput = ref("");
const driveFileId = ref("");

function submitSearch() {
  const q = query.value.trim();
  if (!q) return;
  props.onSubmitWebSearch({ query: q, mode: normalizeSearchMode(mode.value), sourceType: normalizeSearchSourceType(sourceType.value) });
}

function submitUrl() {
  const url = urlInput.value.trim();
  if (!isHttpUrl(url)) return;
  props.onSubmitUrl({ url });
}

function submitText() {
  const title = textTitle.value.trim();
  const content = textContent.value.trim();
  if (!title || !content) return;
  props.onSubmitText({ title, content });
}

function submitYouTube() {
  const urlOrId = youtubeInput.value.trim();
  if (!urlOrId) return;
  props.onSubmitYouTube({ urlOrId });
}

function submitDrive() {
  const fileId = driveFileId.value.trim();
  if (!fileId) return;
  props.onSubmitDrive({ fileId });
}

function onPickFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  props.onSubmitFile(file);
  input.value = "";
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" @click.self="onClose">
    <div class="w-full max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 space-y-5">
      <div class="flex items-center justify-between">
        <h3 class="text-xl font-semibold text-gray-900">添加来源</h3>
        <button type="button" class="text-gray-500 hover:text-gray-700" @click="onClose">✕</button>
      </div>

      <div class="rounded-xl border border-blue-400 p-4 space-y-3">
        <input v-model="query" type="text" class="w-full border border-gray-200 rounded-md px-3 py-2 text-sm" placeholder="在网络中搜索新来源" />
        <div class="flex flex-wrap gap-2">
          <select v-model="sourceType" class="text-xs border border-gray-300 rounded-full px-3 py-1.5">
            <option value="web">Web</option>
            <option value="drive">Google Drive</option>
          </select>
          <select v-model="mode" class="text-xs border border-gray-300 rounded-full px-3 py-1.5">
            <option value="fast">Fast Research</option>
            <option value="deep">Deep Research</option>
          </select>
          <button type="button" class="ml-auto text-sm rounded-full px-3 py-1.5 bg-gray-900 text-white disabled:opacity-50" :disabled="busy" @click="submitSearch">搜索</button>
        </div>
      </div>

      <div class="rounded-xl border border-dashed border-gray-300 p-5 space-y-4">
        <p class="text-center text-sm text-gray-600">或拖放文件 / 选择来源类型</p>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
          <label class="text-xs border border-gray-300 rounded-full px-3 py-2 text-center cursor-pointer hover:bg-gray-50">
            上传文件
            <input type="file" class="hidden" :disabled="busy" @change="onPickFile" />
          </label>
          <button type="button" class="text-xs border border-gray-300 rounded-full px-3 py-2" :disabled="busy" @click="submitUrl">网站</button>
          <button type="button" class="text-xs border border-gray-300 rounded-full px-3 py-2" :disabled="busy" @click="submitDrive">云端硬盘</button>
          <button type="button" class="text-xs border border-gray-300 rounded-full px-3 py-2" :disabled="busy" @click="submitText">复制的文字</button>
          <button type="button" class="text-xs border border-gray-300 rounded-full px-3 py-2" :disabled="busy" @click="submitYouTube">YouTube</button>
        </div>

        <input v-model="urlInput" type="text" class="w-full border border-gray-200 rounded-md px-3 py-2 text-sm" placeholder="输入网站 URL（https://...）" />
        <input v-model="driveFileId" type="text" class="w-full border border-gray-200 rounded-md px-3 py-2 text-sm" placeholder="输入 Google Drive fileId" />
        <input v-model="youtubeInput" type="text" class="w-full border border-gray-200 rounded-md px-3 py-2 text-sm" placeholder="输入 YouTube 链接或 video id" />
        <input v-model="textTitle" type="text" class="w-full border border-gray-200 rounded-md px-3 py-2 text-sm" placeholder="文本来源标题" />
        <textarea v-model="textContent" class="w-full border border-gray-200 rounded-md px-3 py-2 text-sm min-h-28" placeholder="粘贴文本内容" />
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Wire dialog open/close and handlers in page + panel**

```ts
// client/src/views/NotebookWorkbenchView.vue (script additions)
const addSourceOpen = ref(false);
const addSourceBusy = ref(false);

function onAddSource() {
  addSourceOpen.value = true;
}

function closeAddSource() {
  addSourceOpen.value = false;
}
```

```vue
<!-- client/src/views/NotebookWorkbenchView.vue (template additions) -->
<SourcesPanel :sources="sources" :on-add-source="onAddSource" />

<AddSourceDialog
  :open="addSourceOpen"
  :busy="addSourceBusy"
  :on-close="closeAddSource"
  :on-submit-web-search="onSubmitWebSearch"
  :on-submit-url="onSubmitUrl"
  :on-submit-text="onSubmitText"
  :on-submit-file="onSubmitFile"
  :on-submit-you-tube="onSubmitYouTube"
  :on-submit-drive="onSubmitDrive"
/>
```

- [ ] **Step 5: Run frontend build verification**

Run: `npm run build --workspace client`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/components/notebook-workbench/AddSourceDialog.vue client/src/views/NotebookWorkbenchView.vue client/src/components/notebook-workbench/SourcesPanel.vue
git commit -m "feat: add notebook-style source dialog shell for notebook workbench"
```

---

### Task 6: Connect Dialog Actions To APIs + Refresh/Poll Source Status

**Files:**
- Modify: `client/src/views/NotebookWorkbenchView.vue`
- Modify: `client/src/api/notebooks.ts`

- [ ] **Step 1: Add action handlers and fail fast with missing methods (before complete wiring)**

```ts
// client/src/views/NotebookWorkbenchView.vue (temporary signatures)
async function onSubmitWebSearch(payload: { query: string; mode: "fast" | "deep"; sourceType: "web" | "drive" }) {}
async function onSubmitUrl(payload: { url: string; title?: string }) {}
async function onSubmitText(payload: { title: string; content: string }) {}
async function onSubmitFile(file: File) {}
async function onSubmitYouTube(payload: { urlOrId: string; title?: string }) {}
async function onSubmitDrive(payload: { fileId: string; title?: string; mimeType?: string }) {}
```

- [ ] **Step 2: Run build to verify failure until full implementation is in place**

Run: `npm run build --workspace client`
Expected: FAIL if methods/events mismatch in component props

- [ ] **Step 3: Implement API-connected handlers with polling and refresh**

```ts
// client/src/views/NotebookWorkbenchView.vue (handler implementation)
async function refreshSources() {
  if (!notebookId.value) return;
  sources.value = await notebooksApi.getSources(notebookId.value);
}

async function waitUntilSourcesReady(timeoutMs = 120000) {
  if (!notebookId.value) return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await notebooksApi.getSourceProcessing(notebookId.value);
    if (status.allReady) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function runAddSourceAction(action: () => Promise<void>) {
  if (!notebookId.value) return;
  addSourceBusy.value = true;
  notice.value = "";
  try {
    await action();
    await refreshSources();
    await waitUntilSourcesReady();
    await refreshSources();
    pushNotice("来源添加成功");
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "来源添加失败");
  } finally {
    addSourceBusy.value = false;
  }
}

async function onSubmitUrl(payload: { url: string; title?: string }) {
  await runAddSourceAction(async () => {
    await notebooksApi.addUrlSource(notebookId.value, payload);
  });
}

async function onSubmitText(payload: { title: string; content: string }) {
  await runAddSourceAction(async () => {
    await notebooksApi.addTextSource(notebookId.value, payload);
  });
}

async function onSubmitFile(file: File) {
  await runAddSourceAction(async () => {
    await notebooksApi.addFileSource(notebookId.value, file);
  });
}

async function onSubmitYouTube(payload: { urlOrId: string; title?: string }) {
  await runAddSourceAction(async () => {
    await notebooksApi.addYouTubeSource(notebookId.value, payload);
  });
}

async function onSubmitDrive(payload: { fileId: string; title?: string; mimeType?: string }) {
  await runAddSourceAction(async () => {
    await notebooksApi.addDriveSource(notebookId.value, payload);
  });
}

async function onSubmitWebSearch(payload: { query: string; mode: "fast" | "deep"; sourceType: "web" | "drive" }) {
  await runAddSourceAction(async () => {
    const result = await notebooksApi.searchWebSources(notebookId.value, payload);
    await notebooksApi.addDiscoveredSources(notebookId.value, {
      sessionId: result.sessionId,
      webSources: result.web,
      driveSources: result.drive,
    });
  });
}
```

- [ ] **Step 4: Run frontend build verification**

Run: `npm run build --workspace client`
Expected: PASS with all action handlers wired

- [ ] **Step 5: Commit**

```bash
git add client/src/views/NotebookWorkbenchView.vue client/src/api/notebooks.ts
git commit -m "feat: connect add source dialog actions to backend ingestion endpoints"
```

---

## Final Verification

- [ ] **Step 1: Run backend tests + build**

Run: `node --import tsx --test src/routes/notebooks/source-add-validate.test.ts && npm run build --workspace server`
Expected: PASS

- [ ] **Step 2: Run frontend tests + build**

Run: `node --import tsx --test src/utils/add-source-validators.test.ts && npm run build --workspace client`
Expected: PASS

- [ ] **Step 3: Manual product smoke test (against a real notebook id)**

Checklist:

```text
1) Open /notebook/<real-notebook-id>
2) Click left-panel "添加" button and verify modal appears
3) Search Web (fast) -> sources added and appear in left panel
4) Add URL manually -> source appears and eventually becomes ready
5) Upload file -> source appears and processing state eventually clears
6) Add copied text -> source appears
7) Add YouTube link -> source appears
8) Add Drive fileId -> source appears
9) Refresh page -> all new sources still present (NotebookLM source-of-truth)
```

---

## Self-Review

### 1) Spec coverage check

- NotebookLM-like add-source modal entry from left sidebar: covered by Task 5.
- Search web source flow (fast/deep + web/drive constraints): covered by Task 1/2/3/6.
- Add source methods (file/url/text/youtube/drive): covered by Task 2/3/6.
- Source refresh and processing polling UX: covered by Task 6.

### 2) Placeholder scan

- No `TODO` / `TBD` / “implement later” placeholders.
- All code-changing steps include concrete snippets and commands.

### 3) Type consistency check

- `mode` and `sourceType` use `"fast" | "deep"` and `"web" | "drive"` consistently from validator -> API -> route -> gateway.
- Add-source payload names are consistent (`url`, `title`, `content`, `urlOrId`, `fileId`, `sessionId`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-03-notebook-add-source-workflow.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
