# Notebook List Page MVP Implementation Plan

> **Status:** ✅ Completed (2026-04-07)
>
> **Note (2026-04-07):** This plan originally included local source enable/disable control via `notebook_source_states` table. During implementation, this feature was deferred and later removed in a hotfix due to database initialization issues in fresh worktree environments. The `/sources` endpoint now returns NotebookLM sources directly without local enabled-state persistence. The `source-state` module is now unused and can be cleaned up post-merge.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a page that reads the NotebookLM notebook list, displays it in the client, and navigates to `/notebook/:uuid` when the user clicks a notebook.

**Architecture:** Reuse the existing `listNotebooks()` NotebookLM gateway on the server and expose a new `GET /api/notebooks` list endpoint that returns a normalized notebook summary model. On the frontend, add a dedicated notebook list view and route, then render clickable notebook cards/rows that navigate to the existing notebook workbench route.

**Tech Stack:** Vue 3 + vue-router + TypeScript, Hono + TypeScript, notebooklm-kit, existing shared request helpers

---

## Scope Check

This plan is intentionally separate from the notebook workbench, add-source workflow, and chat history work.

This MVP includes:

- Server endpoint for notebook list
- Client API for notebook list
- New notebook list page
- Click to navigate to `/notebook/:id`

Out of scope for this MVP:

- Search/filter/sort controls
- Pagination or infinite scroll
- Notebook creation/deletion
- Rich metadata beyond title and updated time
- Merging this page into the current task homepage UX

---

## File Structure

### Backend

- Modify: `server/src/notebooklm/client.ts`
  - Reuse or slightly normalize `listNotebooks()` output.
- Modify: `server/src/notebooklm/index.ts`
  - Export notebook-list types if needed.
- Modify: `server/src/routes/notebooks/index.ts`
  - Add `GET /api/notebooks` route.
- Modify: `server/src/index.ts`
  - Update root endpoint docs string if needed.

### Frontend

- Modify: `client/src/api/notebooks.ts`
  - Add notebook-list request method and list item type.
- Create: `client/src/views/NotebookListView.vue`
  - Render notebook list state and navigation.
- Modify: `client/src/router/index.ts`
  - Add route for the notebook list page.
- Optionally Modify: `client/src/views/HomeView.vue`
  - Add entry link/button to the notebook list page, if desired for discoverability.

---

### Task 1: Expose Notebook List Read API

**Files:**
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/notebooklm/index.ts`
- Modify: `server/src/routes/notebooks/index.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Verify and normalize the notebook list gateway output**

Pseudocode:

```text
listNotebooks():
  call sdk.notebooks.list()
  map each item to:
    id
    title
    updatedAt
    description (empty string for now if unavailable)
```

Requirements:

- Do not leak raw SDK response objects directly to the route layer
- Reuse the same `Notebook` shape already used by `GET /api/notebooks/:id` where reasonable

- [ ] **Step 2: Add `GET /api/notebooks` route**

Pseudocode:

```text
GET /api/notebooks:
  auth guard already applies
  call listNotebooks()
  return successResponse(notebooks)
```

Requirements:

- Keep response shape consistent with existing route helpers
- Do not mix notebook detail/source/message logic into this task

- [ ] **Step 3: Update root endpoint docs string if needed**

Pseudocode:

```text
root endpoints.notebooks:
  include /api/notebooks list route
```

- [ ] **Step 4: Run targeted verification**

Run:

- `npm run build --workspace server`

Expected:

- server build passes
- `/api/notebooks` compiles and is reachable through the notebooks route module

- [ ] **Step 5: Commit**

```bash
git add server/src/notebooklm/client.ts server/src/notebooklm/index.ts server/src/routes/notebooks/index.ts server/src/index.ts
git commit -m "feat: add notebook list api endpoint"
```

---

### Task 2: Add Client Notebook List API Method

**Files:**
- Modify: `client/src/api/notebooks.ts`

- [ ] **Step 1: Add the notebook list item type**

Pseudocode:

```text
type NotebookListItem = {
  id: string
  title: string
  description: string
  updatedAt: string
}
```

Requirements:

- Prefer reusing the existing `Notebook` interface if it already matches the list use case
- Keep the request helper behavior unchanged

- [ ] **Step 2: Add `getNotebooks()` API method**

Pseudocode:

```text
notebooksApi.getNotebooks():
  GET /api/notebooks
  return Notebook[]
```

- [ ] **Step 3: Run targeted verification**

Run:

- `npm run build --workspace client`

Expected:

