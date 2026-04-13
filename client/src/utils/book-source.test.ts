import assert from "node:assert/strict";
import test from "node:test";

import { getCurrentBookSource } from "./book-source.js";
import type { Source } from "@/api/notebooks";

test("getCurrentBookSource prefers PDF sources and returns null when none exist", () => {
  const sources: Source[] = [
    { id: "text-1", title: "Plain note", type: "text", status: "ready" },
    { id: "pdf-1", title: "Uploaded Book.pdf", type: "pdf", status: "ready" },
  ];

  assert.equal(getCurrentBookSource(sources)?.id, "pdf-1");
  assert.equal(getCurrentBookSource([]), null);
});

test("getCurrentBookSource falls back to the first source for single-book mode", () => {
  const sources: Source[] = [
    { id: "text-1", title: "Converted PDF text", type: "text", status: "processing" },
    { id: "text-2", title: "Historical note", type: "text", status: "ready" },
  ];

  assert.equal(getCurrentBookSource(sources)?.id, "text-1");
});
