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
