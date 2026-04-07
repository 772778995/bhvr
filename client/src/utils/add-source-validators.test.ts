import test from "node:test";
import assert from "node:assert/strict";
import {
  canShowValidationError,
  getRequiredFieldError,
  getUrlFieldError,
  isValidHttpUrl,
  normalizeSearchQuery,
  shouldDisableSubmitAction,
} from "./add-source-validators.js";

test("isValidHttpUrl accepts https", () => {
  assert.equal(isValidHttpUrl("https://example.com"), true);
});

test("isValidHttpUrl rejects whitespace-only input", () => {
  assert.equal(isValidHttpUrl("   "), false);
});

test("isValidHttpUrl rejects non-http protocols", () => {
  assert.equal(isValidHttpUrl("javascript:alert('xss')"), false);
  assert.equal(isValidHttpUrl("ftp://example.com/file.txt"), false);
});

test("normalizeSearchQuery trims whitespace", () => {
  assert.equal(normalizeSearchQuery("  ai agents  "), "ai agents");
});

test("getUrlFieldError returns a user-facing message for invalid urls", () => {
  assert.equal(getUrlFieldError("example.com"), "请输入有效的 http(s) URL");
  assert.equal(getUrlFieldError("https://example.com"), null);
});

test("getRequiredFieldError treats whitespace as empty", () => {
  assert.equal(getRequiredFieldError("   ", "搜索词"), "请输入搜索词");
  assert.equal(getRequiredFieldError("  Article title  ", "标题"), null);
});

test("canShowValidationError stays quiet until interaction or submit", () => {
  assert.equal(canShowValidationError(null, false, false), false);
  assert.equal(canShowValidationError("请输入搜索词", false, false), false);
  assert.equal(canShowValidationError("请输入搜索词", true, false), true);
  assert.equal(canShowValidationError("请输入搜索词", false, true), true);
});

test("shouldDisableSubmitAction only blocks busy state", () => {
  assert.equal(shouldDisableSubmitAction(false), false);
  assert.equal(shouldDisableSubmitAction(true), true);
});
