import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDiscoveredSourcesBody,
  parseUrlBody,
  parseTextBody,
  parseSearchBody,
} from "./source-add-validate.js";

test("parseUrlBody accepts https url", () => {
  const result = parseUrlBody({ url: "https://example.com/article" });
  assert.equal(result.ok, true);
});

test("parseUrlBody rejects non-object bodies", () => {
  const result = parseUrlBody("https://example.com/article");
  assert.deepEqual(result, { ok: false, message: "Invalid request body" });
});

test("parseTextBody rejects empty title", () => {
  const result = parseTextBody({ title: "", content: "notes" });
  assert.equal(result.ok, false);
});

test("parseSearchBody defaults sourceType to web", () => {
  const result = parseSearchBody({ query: "agentic search" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.sourceType, "web");
  }
});

test("parseSearchBody rejects unsupported sourceType", () => {
  const result = parseSearchBody({ query: "agentic search", sourceType: "slack" });
  assert.deepEqual(result, { ok: false, message: "sourceType must be web or drive" });
});

test("parseSearchBody rejects blank sourceType", () => {
  const result = parseSearchBody({ query: "agentic search", sourceType: "   " });
  assert.deepEqual(result, { ok: false, message: "sourceType must be web or drive" });
});

test("parseSearchBody rejects unsupported mode", () => {
  const result = parseSearchBody({ query: "agentic search", mode: "slow" });
  assert.deepEqual(result, { ok: false, message: "mode must be fast or deep" });
});

test("parseSearchBody rejects wrong-typed mode", () => {
  const result = parseSearchBody({ query: "agentic search", mode: 0 });
  assert.deepEqual(result, { ok: false, message: "mode must be fast or deep" });
});

test("parseDiscoveredSourcesBody accepts source ids array", () => {
  const result = parseDiscoveredSourcesBody({
    sessionId: " session-1 ",
    sourceIds: [" src-1 ", "src-2"],
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      sessionId: "session-1",
      sourceIds: ["src-1", "src-2"],
    },
  });
});

test("parseDiscoveredSourcesBody rejects missing sessionId", () => {
  const result = parseDiscoveredSourcesBody({ sourceIds: ["src-1"] });
  assert.deepEqual(result, {
    ok: false,
    message: "sessionId is required",
  });
});

test("parseDiscoveredSourcesBody rejects empty source ids array", () => {
  const result = parseDiscoveredSourcesBody({ sessionId: "session-1", sourceIds: [] });
  assert.deepEqual(result, {
    ok: false,
    message: "sourceIds must contain at least one id",
  });
});

test("parseDiscoveredSourcesBody rejects blank source ids", () => {
  const result = parseDiscoveredSourcesBody({
    sessionId: "session-1",
    sourceIds: ["src-1", "  "],
  });
  assert.deepEqual(result, {
    ok: false,
    message: "sourceIds must contain non-empty strings",
  });
});
