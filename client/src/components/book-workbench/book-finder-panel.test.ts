import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("BookFinderPanel keeps user bubbles right-aligned and content-sized", () => {
  const source = readFileSync(new URL("./BookFinderPanel.vue", import.meta.url), "utf8");

  assert.match(source, /message\.role === 'user' \? 'flex justify-end' : 'flex justify-start'/);
  assert.match(getBookFinderUserBubbleClass(), /inline-block/);
  assert.match(getBookFinderUserBubbleClass(), /shrink-0/);
  assert.match(getBookFinderUserBubbleClass(), /max-w-\[75%\]/);
});

test("getBookFinderAssistantBubbleClass preserves assistant paper bubble styling", () => {
  const className = getBookFinderAssistantBubbleClass();

  assert.match(className, /rounded-tl-sm/);
  assert.match(className, /border/);
  assert.match(className, /bg-\[#fffaf2\]/);
});
