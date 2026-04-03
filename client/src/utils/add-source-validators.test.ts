import test from "node:test";
import assert from "node:assert/strict";
import { isValidHttpUrl, normalizeSearchQuery } from "./add-source-validators.js";

test("isValidHttpUrl accepts https", () => {
  assert.equal(isValidHttpUrl("https://example.com"), true);
});

test("normalizeSearchQuery trims whitespace", () => {
  assert.equal(normalizeSearchQuery("  ai agents  "), "ai agents");
});
