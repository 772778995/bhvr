import test from "node:test";
import assert from "node:assert/strict";
import { notebooksApi, type Notebook } from "./notebooks.js";

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
