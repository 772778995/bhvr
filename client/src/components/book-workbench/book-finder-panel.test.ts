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

test("BookFinderPanel reuses the conversation composer styling from ChatPanel", () => {
  const source = readFileSync(new URL("./BookFinderPanel.vue", import.meta.url), "utf8");

  assert.match(source, /getBookFinderTextareaClass\(\)/);
  assert.match(source, /getBookFinderSubmitButtonClass\(\)/);
  assert.doesNotMatch(source, /inline-flex h-\[48px\] shrink-0 items-center justify-center border border-\[#bdaa8c\] bg-\[#efe2cd\]/);
});

test("BookFinderPanel auto-scrolls smoothly and exposes a scroll-to-bottom button", () => {
  const source = readFileSync(new URL("./BookFinderPanel.vue", import.meta.url), "utf8");

  assert.match(source, /onMounted/);
  assert.match(source, /scrollTo\(\{ top: el\.scrollHeight, behavior: "smooth" \}\)/);
  assert.match(source, /scrollContainerRef/);
  assert.match(source, /⇩/);
  assert.match(source, /@click="scrollToBottom"/);
});

test("getBookFinderAssistantBubbleClass preserves assistant paper bubble styling", () => {
  const className = getBookFinderAssistantBubbleClass();

  assert.match(className, /rounded-tl-sm/);
  assert.match(className, /border/);
  assert.match(className, /bg-\[#fffaf2\]/);
});
