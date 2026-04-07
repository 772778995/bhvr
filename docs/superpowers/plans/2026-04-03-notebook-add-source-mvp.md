# Notebook 添加来源 MVP 实施计划

> **给代理执行者：** 实现该计划时必须使用 `superpowers:子智能体驱动开发`（推荐）或 `superpowers:executing-plans`，并按任务逐项推进。本文使用 `- [ ]` / `- [x]` 复选框维护状态。

**目标：** 为 `/notebook/:id` 实现"添加来源"的最小可用 MVP，覆盖 `docs/reference/notebooklm/notebook-addsource.png` 中展示的来源类型，并在每次成功添加后刷新来源列表。

**架构：** 在后端新增一组轻量的 `/api/notebooks/:id/sources/add/*` 接口，封装 `notebooklm-kit` 的来源能力，支持网站、复制文本、文件上传以及 Web/Drive 搜索发现。前端用一个轻量弹窗替换当前占位式添加动作，交互结构对齐参考图：顶部搜索区域 + 文件、网站、Drive、复制文本的快捷入口。该 MVP 只聚焦可用流程和来源刷新，不做 favicon 和额外视觉打磨。

**技术栈：** Vue 3 + TypeScript + TailwindCSS，Hono + TypeScript，`notebooklm-kit` sources service，Drizzle ORM + SQLite（仅在已有需求处使用），Node test runner + `tsx`

---

## 范围确认

参考 UI：

- `docs/reference/notebooklm/notebook-addsource.png`

本次 MVP 包含：

- 网站 URL 添加
- 复制文本添加
- 文件上传添加
- 搜索 Web 并添加发现结果
- 搜索 Drive 并添加发现结果
- 添加后刷新来源列表

本次 MVP 不包含：

- 前端渲染网站 favicon 逻辑
- 来源内容预览
- 超出基础文件选择之外的拖拽上传打磨
- 批量编辑来源元数据

---

## 文件结构

### 后端

- 新建：`server/src/routes/notebooks/source-add-validate.ts`
  - 添加来源接口的请求校验辅助函数
- 新建：`server/src/routes/notebooks/source-add-validate.test.ts`
  - 添加来源请求解析的单元测试
- 修改：`server/src/notebooklm/client.ts`
  - NotebookLM 来源写入包装方法：url/text/file/search/discovered/status
- 修改：`server/src/notebooklm/index.ts`
  - 导出上述包装方法和相关类型
- 修改：`server/src/routes/notebooks/index.ts`
  - 新增 `/sources/add/*` 接口和处理状态接口

### 前端

- 修改：`client/src/api/notebooks.ts`
  - 新增添加来源相关的类型化 API 方法
- 新建：`client/src/utils/add-source-validators.ts`
  - 前端 URL/文本/搜索输入校验工具
- 新建：`client/src/utils/add-source-validators.test.ts`
  - 前端校验工具测试
- 新建：`client/src/components/notebook-workbench/AddSourceDialog.vue`
  - 轻量弹窗，结构对齐参考交互
- 修改：`client/src/views/NotebookWorkbenchView.vue`
  - 管理弹窗状态、提交逻辑、来源刷新和处理状态轮询
- 修改：`client/src/components/notebook-workbench/SourcesPanel.vue`
  - 将占位按钮替换为真正的打开弹窗动作

---

### 任务 1：为 MVP 来源输入补齐后端校验辅助函数

**文件：**
- 新建：`server/src/routes/notebooks/source-add-validate.ts`
- 测试：`server/src/routes/notebooks/source-add-validate.test.ts`

- [ ] **步骤 1：先写 URL、文本、搜索请求解析的失败测试**

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

- [ ] **步骤 2：运行测试确认先失败**

运行：`node --import tsx --test src/routes/notebooks/source-add-validate.test.ts`
预期：FAIL，报错找不到 `source-add-validate.js`

- [ ] **步骤 3：实现校验逻辑**

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

- [ ] **步骤 4：运行测试确认通过**

运行：`node --import tsx --test src/routes/notebooks/source-add-validate.test.ts`
预期：PASS，3 个测试全部通过

- [ ] **步骤 5：提交**

```bash
git add server/src/routes/notebooks/source-add-validate.ts server/src/routes/notebooks/source-add-validate.test.ts
git commit -m "test: add mvp source ingestion validators"
```

---

### 任务 2：添加 NotebookLM 来源写入网关方法

**文件：**
- 修改：`server/src/notebooklm/client.ts`
- 修改：`server/src/notebooklm/index.ts`

- [ ] **步骤 1：先通过导入缺失的来源写入导出制造失败的编译检查**

```ts
// server/src/routes/notebooks/index.ts (实现期间临时使用)
import {
  addSourceFromUrl,
  addSourceFromText,
  addSourceFromFile,
  searchWebSources,
  addDiscoveredSources,
  getSourceProcessingStatus,
} from "../../notebooklm/index.js";
```

- [ ] **步骤 2：运行构建确认先失败**

