# 来源侧边栏与切换实施计划

> **面向智能体工作者：** 必需子技能：使用 `superpowers:subagent-driven-development` 逐任务实施此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**当前状态：** 未开始

**目标：** 升级左侧来源栏，展示来源图标、支持点击打开网页来源，并提供按来源启用/禁用切换，且切换会影响研究请求。

**架构：** 保持 NotebookLM 作为来源记录的真相源，仅在本地数据库增加每笔记的来源启用状态扩展层。后端在读取接口中合并 NotebookLM 来源与本地切换状态，并暴露切换接口。前端在 `SourcesPanel` 中渲染图标、点击和切换控制，并在状态变更后刷新来源。

**技术栈：** Vue 3 + TypeScript + TailwindCSS、Hono + TypeScript、Drizzle ORM + SQLite、`notebooklm-kit`

---

## Scope Check

This request is independent from “Add Source workflow UI + ingestion”. It is split into a dedicated plan so this one can ship and be tested on its own.

---

## File Structure

### Backend

- Modify: `server/src/db/schema.ts`
  - Add source-toggle extension table (`notebook_source_states`).
- Modify: `server/src/db/migrate.ts`
  - Create migration for the source-toggle table.
- Create: `server/src/source-state/service.ts`
  - Encapsulate toggle persistence and merge helpers.
- Modify: `server/src/notebooklm/client.ts`
  - Extend normalized source type with `sourceTypeRaw` and URL passthrough.
- Modify: `server/src/routes/notebooks/index.ts`
  - Merge source list with toggle state; add toggle endpoint.
- Create: `server/src/source-state/service.test.ts`
  - Unit tests for state merge defaults and toggle updates.

### Frontend

- Modify: `client/src/api/notebooks.ts`
  - Extend `Source` type with `enabled` and `url`; add toggle API method.
- Create: `client/src/utils/source-icons.ts`
  - Map source type to icon token/class.
- Modify: `client/src/components/notebook-workbench/SourcesPanel.vue`
  - Render icon, clickable web link, and enable/disable switch.
- Modify: `client/src/views/NotebookWorkbenchView.vue`
  - Handle toggle action, optimistic lock, and source refresh.
- Create: `client/src/utils/source-icons.test.ts`
  - Unit tests for icon mapping fallback behavior.

---

### Task 1: Add Source Toggle Persistence (Extension Layer)

**Files:**
- Modify: `server/src/db/schema.ts`
- Modify: `server/src/db/migrate.ts`
- Create: `server/src/source-state/service.ts`
- Test: `server/src/source-state/service.test.ts`

- [ ] **Step 1: Write the failing unit test for default-enabled merge behavior**

```ts
// server/src/source-state/service.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mergeSourceStates } from "./service.js";

test("mergeSourceStates defaults to enabled=true when no persisted state", () => {
  const merged = mergeSourceStates(
    [
      { id: "s1", title: "A", type: "web", status: "ready", url: "https://a.com" },
      { id: "s2", title: "B", type: "pdf", status: "ready" },
    ],
    new Map(),
  );

  assert.equal(merged[0]?.enabled, true);
  assert.equal(merged[1]?.enabled, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/source-state/service.test.ts`
Expected: FAIL with module-not-found for `./service.js`

- [ ] **Step 3: Add DB table and merge service (minimal implementation)**

```ts
// server/src/db/schema.ts (add block)
export const notebookSourceStates = sqliteTable("notebook_source_states", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  notebookId: text("notebook_id").notNull(),
  sourceId: text("source_id").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
}, (table) => ({
  notebookSourceUnique: uniqueIndex("notebook_source_unique").on(table.notebookId, table.sourceId),
}));
```