- client build passes
- new list API method is available for page wiring

- [ ] **Step 4: Commit**

```bash
git add client/src/api/notebooks.ts
git commit -m "feat: add notebook list client api"
```

---

### Task 3: Add Dedicated Notebook List View

**Files:**
- Create: `client/src/views/NotebookListView.vue`

- [ ] **Step 1: Define the page states**

Pseudocode:

```text
state:
  notebooks = []
  loading = true
  error = ""

onMounted:
  fetch notebooks

render:
  if loading -> loading block
  else if error -> error block
  else if empty -> empty block
  else -> notebook list
```

Requirements:

- Keep page structure minimal and consistent with existing app styles
- No search/filter controls in this MVP

- [ ] **Step 2: Add click-to-navigate behavior**

Pseudocode:

```text
onNotebookClick(notebookId):
  router.push(`/notebook/${notebookId}`)
```

Requirements:

- Entire card/row should be clickable, not just a tiny text link
- Use the existing workbench route without introducing a second notebook detail path

- [ ] **Step 3: Render minimal notebook metadata**

Pseudocode:

```text
for each notebook:
  show title
  show updatedAt
  optionally show description if non-empty
```

- [ ] **Step 4: Run targeted verification**

Run:

- `npm run build --workspace client`

Expected:

- client build passes
- list page can compile independently of notebook workbench changes

- [ ] **Step 5: Commit**

```bash
git add client/src/views/NotebookListView.vue
git commit -m "feat: add notebook list page"
```

---

### Task 4: Add Router Entry For Notebook List Page

**Files:**
- Modify: `client/src/router/index.ts`
- Optionally Modify: `client/src/views/HomeView.vue`

- [ ] **Step 1: Register the new route**

Pseudocode:

```text
route:
  path: /notebooks
  name: notebook-list
  component: NotebookListView
```

Requirements:

- Do not replace the existing `/notebook/:id` route
- Keep route names explicit and stable

- [ ] **Step 2: Decide homepage entry behavior**

Two acceptable MVP options:

- Option A: keep `/` as the current research-task home page, and add a visible link/button to `/notebooks`
- Option B: make `/` redirect to `/notebooks`, and move the current task page elsewhere

Recommended for minimal risk: Option A

- [ ] **Step 3: If using Option A, add a discoverable entry from `HomeView.vue`**

Pseudocode:

```text
render link/button:
  label = "查看 Notebook 列表"
  target = /notebooks
```

- [ ] **Step 4: Run targeted verification**

Run:

- `npm run build --workspace client`

Expected:

- new route compiles
- user can navigate from notebook list to `/notebook/:id`

- [ ] **Step 5: Commit**

```bash
git add client/src/router/index.ts client/src/views/HomeView.vue
git commit -m "feat: add notebook list navigation route"
```

---

## Self-Review

- Spec coverage: covers backend list route, client API, new page, and navigation into the existing notebook workbench.
- Placeholder scan: only pseudocode is used where implementation detail is unnecessary by request.
- Type consistency: uses the same notebook identifier model as the existing `/notebook/:id` route.

---

## Post-Merge Cleanup (Deferred)

After merging this plan, the following cleanup is recommended:

- **Delete or deprecate:** `server/src/source-state/` — No longer used after removing local source enable/disable control.
- **Database:** The `db/index.ts` now auto-initializes required tables on import, so running `npm run migrate` is optional for fresh databases. The `source-state` table creation can also be removed from `db/migrate.ts` if desired.

---

## Plan Retention Decision

**Q: Should superpowers plan documents be deleted after completion?**

**A: Generally no — keep them.** Here's why:

| Reason | Explanation |
|--------|-------------|
| **Historical context** | Future developers can understand *why* decisions were made, not just *what* was implemented |
| **Traceability** | Links in plans often reference spec discussions, research, or alternative approaches that aren't captured in code commits |
| **Audit trail** | If a later change causes issues, the original plan explains the intended behavior |
| **Onboarding** | New team members can read plans to understand the system's evolution |

**When to delete:**
- Plan contains sensitive/secret information
- Plan is completely superseded by a comprehensive design document
- Repository is archived and read-only

**When to update (recommended):**
- Mark status as ✅ Completed (with date)
- Add implementation notes about decisions made during execution
- Note any scope changes or deferred items (as done above)

This plan is kept and updated because it documents:
1. Original MVP scope vs. final implementation (source toggle was removed)
2. Database auto-init fix was added post-implementation
3. Future cleanup opportunities (source-state module)
