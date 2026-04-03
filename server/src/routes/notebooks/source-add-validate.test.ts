import test from "node:test";
import assert from "node:assert/strict";
import {
  parseUrlBody,
  parseTextBody,
  parseSearchBody,
} from "./source-add-validate.js";

test("parseUrlBody accepts https url", () => {
  const result = parseUrlBody({ url: "https://example.com/article" });
  assert.equal(result.ok, true);
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
