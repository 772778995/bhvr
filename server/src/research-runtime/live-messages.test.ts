import assert from "node:assert/strict";
import test from "node:test";

import {
  appendAssistantMessage,
  appendUserMessage,
  clearLiveMessages,
  getLiveMessages,
} from "./live-messages.js";

test("live message store preserves appended research conversation order", () => {
  const notebookId = `nb-${crypto.randomUUID()}`;

  appendUserMessage(notebookId, "Question 1");
  appendAssistantMessage(notebookId, "Answer 1");
  appendUserMessage(notebookId, "Question 2");

  const messages = getLiveMessages(notebookId);

  assert.equal(messages.length, 3);
  assert.deepEqual(
    messages.map((message) => ({ role: message.role, content: message.content })),
    [
      { role: "user", content: "Question 1" },
      { role: "assistant", content: "Answer 1" },
      { role: "user", content: "Question 2" },
    ]
  );

  clearLiveMessages(notebookId);
  assert.deepEqual(getLiveMessages(notebookId), []);
});
