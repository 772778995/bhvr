import assert from "node:assert/strict";
import test from "node:test";

import {
  generateBookSummary,
  getBookSummaryPreset,
  updateBookSummaryPreset,
} from "./book-summary.js";

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

test("generateBookSummary supports the builtin book mindmap preset", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: unknown = null;

  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body ? JSON.parse(String(init.body)) : null;

    return new Response(JSON.stringify({ success: true, data: { message: "书籍导图已生成" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await generateBookSummary("nb-book-1", "builtin-book-mindmap");

    assert.deepEqual(capturedBody, { presetId: "builtin-book-mindmap" });
    assert.equal(result.message, "书籍导图已生成");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getBookSummaryPreset loads the builtin quick-read preset for prompt editing", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";

  globalThis.fetch = async (input: string | URL | Request) => {
    capturedUrl = String(input);

    return new Response(JSON.stringify({
      id: "builtin-quick-read",
      name: "书籍简述",
      description: "300字内概括主旨、结构、案例与适用人群的短版总结",
      prompt: "请输出书籍简述",
      isBuiltin: true,
      createdAt: 1,
      updatedAt: 2,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const preset = await getBookSummaryPreset("builtin-quick-read");

    assert.equal(capturedUrl, "/api/presets/builtin-quick-read");
    assert.equal(preset.id, "builtin-quick-read");
    assert.equal(preset.prompt, "请输出书籍简述");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateBookSummaryPreset only sends prompt updates for builtin deep-reading", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedBody: unknown = null;

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedMethod = init?.method ?? "GET";
    capturedBody = init?.body ? JSON.parse(String(init.body)) : null;

    return new Response(JSON.stringify({
      id: "builtin-deep-reading",
      name: "详细解读",
      description: "5000字内的结构化深度解读",
      prompt: "请输出新的详细解读提示词",
      isBuiltin: true,
      createdAt: 1,
      updatedAt: 3,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const preset = await updateBookSummaryPreset("builtin-deep-reading", "请输出新的详细解读提示词");

    assert.equal(capturedUrl, "/api/presets/builtin-deep-reading");
    assert.equal(capturedMethod, "PUT");
    assert.deepEqual(capturedBody, { prompt: "请输出新的详细解读提示词" });
    assert.equal(preset.prompt, "请输出新的详细解读提示词");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
