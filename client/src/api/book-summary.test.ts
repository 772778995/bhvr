import assert from "node:assert/strict";
import test from "node:test";

import { generateBookSummary } from "./book-summary.js";

test("generateBookSummary requests report generation with the builtin book-brief preset", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: unknown = null;
  let capturedUrl = "";

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = init?.body ? JSON.parse(String(init.body)) : null;

    return new Response(JSON.stringify({ success: true, data: { message: "书籍简述已生成" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await generateBookSummary("nb-book-1");

    assert.equal(capturedUrl, "/api/notebooks/nb-book-1/report/generate");
    assert.deepEqual(capturedBody, { presetId: "builtin-quick-read" });
    assert.equal(result.message, "书籍简述已生成");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateBookSummary supports the builtin deep-reading preset", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: unknown = null;
  let capturedUrl = "";

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = init?.body ? JSON.parse(String(init.body)) : null;

    return new Response(JSON.stringify({ success: true, data: { message: "详细解读已生成" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await generateBookSummary("nb-book-1", "builtin-deep-reading");

    assert.equal(capturedUrl, "/api/notebooks/nb-book-1/report/generate");
    assert.deepEqual(capturedBody, { presetId: "builtin-deep-reading" });
    assert.equal(result.message, "详细解读已生成");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