```ts
// server/src/source-state/service.ts
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { notebookSourceStates } from "../db/schema.js";
import type { NotebookSource } from "../notebooklm/client.js";

export interface SourceWithState extends NotebookSource {
  enabled: boolean;
}

export function mergeSourceStates(
  sources: NotebookSource[],
  enabledMap: Map<string, boolean>,
): SourceWithState[] {
  return sources.map((s) => ({
    ...s,
    enabled: enabledMap.get(s.id) ?? true,
  }));
}

export async function listSourceStateMap(notebookId: string): Promise<Map<string, boolean>> {
  const rows = await db
    .select({ sourceId: notebookSourceStates.sourceId, enabled: notebookSourceStates.enabled })
    .from(notebookSourceStates)
    .where(eq(notebookSourceStates.notebookId, notebookId));

  return new Map(rows.map((r) => [r.sourceId, r.enabled]));
}

export async function setSourceEnabled(
  notebookId: string,
  sourceId: string,
  enabled: boolean,
): Promise<void> {
  const existing = await db
    .select({ id: notebookSourceStates.id })
    .from(notebookSourceStates)
    .where(and(eq(notebookSourceStates.notebookId, notebookId), eq(notebookSourceStates.sourceId, sourceId)))
    .limit(1);

  if (existing[0]?.id) {
    await db
      .update(notebookSourceStates)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(notebookSourceStates.id, existing[0].id));
    return;
  }

  await db.insert(notebookSourceStates).values({ notebookId, sourceId, enabled });
}
```

```ts
// server/src/db/migrate.ts (add SQL)
await client.execute(`
  CREATE TABLE IF NOT EXISTS notebook_source_states (
    id TEXT PRIMARY KEY NOT NULL,
    notebook_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );
`);

await client.execute(`
  CREATE UNIQUE INDEX IF NOT EXISTS notebook_source_unique
  ON notebook_source_states (notebook_id, source_id);
`);
```

- [ ] **Step 4: Re-run test to verify it passes**

Run: `node --import tsx --test src/source-state/service.test.ts`
Expected: PASS with 1 test passed

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.ts server/src/db/migrate.ts server/src/source-state/service.ts server/src/source-state/service.test.ts
git commit -m "feat: persist per-source enabled state for notebook workbench"
```

---

### Task 2: Expose Source Toggle API and Merged Source Read Model

**Files:**
- Modify: `server/src/routes/notebooks/index.ts`
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/notebooklm/index.ts`
- Test: `server/src/source-state/service.test.ts`

- [ ] **Step 1: Write failing test for toggle state overwrite behavior**

```ts
// server/src/source-state/service.test.ts (append)
import test from "node:test";
import assert from "node:assert/strict";
import { mergeSourceStates } from "./service.js";

test("mergeSourceStates applies persisted enabled=false", () => {
  const merged = mergeSourceStates(
    [{ id: "s1", title: "A", type: "web", status: "ready" }],
    new Map([["s1", false]]),
  );

  assert.equal(merged[0]?.enabled, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/source-state/service.test.ts`
Expected: FAIL if type mismatch (`enabled` missing in merged result or compile error)

- [ ] **Step 3: Add routes and wire merge + toggle**

```ts
// server/src/routes/notebooks/index.ts (replace /:id/sources handler + add toggle endpoint)
import { listSourceStateMap, mergeSourceStates, setSourceEnabled } from "../../source-state/service.js";

notebooks.get("/:id/sources", async (c) => {
  return await withNotebookId(c, async (id) => {
    const [sources, stateMap] = await Promise.all([
      getNotebookSources(id),
      listSourceStateMap(id),
    ]);

    return c.json(successResponse(mergeSourceStates(sources, stateMap)));
  });
});

notebooks.post("/:id/sources/:sourceId/toggle", async (c) => {
  return await withNotebookId(c, async (id) => {
    const sourceId = c.req.param("sourceId")?.trim();
    if (!sourceId) {
      return c.json({ success: false, message: "Invalid source id", errorCode: "INVALID_SOURCE_ID" }, 400);
    }

    const body = await c.req.json<{ enabled?: boolean }>().catch(() => ({}));
    if (typeof body.enabled !== "boolean") {
      return c.json({ success: false, message: "enabled must be boolean", errorCode: "INVALID_ENABLED" }, 400);
    }

    await setSourceEnabled(id, sourceId, body.enabled);
    return c.json(successResponse({ sourceId, enabled: body.enabled }));
  });
});
```

