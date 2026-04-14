import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canGenerateBookSummary } from "./book-view-state.js";

test("book-view-state only keeps the quick-read availability helper", () => {
  const source = readFileSync(new URL("./book-view-state.ts", import.meta.url), "utf8");

  assert.match(source, /export function canGenerateBookSummary/);
  assert.doesNotMatch(source, /hasBookResearchHistory/);
  assert.doesNotMatch(source, /ResearchState/);
  assert.doesNotMatch(source, /ChatMessage/);
});

test("canGenerateBookSummary allows quick-read as soon as a book exists and no request is running", () => {
  assert.equal(
    canGenerateBookSummary({
      generating: false,
      hasBook: true,
    }),
    true,
  );

  assert.equal(
    canGenerateBookSummary({
      generating: false,
      hasBook: true,
    }),
    true,
  );

  assert.equal(
    canGenerateBookSummary({
      generating: true,
      hasBook: true,
    }),
    false,
  );

  assert.equal(
    canGenerateBookSummary({
      generating: false,
      hasBook: false,
    }),
    false,
  );
});
