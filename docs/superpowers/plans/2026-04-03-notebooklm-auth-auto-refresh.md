# NotebookLM Auth Auto Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-account NotebookLM authentication subsystem that can persist a dedicated browser profile, refresh auth automatically in the background, retry once on auth failure, and return explicit auth states instead of leaking raw 500s.

**Architecture:** Keep the current NotebookLM SDK integration, but split auth into a persistent profile layer and a disposable runtime client layer. Add an auth manager in the server that owns profile paths, auth metadata, refresh coordination, and runtime client invalidation. Route handlers should consume auth through this manager instead of directly trusting `storage-state.json` or a long-lived cached SDK instance.

**Tech Stack:** Node.js + TypeScript, Hono, notebooklm-kit, local filesystem under `~/.notebooklm/`, existing Vue client auth status consumer

---

## Scope Check

This plan is a single-account MVP only.

Included:

- Dedicated persisted auth profile for account `default`
- Background health checking and refresh
- Request-side forced refresh and one retry
- Explicit auth status model and `/api/auth/status` upgrade
- Converting NotebookLM auth failures from raw 500s into clear 401 responses

Excluded:

- Multi-account concurrent execution
- Cloud-hosted browser workers
- Guaranteed bypass of Google 2FA/risk challenges
- Replacing notebooklm-kit internals

---

## File Structure

### Backend

- Create: `server/src/notebooklm/auth-profile.ts`
  - Filesystem path helpers and persisted profile metadata read/write.
- Create: `server/src/notebooklm/auth-profile.test.ts`
  - Unit tests for profile path and metadata behavior.
- Create: `server/src/notebooklm/auth-manager.ts`
  - Owns auth state transitions, refresh flow, single-flight coordination, and runtime client lifecycle.
- Create: `server/src/notebooklm/auth-manager.test.ts`
  - Unit tests for refresh gating, cooldown, and retry behavior.
- Modify: `server/src/notebooklm/client.ts`
  - Stop owning long-lived auth state directly; consume the auth manager.
- Modify: `server/src/notebooklm/index.ts`
  - Export new auth manager surface and updated auth status types.
- Modify: `server/src/routes/auth/index.ts`
  - Return richer auth status.
- Modify: `server/src/routes/notebooks/index.ts`
  - Convert NotebookLM auth failures into 401 responses and reuse shared auth-aware request flow.
- Modify: `server/src/index.ts`
  - Start background auth health checking at process startup.

### Frontend

- Modify: `client/src/api/client.ts`
  - Update auth status type.
- Optionally Modify: `client/src/views/HomeView.vue`
  - Show explicit auth state if already consumed there.
- Modify: any current auth-status consumer
  - Interpret `ready`, `refreshing`, `reauth_required`, and `error` explicitly.

---

### Task 1: Add Persistent Auth Profile Storage Model

**Files:**
- Create: `server/src/notebooklm/auth-profile.ts`
- Test: `server/src/notebooklm/auth-profile.test.ts`

- [ ] **Step 1: Define the persisted profile layout and metadata shape**

Pseudocode:

```text
base = ~/.notebooklm/profiles/default/

profile files:
  browser-user-data/
  storage-state.json
  auth-meta.json

auth-meta:
  accountId
  status
  lastCheckedAt
  lastRefreshedAt
  error
```

Requirements:

- Keep the account id fixed to `default` in MVP
- Do not write anything into the repository workspace

- [ ] **Step 2: Add profile helper responsibilities**

Pseudocode:

```text
getProfilePaths(accountId)
ensureProfileDirectories(accountId)
readAuthMeta(accountId)
writeAuthMeta(accountId, meta)
readStorageState(accountId)
writeStorageState(accountId, storageState)
```

Requirements:

- Missing files should map to `missing`, not generic exceptions
- Path helpers must be deterministic and testable

- [ ] **Step 3: Add unit tests for path and metadata behavior**

Test cases:

- resolves `default` profile paths correctly
- returns `missing` when no metadata exists
- round-trips auth metadata read/write
- rejects malformed metadata with explicit error state

- [ ] **Step 4: Run targeted verification**

Run:

- `node --import tsx --test src/notebooklm/auth-profile.test.ts`
- `npm run build --workspace server`

Expected:

- tests pass
- server build passes

- [ ] **Step 5: Commit**

```bash
git add server/src/notebooklm/auth-profile.ts server/src/notebooklm/auth-profile.test.ts
git commit -m "feat: add persisted notebook auth profile model"
```

---

### Task 2: Add Auth Manager State Machine And Refresh Coordination

**Files:**
- Create: `server/src/notebooklm/auth-manager.ts`
- Test: `server/src/notebooklm/auth-manager.test.ts`
- Modify: `server/src/notebooklm/index.ts`

