# AGENTS.md — NotebookLM Research Engine

## Project Overview

A wrapper around Google NotebookLM that automates deep research. Users upload documents to NotebookLM manually, then this system auto-generates research questions, asks them one-by-one via browser automation, collects answers, and compiles a full research report. Leverages NotebookLM's zero-hallucination + source-citation capabilities.

## Tech Stack

- **Runtime**: Bun
- **Monorepo**: Bun workspaces + Turborepo (`client/`, `server/`, `shared/`)
- **Backend**: Hono.js + TypeScript
- **Database**: SQLite via Drizzle ORM (Bun native SQLite)
- **Browser Automation**: Patchright (undetected Playwright fork) — `patchright` npm package
- **Frontend** (later): Vue 3 + Vite + TailwindCSS + shadcn-vue
- **Validation**: Zod

## Architecture

```
POST /api/research {notebook_url, topic, num_questions}
  → research_task created (status: pending)
  → FIFO queue picks it up
  → [Step 1] Open notebook → ask "generate N research questions" → parse list
  → [Step 2] Ask each question (new browser session per question) → store answers
  → [Step 3] Ask "compile full research report" → store report
  → task.status = done
```

Single Playwright worker, single Google account, FIFO task queue. Each browser session is stateless (open → act → close). No LLM in the loop for MVP — all intelligence comes from NotebookLM itself.

## Key Directories

```
server/src/
├── lib/           # Hono app factory, types, env config
├── db/            # Drizzle schema + connection (Bun SQLite)
├── routes/        # API route handlers (auth, research, health)
├── browser/       # Patchright automation (engine, auth, notebooklm interaction, selectors)
└── worker/        # Task queue + research orchestration logic
```

## Browser Automation Notes

- **Patchright** is a drop-in replacement for Playwright. Same API, import `patchright` instead of `playwright`.
- Must use `channel: "chrome"` (real Chrome, not Chromium) for anti-detection.
- Use `launchPersistentContext` with `user_data_dir` for consistent browser fingerprint.
- Human-like typing: 25-75ms per character, 5% chance of pause.
- Response polling: wait for answer text to be stable for 3 consecutive 1-second polls.
- CSS selectors for NotebookLM UI are in `browser/selectors.ts` — these WILL break when Google updates their UI. Keep them centralized.
- Auth requires one-time manual login in headful browser. Session saved to `data/browser_state/`.
- 50 queries/day rate limit on Google's free tier.

## Coding Conventions

- Use TypeScript strict mode.
- Follow hono-open-api-starter patterns for route organization: `*.index.ts` (router), `*.routes.ts` (route definitions), `*.handlers.ts` (handlers).
- Database: Drizzle ORM with `drizzle-orm/bun-sqlite`. Use `snake_case` for DB columns.
- IDs: Use `crypto.randomUUID()` for text primary keys.
- Error handling: Always clean up browser resources in `finally` blocks.
- No `console.log` in production code — use structured logging if needed.

## Important Constraints

- NotebookLM has NO public API. Everything is browser automation — fragile by nature.
- Each question = new browser session (open + close). No persistent chat context between questions.
- First-time auth requires a visible browser window (headful). Cannot run in headless-only environments for setup.
- The `data/` directory (browser state, SQLite DB) is gitignored.
- Never commit `.env`, `data/`, or `browser_state/` files.
