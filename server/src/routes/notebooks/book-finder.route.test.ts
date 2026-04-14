import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resetWorkspaceEnvCacheForTests } from "../../book-finder/service.js";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;
const originalDataFilesDir = process.env.DATA_FILES_DIR;
const tempHome = mkdtempSync(join(tmpdir(), "book-finder-route-test-"));
const notebooklmDir = join(tempHome, ".notebooklm");
const defaultProfileDir = join(notebooklmDir, "profiles", "default");
const tempDatabasePath = join(tempHome, "test-notebooklm.db");
const tempDataFilesDir = join(tempHome, "data-files");

mkdirSync(defaultProfileDir, { recursive: true });
mkdirSync(tempDataFilesDir, { recursive: true });
writeFileSync(
  join(notebooklmDir, "storage-state.json"),
  JSON.stringify({
    cookies: [
      {
        name: "SID",
        value: "test-cookie",
        domain: ".google.com",
      },
    ],
  }),
);

process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
process.env.DATABASE_PATH = tempDatabasePath;
process.env.DATA_FILES_DIR = tempDataFilesDir;

process.on("exit", () => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
  if (originalDataFilesDir === undefined) delete process.env.DATA_FILES_DIR;
  else process.env.DATA_FILES_DIR = originalDataFilesDir;
  try {
    rmSync(tempHome, { recursive: true, force: true });
  } catch {
    // SQLite may still hold the temp DB file open during process shutdown on Windows.
  }
});

test("book-finder route tests resolve the database path inside the temp workspace", async () => {
  const { resolveDatabasePath } = await import("../../db/path.js");
  assert.equal(resolveDatabasePath(), tempDatabasePath);
});

test("POST /api/notebooks/:id/book-finder/search records per-source availability stats", async (t) => {
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  const previousToken = process.env.OPENAI_TOKEN;
  const previousModel = process.env.OPENAI_MODEL;
  const originalFetch = globalThis.fetch;
  const notebookId = crypto.randomUUID();

  process.env.OPENAI_BASE_URL = "https://llm.example.test/v1";
  process.env.OPENAI_TOKEN = "token";
  process.env.OPENAI_MODEL = "book-model";
  resetWorkspaceEnvCacheForTests();

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "management", keywords: ["management"], languagePreference: "en" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return new Response(JSON.stringify({
        docs: [
          {
            key: "/works/OL1W",
            title: "Management",
            author_name: ["Peter Drucker"],
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url === "https://annas-archive.gl/search?q=management") {
      return new Response("<!doctype html><div>Results 1-50 (0 total)</div>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://www.gutenberg.org/ebooks/search.opds/?query=management") {
      return new Response('<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    }

    if (url === "https://z-lib.fm/s/management") {
      return new Response("busy", { status: 503 });
    }

    throw new Error(`Unexpected URL in route test: ${url}`);
  };

  const routeModule = await import(`./index.js?book-source-stats=${Date.now()}`);
  const statsModule = await import("../../db/book-source-stats.js");
  const notebooks = routeModule.default;

  t.after(() => {
    globalThis.fetch = originalFetch;
    resetWorkspaceEnvCacheForTests();

    if (previousBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.OPENAI_TOKEN;
    else process.env.OPENAI_TOKEN = previousToken;
    if (previousModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousModel;
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/book-finder/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: "management" }),
  });

  assert.equal(response.status, 200);

  const rows = await statsModule.listBookSourceStats();
  assert.deepEqual(rows.map((row) => [row.sourceId, row.lastStatus, row.attemptCount] as const), [
    ["anna-archive", "empty", 1],
    ["open-library", "success", 1],
    ["project-gutenberg", "empty", 1],
    ["z-library", "failure", 1],
  ]);
});