运行：`npm run build --workspace server`
预期：FAIL，报错 `server/src/notebooklm/index.ts` 缺少导出

- [ ] **步骤 3：实现最小网关包装函数**

```ts
// server/src/notebooklm/client.ts (新增部分)
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

- [ ] **步骤 4：导出包装函数并运行构建**

运行：`npm run build --workspace server`
预期：PASS

- [ ] **步骤 5：提交**

```bash
git add server/src/notebooklm/client.ts server/src/notebooklm/index.ts
git commit -m "feat: add notebook source ingestion gateway methods"
```

---

### 任务 3：添加 Add-Source MVP 后端接口

**文件：**
- 修改：`server/src/routes/notebooks/index.ts`
- 修改：`server/src/routes/notebooks/source-add-validate.ts`

- [ ] **步骤 1：先通过引用未实现路由辅助函数制造失败的编译检查**

```ts
// server/src/routes/notebooks/index.ts (实现期间临时使用)
const parsed = parseUrlBody(await c.req.json());
```

- [ ] **步骤 2：运行构建确认先失败**

运行：`npm run build --workspace server`
预期：FAIL，直到解析器导入和端点处理器连接完成

- [ ] **步骤 3：添加 add-source 系列接口**

```ts
// server/src/routes/notebooks/index.ts (新增部分)
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

- [ ] **步骤 4：补上文件上传接口并做定向验证**

运行：

- `npm run build --workspace server`

预期：

- URL/text/search/discovered/status 路由编译通过
- 文件上传路由可以用 `await c.req.formData()` 配合 `addSourceFromFile()` 实现，不影响其他处理器

- [ ] **步骤 5：提交**

```bash
git add server/src/routes/notebooks/index.ts server/src/routes/notebooks/source-add-validate.ts
git commit -m "feat: add notebook source ingestion endpoints"
```

---

### 任务 4：添加前端校验工具与来源写入 API 方法

**文件：**
- 新建：`client/src/utils/add-source-validators.ts`
- 新建：`client/src/utils/add-source-validators.test.ts`
- 修改：`client/src/api/notebooks.ts`

- [ ] **步骤 1：先写失败的校验测试**

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

- [ ] **步骤 2：运行测试确认先失败**

运行：`node --import tsx --test src/utils/add-source-validators.test.ts`
预期：FAIL，报错找不到 `add-source-validators.js`

- [ ] **步骤 3：实现校验工具和 API 方法**

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
// client/src/api/notebooks.ts (新增部分)
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

- [ ] **步骤 4：运行定向验证**

运行：

- `node --import tsx --test src/utils/add-source-validators.test.ts`
- `npm run build --workspace client`

预期：

- 校验测试通过
- client 构建通过，新添加来源的 API 方法已包含

- [ ] **步骤 5：提交**

```bash
git add client/src/utils/add-source-validators.ts client/src/utils/add-source-validators.test.ts client/src/api/notebooks.ts
git commit -m "feat: add client validation and api methods for source ingestion"
```

---

### 任务 5：构建 Add-Source 弹窗 MVP 与刷新流程

**文件：**
- 新建：`client/src/components/notebook-workbench/AddSourceDialog.vue`
- 修改：`client/src/views/NotebookWorkbenchView.vue`
- 修改：`client/src/components/notebook-workbench/SourcesPanel.vue`

- [ ] **步骤 1：先通过导入缺失弹窗组件制造失败的编译检查**

```ts
// client/src/views/NotebookWorkbenchView.vue (实现期间临时使用)
import AddSourceDialog from "@/components/notebook-workbench/AddSourceDialog.vue";
```

- [ ] **步骤 2：运行构建确认先失败**

运行：`npm run build --workspace client`
预期：FAIL，报错缺少文件 `AddSourceDialog.vue`

- [ ] **步骤 3：实现弹窗与页面接线**

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
// client/src/views/NotebookWorkbenchView.vue (轮廓)
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
<!-- client/src/components/notebook-workbench/SourcesPanel.vue (轮廓) -->
<button type="button" @click="onAddSource">添加</button>
```

- [ ] **步骤 4：补上处理状态轮询并做定向验证**

运行：

- `npm run build --workspace client`
- `npm run build --workspace server`

预期：

- 添加来源弹窗从来源面板打开
- 成功添加一次后刷新来源列表
- 轮询可以调用 `/api/notebooks/:id/sources/status` 直到 `allReady === true`

- [ ] **步骤 5：提交**

```bash
git add client/src/components/notebook-workbench/AddSourceDialog.vue client/src/views/NotebookWorkbenchView.vue client/src/components/notebook-workbench/SourcesPanel.vue
git commit -m "feat: add notebook source dialog mvp"
```

---

## 自检

- 规格覆盖：该计划覆盖了参考图中的添加来源主流程，并清晰拆分了后端来源写入与前端弹窗交互
- 占位项检查：favicon、来源预览和额外视觉打磨仍明确保持在范围外
- 类型一致性：`sourceType`、`mode`、`sourceIds` 和 processing-status 字段在前后端保持一致