```ts
// server/src/notebooklm/client.ts (ensure source carries url and raw type marker)
export interface NotebookSource {
  id: string;
  title: string;
  type: "pdf" | "web" | "text" | "youtube" | "drive" | "image" | "unknown";
  sourceTypeRaw?: string;
  status: "ready" | "processing" | "failed" | "unknown";
  url?: string;
}

function mapSource(s: Source): NotebookSource {
  return {
    id: s.sourceId,
    title: s.title ?? s.sourceId,
    type: normalizeSourceType(s.type),
    sourceTypeRaw: s.type !== undefined ? String(s.type) : undefined,
    status: normalizeSourceStatus(s.status),
    ...(s.url ? { url: s.url } : {}),
  };
}
```

- [ ] **Step 4: Re-run test to verify it passes**

Run: `node --import tsx --test src/source-state/service.test.ts`
Expected: PASS with 2 tests passed

- [ ] **Step 5: Run backend build verification**

Run: `npm run build --workspace server`
Expected: PASS, with no route type errors

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/notebooks/index.ts server/src/notebooklm/client.ts server/src/notebooklm/index.ts server/src/source-state/service.test.ts
git commit -m "feat: add source toggle endpoint and merged source read model"
```

---

### Task 3: Add Source Icon Mapping + API Client Toggle Method

**Files:**
- Modify: `client/src/api/notebooks.ts`
- Create: `client/src/utils/source-icons.ts`
- Test: `client/src/utils/source-icons.test.ts`

- [ ] **Step 1: Write failing tests for icon mapping fallback logic**

```ts
// client/src/utils/source-icons.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { iconForSourceType } from "./source-icons.js";

test("maps web/pdf/youtube to explicit icon tokens", () => {
  assert.equal(iconForSourceType("web"), "globe");
  assert.equal(iconForSourceType("pdf"), "file-text");
  assert.equal(iconForSourceType("youtube"), "youtube");
});