- [ ] **Step 1: Define the runtime auth status model**

Pseudocode:

```text
AuthState =
  missing
  ready
  refreshing
  expired
  reauth_required
  error
```

Requirements:

- `ready` means recently validated, not merely “file exists”
- state model must match the approved spec exactly

- [ ] **Step 2: Define auth manager responsibilities**

Pseudocode:

```text
getAuthProfileStatus(accountId)
initAuthProfile(accountId)
refreshAuthProfile(accountId, reason)
invalidateAuthClient(accountId)
getAuthenticatedSdkClient(accountId)
startAuthHealthMonitor(accountId)
```

Requirements:

- Keep the public API keyed by `accountId`, but call it with `default` only in MVP
- Auth manager, not `client.ts`, should own cached runtime clients

- [ ] **Step 3: Add single-flight refresh and cooldown policy**

Pseudocode:

```text
if refresh already running:
  await existing refresh promise

if recent failures exceed threshold within cooldown window:
  return reauth_required

else:
  mark refreshing
  attempt silent refresh
  update auth-meta
  resolve waiting callers
```

Requirements:

- Multiple concurrent refresh triggers must collapse into one refresh operation
- Repeated failures must not spin indefinitely

- [ ] **Step 4: Add unit tests for refresh coordination**

Test cases:

- concurrent refresh calls share a single in-flight promise
- successful refresh moves state to `ready`
- repeated failures eventually move state to `reauth_required`
- invalidation clears runtime client cache

- [ ] **Step 5: Run targeted verification**

Run:

- `node --import tsx --test src/notebooklm/auth-manager.test.ts`
- `npm run build --workspace server`

Expected:

- tests pass
- server build passes

- [ ] **Step 6: Commit**

```bash
git add server/src/notebooklm/auth-manager.ts server/src/notebooklm/auth-manager.test.ts server/src/notebooklm/index.ts
git commit -m "feat: add notebook auth manager with refresh coordination"
```

---

### Task 3: Move NotebookLM Client Construction Behind The Auth Manager

**Files:**
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/notebooklm/index.ts`

- [ ] **Step 1: Separate raw NotebookLM helpers from auth ownership**

Pseudocode:

```text
keep helpers:
  normalize source/detail/message shapes
  fetch auth token from cookie header

remove responsibilities:
  long-lived sdkInstance ownership
  direct storage-state trust as final auth truth
```

Requirements:

- `client.ts` should become a lower-level gateway module again
- Auth manager should decide when to build/dispose clients

- [ ] **Step 2: Define runtime client acquisition flow**

Pseudocode:

```text
getAuthenticatedSdkClient(default):
  if runtime client cached and still valid -> return it
  else:
    load latest storage-state from profile
    fetch auth token
    build NotebookLMClient
    connect client
    cache runtime client
    return client
```

- [ ] **Step 3: Run targeted verification**

Run:

- `npm run build --workspace server`

Expected:

- server build passes
- notebook gateway functions compile against the new auth manager surface

- [ ] **Step 4: Commit**

```bash
git add server/src/notebooklm/client.ts server/src/notebooklm/index.ts
git commit -m "refactor: route notebook sdk client creation through auth manager"
```

---

### Task 4: Add Background Health Checking And Silent Refresh Flow

**Files:**
- Modify: `server/src/notebooklm/auth-manager.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Define the background health check lifecycle**

Pseudocode:

```text
on server startup:
  start monitor for account default

monitor loop:
  every N interval
    check auth health
    if degraded and recoverable:
      refresh silently
    if unrecoverable:
      mark reauth_required
```

Requirements:

- Keep polling lightweight
- Background checker must not create overlapping refresh operations

- [ ] **Step 2: Define silent refresh behavior**

Pseudocode:

```text
silent refresh:
  launch browser context with browser-user-data
  try access notebooklm/google
  export latest storage-state
  refresh auth-meta
  invalidate runtime client
```

Requirements:

- Silent refresh must reuse persisted browser user data
- On explicit challenge flows, return `reauth_required` instead of looping

- [ ] **Step 3: Run targeted verification**

Run:

- `npm run build --workspace server`

Manual verification:

- start server with an already initialized profile
- confirm monitor starts without crashing server boot

- [ ] **Step 4: Commit**

```bash
git add server/src/notebooklm/auth-manager.ts server/src/index.ts
git commit -m "feat: add background notebook auth health monitor"
```

---

### Task 5: Add Request-Side Forced Refresh And One Retry

**Files:**
- Modify: `server/src/notebooklm/client.ts`
- Modify: `server/src/notebooklm/auth-manager.ts`
- Modify: `server/src/routes/notebooks/index.ts`

- [ ] **Step 1: Define the auth-aware request wrapper**

Pseudocode:

