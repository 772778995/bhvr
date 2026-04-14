import assert from "node:assert/strict";
import test from "node:test";

import {
  getBookFinderAssistantBubbleClass,
  getBookFinderUserBubbleClass,
  shouldSubmitBookFinderKeydown,
} from "./book-finder-panel";

test("shouldSubmitBookFinderKeydown ignores IME composition enter", () => {
  assert.equal(shouldSubmitBookFinderKeydown({ key: "Enter", shiftKey: false, isComposing: true }), false);
  assert.equal(shouldSubmitBookFinderKeydown({ key: "Enter", shiftKey: true, isComposing: false }), false);
  assert.equal(shouldSubmitBookFinderKeydown({ key: "Enter", shiftKey: false, isComposing: false }), true);
});

test("getBookFinderUserBubbleClass keeps long user tokens wrapped", () => {
  const className = getBookFinderUserBubbleClass();

  assert.match(className, /whitespace-pre-wrap/);
  assert.match(className, /overflow-wrap-anywhere/);
  assert.match(className, /break-words/);
});

test("getBookFinderAssistantBubbleClass preserves assistant paper bubble styling", () => {
  const className = getBookFinderAssistantBubbleClass();

  assert.match(className, /rounded-tl-sm/);
  assert.match(className, /border/);
  assert.match(className, /bg-\[#fffaf2\]/);
});