test("falls back to generic file icon for unknown types", () => {
  assert.equal(iconForSourceType("unknown"), "file");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/utils/source-icons.test.ts`
Expected: FAIL with module-not-found for `./source-icons.js`

- [ ] **Step 3: Implement icon utility + Source API shape updates**

```ts
// client/src/utils/source-icons.ts
export type SourceIconToken =
  | "globe"
  | "file-text"
  | "text"
  | "youtube"
  | "drive"
  | "image"
  | "file";

export function iconForSourceType(type: string): SourceIconToken {
  switch (type) {
    case "web":
      return "globe";
    case "pdf":
      return "file-text";
    case "text":
      return "text";
    case "youtube":
      return "youtube";
    case "drive":
      return "drive";
    case "image":
      return "image";
    default:
      return "file";
  }
}
```

```ts
// client/src/api/notebooks.ts (Source + toggle method)
export interface Source {
  id: string;
  title: string;
  type: string;
  status: string;
  enabled: boolean;
  url?: string;
}

// Append this method at the end of the existing notebooksApi object:
toggleSource(id: string, sourceId: string, enabled: boolean) {
  return request<{ sourceId: string; enabled: boolean }>(
    `/api/notebooks/${id}/sources/${sourceId}/toggle`,
    {
      method: "POST",
      body: JSON.stringify({ enabled }),
    },
  );
},
```

- [ ] **Step 4: Re-run test to verify it passes**

Run: `node --import tsx --test src/utils/source-icons.test.ts`
Expected: PASS with 2 tests passed

- [ ] **Step 5: Run frontend build verification**

Run: `npm run build --workspace client`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/api/notebooks.ts client/src/utils/source-icons.ts client/src/utils/source-icons.test.ts
git commit -m "feat: add source icon mapping and source toggle API client"
```

---

### Task 4: Upgrade SourcesPanel UI (icon + web jump + toggle switch)

**Files:**
- Modify: `client/src/components/notebook-workbench/SourcesPanel.vue`
- Modify: `client/src/views/NotebookWorkbenchView.vue`
- Test: `client/src/utils/source-icons.test.ts`

- [ ] **Step 1: Write failing test for source icon utility edge case used by panel**

```ts
// client/src/utils/source-icons.test.ts (append)
import test from "node:test";
import assert from "node:assert/strict";
import { iconForSourceType } from "./source-icons.js";

test("treats empty type as generic file", () => {
  assert.equal(iconForSourceType(""), "file");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/utils/source-icons.test.ts`
Expected: FAIL if empty-type mapping is not handled

- [ ] **Step 3: Implement SourcesPanel rendering + toggle interaction + web click**

```vue
<!-- client/src/components/notebook-workbench/SourcesPanel.vue -->
<script setup lang="ts">
import type { Source } from "@/api/notebooks";
import { iconForSourceType } from "@/utils/source-icons";

interface Props {
  sources: Source[];
  togglingSourceIds: string[];
  onAddSource: () => void;
  onToggleSource: (source: Source, enabled: boolean) => void;
}

defineProps<Props>();

function canOpen(source: Source): boolean {
  return source.type === "web" && Boolean(source.url);
}
</script>

<template>
  <section class="h-full min-h-0 bg-white border border-gray-200 rounded-lg p-4 flex flex-col overflow-hidden">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold text-gray-900">来源</h2>
      <button type="button" class="px-2.5 py-1 text-xs rounded-md bg-gray-900 text-white hover:bg-gray-800" @click="onAddSource">添加</button>
    </div>

    <ul v-if="sources.length > 0" class="space-y-2 overflow-y-auto min-h-0 flex-1 pr-1">
      <li v-for="source in sources" :key="source.id" class="border border-gray-200 rounded-md p-3">
        <div class="flex items-start gap-2">
          <span class="text-sm text-gray-500 mt-0.5">{{ iconForSourceType(source.type) }}</span>

          <div class="flex-1 min-w-0">
            <a
              v-if="canOpen(source)"
              :href="source.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-sm font-medium text-blue-700 hover:underline truncate block"
            >
              {{ source.title }}
            </a>
            <p v-else class="text-sm font-medium text-gray-900 truncate">{{ source.title }}</p>
            <p class="text-xs text-gray-500 mt-1">{{ source.type }} · {{ source.status }}</p>
          </div>

          <button
            type="button"
            class="text-xs px-2 py-1 rounded border"
            :class="source.enabled ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-300 text-gray-600 bg-white'"
            :disabled="togglingSourceIds.includes(source.id)"
            @click="onToggleSource(source, !source.enabled)"
          >
            {{ source.enabled ? "使用中" : "已排除" }}
          </button>
        </div>
      </li>
    </ul>

    <div v-else class="text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded-md p-4">
      暂无来源，请添加后开始对话。
    </div>
  </section>
</template>
```

```ts
// client/src/views/NotebookWorkbenchView.vue (add state + handler)
const togglingSourceIds = ref<string[]>([]);

async function onToggleSource(source: Source, enabled: boolean) {
  if (!notebookId.value) return;
  togglingSourceIds.value = [...togglingSourceIds.value, source.id];

  try {
    await notebooksApi.toggleSource(notebookId.value, source.id, enabled);
    sources.value = await notebooksApi.getSources(notebookId.value);
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "更新来源状态失败");
  } finally {
    togglingSourceIds.value = togglingSourceIds.value.filter((id) => id !== source.id);
  }
}
```

```vue
<!-- client/src/views/NotebookWorkbenchView.vue (panel usage) -->
<SourcesPanel
  :sources="sources"
  :toggling-source-ids="togglingSourceIds"
  :on-add-source="onAddSource"
  :on-toggle-source="onToggleSource"
/>
```

- [ ] **Step 4: Re-run test to verify it passes**

Run: `node --import tsx --test src/utils/source-icons.test.ts`
Expected: PASS with 3 tests passed

- [ ] **Step 5: Run frontend build verification**

Run: `npm run build --workspace client`
Expected: PASS, no Vue prop/type errors

- [ ] **Step 6: Commit**

```bash
git add client/src/components/notebook-workbench/SourcesPanel.vue client/src/views/NotebookWorkbenchView.vue client/src/utils/source-icons.test.ts
git commit -m "feat: render source icon link and enabled toggle in sources panel"
```

---

### Task 5: Make Toggle Affect Research Calls (NotebookLM-like behavior)

**Files:**
- Modify: `server/src/source-state/service.ts`
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/routes/notebooks/index.ts`
- Modify: `server/src/research-runtime/orchestrator.ts`
- Test: `server/src/source-state/service.test.ts`

- [ ] **Step 1: Write failing test for helper that returns only enabled source IDs**

```ts
// server/src/source-state/service.test.ts (append)
import test from "node:test";
import assert from "node:assert/strict";
import { listEnabledSourceIds } from "./service.js";

test("listEnabledSourceIds returns only enabled source ids", () => {
  const ids = listEnabledSourceIds([
    { id: "a", title: "A", type: "web", status: "ready", enabled: true },
    { id: "b", title: "B", type: "pdf", status: "ready", enabled: false },
  ]);

  assert.deepEqual(ids, ["a"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/source-state/service.test.ts`
Expected: FAIL with missing `listEnabledSourceIds`

- [ ] **Step 3: Implement enabled-source selection and pass sourceIds into research ask calls**

```ts
// server/src/source-state/service.ts (append)
export function listEnabledSourceIds(sources: Array<{ id: string; enabled: boolean }>): string[] {
  return sources.filter((s) => s.enabled).map((s) => s.id);
}
```

```ts
// server/src/notebooklm/client.ts (extend ask function)
export async function askNotebookForResearch(
  notebookId: string,
  prompt: string,
  sourceIds?: string[],
): Promise<ResearchAskResult> {
  try {
    const client = await getClient();
    const result = await client.generation.chat(
      notebookId,
      prompt,
      sourceIds?.length ? { sourceIds } : undefined,
    );
    if (!result?.text) return { success: false, error: "Empty response from NotebookLM" };
    return { success: true, answer: result.text, citations: result.citations || [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
```

```ts
// server/src/routes/notebooks/index.ts (on /research/start)
import { listEnabledSourceIds } from "../../source-state/service.js";

const sources = await getNotebookSources(id);
const stateMap = await listSourceStateMap(id);
const merged = mergeSourceStates(sources, stateMap);
const enabledSourceIds = listEnabledSourceIds(merged);

void runAutoResearch(
  id,
  (notebookId, prompt) => askNotebookForResearch(notebookId, prompt, enabledSourceIds),
);
```

- [ ] **Step 4: Re-run test to verify it passes**

Run: `node --import tsx --test src/source-state/service.test.ts`
Expected: PASS with all tests passed

- [ ] **Step 5: Run backend build verification**

Run: `npm run build --workspace server`
Expected: PASS, no signature mismatch in orchestrator callback

- [ ] **Step 6: Commit**

```bash
git add server/src/source-state/service.ts server/src/source-state/service.test.ts server/src/notebooklm/client.ts server/src/routes/notebooks/index.ts server/src/research-runtime/orchestrator.ts
git commit -m "feat: honor enabled source toggles in auto research calls"
```

---

## Final Verification

- [ ] **Step 1: Run backend tests + build**

Run: `node --import tsx --test src/source-state/service.test.ts && npm run build --workspace server`
Expected: PASS

- [ ] **Step 2: Run frontend tests + build**

Run: `node --import tsx --test src/utils/source-icons.test.ts && npm run build --workspace client`
Expected: PASS

- [ ] **Step 3: Manual smoke test**

Run app and verify:

```text
1) Open /notebook/<id>
2) Left panel shows icon token and source title
3) Web source title click opens new tab
4) Toggle "使用中/已排除" updates immediately and survives page reload
5) Start auto research and confirm only enabled sources are used (citation/source scope check)
```

---

## Self-Review

### 1) Spec coverage check

- Source icon in left panel: covered by Task 3/4.
- Web-source click-through behavior: covered by Task 4.
- Toggle source usage aligned to NotebookLM behavior: covered by Task 2/5.
- Source toggle affecting research execution: covered by Task 5.

### 2) Placeholder scan

- No `TODO` / `TBD` / “implement later” placeholders remain.
- Each code-changing step includes concrete code blocks.

### 3) Type consistency check

- `Source.enabled` introduced in backend merge output and frontend API shape.
- Toggle route uses `enabled:boolean` consistently in request/response.
- `askNotebookForResearch(..., sourceIds?)` signature used consistently where called.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-03-notebook-sources-sidebar-and-toggle.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
