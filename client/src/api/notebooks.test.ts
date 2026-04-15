import test from "node:test";
import assert from "node:assert/strict";
import { notebooksApi, type ChatMessage, type Notebook } from "./notebooks.js";

test("getNotebooks requests the notebook list endpoint and unwraps data", async () => {
  const expected: Notebook[] = [
    {
      id: "nb-1",
      title: "AI Research",
      description: "Collected notes",
      updatedAt: "2026-04-07T10:00:00.000Z",
    },
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request) => {
    assert.equal(String(input), "/api/notebooks");

    return new Response(JSON.stringify({ success: true, data: expected }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const notebooks = await notebooksApi.getNotebooks();
    assert.deepEqual(notebooks, expected);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getChatMessages requests the dedicated manual chat endpoint", async () => {
  const expected: ChatMessage[] = [
    {
      id: "msg-1",
      role: "user",
      content: "你好",
      createdAt: "2026-04-14T10:00:00.000Z",
      status: "done",
    },
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request) => {
    assert.equal(String(input), "/api/notebooks/book-1/chat/messages");

    return new Response(JSON.stringify({ success: true, data: expected }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const messages = await notebooksApi.getChatMessages("book-1");
    assert.deepEqual(messages, expected);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deleteNotebook requests the notebook deletion endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let capturedMethod = "";

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "/api/notebooks/book-1");
    capturedMethod = init?.method ?? "GET";

    return new Response(JSON.stringify({ success: true, data: { id: "book-1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await notebooksApi.deleteNotebook("book-1");
    assert.equal(capturedMethod, "DELETE");
    assert.deepEqual(result, { id: "book-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
