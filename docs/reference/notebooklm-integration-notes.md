# NotebookLM Integration Notes

## Status

- NotebookLM has no stable public API key flow in this project.
- The current integration depends on browser cookies, page token extraction, and reverse-engineered internal RPC calls.
- Upstream NotebookLM changes can break only part of the stack. Do not assume "all SDK methods are broken" or "all SDK methods still work".

## What Was Observed

- A raw token fetch to `https://notebooklm.google.com/` can return `302` with `location=unsupported` even when the browser session still works.
- Browser page access and SDK service access can diverge.
- In one confirmed case, the NotebookLM web UI could list notebooks, while `notebooklm-kit` `notebooks.list()` returned `Permission denied`.
- Notebook detail, sources, and messages may still work for visible notebooks even when list has compatibility issues.

## Practical Lessons

### 1. Treat auth and capability as separate checks

- `auth/status = ready` does not prove every NotebookLM capability still works.
- Verify specific capabilities separately:
  - list notebooks
  - notebook detail
  - notebook sources
  - notebook messages
  - chat
  - artifact create/list/get

### 2. Do not trust a single failing notebook id

- A `403` on a notebook id may be a real access issue for that notebook, not proof that the whole SDK is broken.
- Always compare against notebook ids that are visibly present in the real NotebookLM web UI for the same browser profile.

### 3. Browser truth beats SDK assumptions

- If the browser UI works but an SDK service method fails, treat the SDK method as suspect.
- Capture the real page behavior before changing code:
  - which notebook ids are visible
  - which `batchexecute` RPC ids are used
  - whether responses are `200`

### 4. Stabilize through adapter boundaries, not wishful thinking

- Keep NotebookLM integration logic centralized.
- Avoid spreading direct `notebooklm-kit` calls across business code.
- If one capability must be bypassed, isolate the bypass in the adapter layer.

## Current Known Notes

- Token extraction is more reliable when using the persistent browser profile than relying only on a raw fetch request.
- Recoverable auth failures should trigger silent refresh and retry during runtime client creation.
- `Permission denied` should not be reported to the client as `INTERNAL_SERVER_ERROR`.
- Notebook list behavior must be tested against the real visible browser state, not guessed from stale ids.

## Debugging Checklist For Future Breakage

1. Confirm the browser profile can still open `https://notebooklm.google.com/`.
2. Confirm visible notebook ids from the real page.
3. Compare browser-visible ids against the ids used in server/API tests.
4. Check whether failure is in:
   - token fetch
   - runtime client creation
   - a specific SDK service method
   - a custom RPC parser
5. Do not generalize from one failing method to the whole integration without direct evidence.

## Implementation Rule

- When NotebookLM breaks again, first collect live evidence from the browser profile and the exact failing capability.
- Only then decide whether the fix belongs in:
  - auth recovery
  - error mapping
  - SDK bypass for one capability
  - custom RPC parsing
