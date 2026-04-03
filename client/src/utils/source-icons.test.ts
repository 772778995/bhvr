import test from "node:test";
import assert from "node:assert/strict";
import { iconForSourceType } from "./source-icons.js";

test("maps web/pdf/youtube to explicit icon tokens", () => {
  assert.equal(iconForSourceType("web"), "globe");
  assert.equal(iconForSourceType("pdf"), "file-text");
  assert.equal(iconForSourceType("youtube"), "youtube");
});

test("falls back to generic file icon for unknown types", () => {
  assert.equal(iconForSourceType("unknown"), "file");
});

test("treats empty type as generic file", () => {
  assert.equal(iconForSourceType(""), "file");
});
