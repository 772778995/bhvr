# AGENTS.md — NotebookLM Research Engine

## Project Overview

A wrapper around Google NotebookLM that automates deep research. Users upload documents to NotebookLM manually, then this system auto-generates research questions, asks them one-by-one via the NotebookLM API, collects answers, and compiles a full research report. Leverages NotebookLM's zero-hallucination + source-citation capabilities.

## Tech Stack

- **Runtime**: Node.js + tsx (TypeScript execution)
- **Monorepo**: npm workspaces + Turborepo (`client/`, `server/`, `shared/`)
- **Backend**: Hono.js + @hono/node-server + TypeScript
- **Database**: SQLite via Drizzle ORM + @libsql/client
- **NotebookLM API**: `notebooklm-kit` SDK (pure HTTP RPC, no browser needed for API calls)
- **Frontend** (later): Vue 3 + Vite + TailwindCSS + shadcn-vue
- **Validation**: Zod

## Architecture

```
POST /api/research {notebook_url, topic, num_questions}
  → research_task created (status: pending)
  → FIFO queue picks it up
  → [Step 1] Ask NotebookLM to "generate N research questions" → parse list
  → [Step 2] Ask each question via SDK chat API → store answers
  → [Step 3] Ask "compile full research report" → store report
  → task.status = done
```

Single worker, single Google account, FIFO task queue. All NotebookLM interaction is via HTTP RPC (notebooklm-kit SDK). No browser automation in the loop. No external LLM for MVP — all intelligence comes from NotebookLM itself.

## Key Directories

```
server/src/
├── db/            # Drizzle schema + connection (@libsql/client SQLite)
├── routes/        # API route handlers (auth, research, health)
├── notebooklm/    # NotebookLM SDK client (auth, ask, list notebooks)
└── worker/        # Task queue + research orchestration logic
```

## NotebookLM API Notes

- **notebooklm-kit** SDK communicates via Google's internal batchexecute RPC protocol (pure HTTP POST, no browser).
- Auth requires one-time manual login via `npx notebooklm login` (launches a browser). Session saved to `~/.notebooklm/storage-state.json`.
- After login, the server reads cookies from storage-state.json and fetches an auth token (SNlM0e) from the NotebookLM homepage.
- The SDK sends cookies as `Cookie` header + auth token in POST body on every request.
- The SDK supports: listing/creating notebooks, adding sources, chat (with streaming), and generating artifacts (audio, video, slides, quiz, flashcards).
- 50 queries/day rate limit on Google's free tier.

## Coding Conventions

- Use TypeScript strict mode.
- Follow hono-open-api-starter patterns for route organization.
- Database: Drizzle ORM with `drizzle-orm/libsql`. Use `snake_case` for DB columns.
- IDs: Use `crypto.randomUUID()` for text primary keys.
- No `console.log` in production code — use structured logging if needed.

## Important Constraints

- NotebookLM has NO public API. The notebooklm-kit SDK reverse-engineers Google's internal RPC protocol — it may break when Google updates.
- First-time auth requires running `npx notebooklm login` which opens a visible browser window. After that, all operations are pure HTTP.
- IMPORTANT: Bun's fetch() is incompatible with Google's cookie validation (returns CookieMismatch). The server MUST run under Node.js.
- The `data/` directory (SQLite DB) is gitignored.
- Never commit `.env`, `data/`, or `~/.notebooklm/` files.