```text
runNotebookRequest(operation):
  try operation with authenticated client
  if auth failure:
    invalidate runtime client
    force refresh
    retry operation once
  if retry fails with auth issue:
    raise explicit auth error
```

Requirements:

- Only retry once per request
- Restrict automatic retry to recognized auth failures

- [ ] **Step 2: Apply wrapper to notebook operations**

Operations to cover:

- notebook detail
- notebook list
- source list
- notebook ask/chat
- access check

Requirements:

- Keep route handlers thin; retry policy should live below the route layer

- [ ] **Step 3: Convert auth failures to explicit route responses**

Pseudocode:

```text
if auth manager returns reauth_required or refresh_failed:
  return 401 with explicit errorCode
else:
  preserve existing non-auth error behavior
```

- [ ] **Step 4: Run targeted verification**

Run:

- `npm run build --workspace server`

Manual verification:

- simulate expired runtime client
- confirm first request triggers refresh and retry
- confirm irrecoverable auth returns 401, not raw 500

- [ ] **Step 5: Commit**

```bash
git add server/src/notebooklm/client.ts server/src/notebooklm/auth-manager.ts server/src/routes/notebooks/index.ts
git commit -m "feat: retry notebook requests after auth refresh"
```

---

### Task 6: Upgrade `/api/auth/status` To Real Auth State

**Files:**
- Modify: `server/src/routes/auth/index.ts`
- Modify: `server/src/notebooklm/index.ts`
- Modify: `client/src/api/client.ts`

- [ ] **Step 1: Define the new auth status response shape**

Pseudocode:

```text
AuthStatusResponse:
  accountId
  status
  lastCheckedAt
  lastRefreshedAt
  error
```

Requirements:

- Replace the old boolean-based `authenticated` model
- Keep field names aligned with the approved spec

- [ ] **Step 2: Wire `/api/auth/status` to the auth manager**

Pseudocode:

```text
GET /api/auth/status:
  return getAuthProfileStatus(default)
```

- [ ] **Step 3: Update frontend auth status consumer types**

Pseudocode:

```text
client api AuthStatus:
  stop using authenticated/storageStateExists/cookieCount
  use explicit status enum instead
```

- [ ] **Step 4: Run targeted verification**

Run:

- `npm run build --workspace server`
- `npm run build --workspace client`

Expected:

- both builds pass
- frontend compiles against the new auth status shape

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/auth/index.ts server/src/notebooklm/index.ts client/src/api/client.ts
git commit -m "feat: expose explicit notebook auth status states"
```

---

### Task 7: Add Frontend Auth UX For Refreshing And Reauth Required

**Files:**
- Modify: current auth-status consumer views
- Likely Modify: `client/src/views/HomeView.vue`
- Optionally Modify: notebook workbench entry points if they consume auth state

- [ ] **Step 1: Identify current auth status consumers**

Pseudocode:

```text
find all uses of api.getAuthStatus()
map each place to one of:
  passive display
  gating behavior
  startup check
```

Requirements:

- Do not assume HomeView is the only consumer
- Keep UI copy small and explicit

- [ ] **Step 2: Define UI behavior per state**

Pseudocode:

```text
ready -> no warning
refreshing -> show light notice
reauth_required -> show explicit relogin CTA
error -> show failure message
missing -> show setup/login required message
```

- [ ] **Step 3: Run targeted verification**

Run:

- `npm run build --workspace client`

Manual verification:

- confirm UI compiles and can distinguish refreshing vs reauth_required

- [ ] **Step 4: Commit**

```bash
git add client/src/views/HomeView.vue
git commit -m "feat: surface notebook auth refresh states in ui"
```

---

### Task 8: End-To-End Verification And Regression Check

**Files:**
- No new source files required unless a verification note is desired

- [ ] **Step 1: Run full build verification**

Run:

- `npm run build`

Expected:

- monorepo build passes

- [ ] **Step 2: Run server-side auth tests**

Run:

- `node --import tsx --test src/notebooklm/auth-profile.test.ts src/notebooklm/auth-manager.test.ts`

Expected:

- auth unit tests pass

- [ ] **Step 3: Perform manual auth lifecycle checks**

Manual checklist:

- first-time profile initialization works
- service restart preserves login
- expired runtime client can recover automatically
- irrecoverable session produces `reauth_required`
- notebook endpoints return 401 instead of raw 500 on unrecoverable auth failure

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "test: verify notebook auth auto-refresh flow"
```

---

## Self-Review

- Spec coverage: plan covers persisted profile storage, auth state model, health monitor, request retry, route behavior, and frontend auth state consumption.
- Placeholder scan: implementation guidance is intentionally expressed as pseudocode only, per request.
- Type consistency: `default`, `reauth_required`, `refreshing`, `lastCheckedAt`, and `lastRefreshedAt` are used consistently across tasks.
