import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getBookChatAssistantBubbleClass,
  getBookChatUserBubbleClass,
} from "./book-chat";

test("ChatPanel keeps user bubbles right-aligned and content-sized", () => {
  const source = readFileSync(new URL("../notebook-workbench/ChatPanel.vue", import.meta.url), "utf8");

  assert.match(source, /message\.role === 'user' \? 'flex justify-end' : 'flex justify-start'/);
  assert.match(source, /getBookChatUserBubbleClass\(\)/);
  assert.doesNotMatch(source, /ml-auto/);
  assert.match(getBookChatUserBubbleClass(), /inline-block/);
  assert.match(getBookChatUserBubbleClass(), /text-left/);
  assert.match(getBookChatUserBubbleClass(), /max-w-\[75%\]/);
});

test("ChatPanel constrains assistant bubbles and bottom-aligns the composer action", () => {
  const source = readFileSync(new URL("../notebook-workbench/ChatPanel.vue", import.meta.url), "utf8");

  assert.match(getBookChatAssistantBubbleClass(), /max-w-\[88%\]/);
  assert.match(getBookChatAssistantBubbleClass(), /text-left/);
  assert.match(source, /flex items-end gap-3/);
});

test("ChatPanel provides a direct conversation composer instead of auto-research history copy", () => {
  const source = readFileSync(new URL("../notebook-workbench/ChatPanel.vue", import.meta.url), "utf8");

  assert.match(source, /输入问题即可开始/);
  assert.doesNotMatch(source, /自动研究开始后/);
  assert.match(source, /textarea/);
  assert.match(source, /发送/);
  assert.match(source, /onMounted/);
  assert.match(source, /scrollTo\(\{ top: el\.scrollHeight, behavior: "smooth" \}\)/);
});
