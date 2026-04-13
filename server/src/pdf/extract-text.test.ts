import assert from "node:assert/strict";
import test from "node:test";

import { normalizeExtractedPdfText } from "./extract-text.js";

test("normalizeExtractedPdfText collapses blank pages and trims whitespace", () => {
  const normalized = normalizeExtractedPdfText("\n\n  第一章\n\n\n\f\n\n第二章  \n\n");

  assert.equal(normalized, "第一章\n\n第二章");
});

test("normalizeExtractedPdfText rejects effectively empty text", () => {
  assert.throws(
    () => normalizeExtractedPdfText("\n\n\f\n\t  \n"),
    /PDF 中未提取到可用文本/,
  );
});
