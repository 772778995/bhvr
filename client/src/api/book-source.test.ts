import assert from "node:assert/strict";
import test from "node:test";

import { uploadBookSourcePdf } from "./book-source.js";

test("uploadBookSourcePdf posts multipart form data to the book upload SSE endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; accept: string | null; hasFile: boolean }> = [];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body;
    assert.ok(body instanceof FormData);

    const file = body.get("file");
    assert.ok(file instanceof File);

    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      accept: new Headers(init?.headers).get("Accept"),
      hasFile: file instanceof File,
    });

    return new Response("event: complete\ndata: {\"success\":true,\"result\":{\"sourceIds\":[\"source-1\"],\"wasChunked\":false}}\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  try {
    const file = new File(["pdf bytes"], "book.pdf", { type: "application/pdf" });
    const result = await uploadBookSourcePdf("nb-1", file, () => {});

    assert.deepEqual(calls, [
      {
        url: "/api/notebooks/nb-1/book-source/stream/upload-pdf",
        method: "POST",
        accept: "text/event-stream",
        hasFile: true,
      },
    ]);
    assert.equal(result.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
