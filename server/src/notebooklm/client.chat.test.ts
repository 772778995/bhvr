import assert from "node:assert/strict";
import test from "node:test";

import { __testOnly } from "./client.js";

test("extractChatResponseText falls back to rawData when text is empty", () => {
  const result = __testOnly.extractChatResponseText({
    text: "",
    rawData: [["Recovered answer from raw data"]],
    chunks: [],
  });

  assert.equal(result, "Recovered answer from raw data");
});

test("extractChatResponseText falls back to longest chunk text when text is empty", () => {
  const result = __testOnly.extractChatResponseText({
    text: "",
    rawData: undefined,
    chunks: [
      {
        text: "short",
        response: "short",
      },
      {
        text: "Recovered answer from chunks",
        response: "Recovered answer from chunks",
      },
    ],
  });

  assert.equal(result, "Recovered answer from chunks");
});

test("buildChatContextItems uses message ids for continued conversations", () => {
  const result = __testOnly.buildChatContextItems({
    sourceIds: ["source-a", "source-b"],
    conversationId: "conv-1",
    messageIds: ["conv-1", "msg-1"],
  });

  assert.deepEqual(result, [
    [["conv-1"]],
    [["msg-1"]],
  ]);
});

test("buildChatContextItems uses sources for a new conversation", () => {
  const result = __testOnly.buildChatContextItems({
    sourceIds: ["source-a", "source-b"],
  });

  assert.deepEqual(result, [
    [["source-a"]],
    [["source-b"]],
  ]);
});

test("formatEmptyChatResponseError includes structural response hints", () => {
  const result = __testOnly.formatEmptyChatResponseError({
    text: "",
    conversationId: "conv-1",
    messageIds: ["conv-1", "msg-1"],
    rawData: [[""], null, { some: "value" }],
    chunks: [
      {
        text: "",
        response: "",
      },
    ],
  });

  assert.match(result, /Empty response from NotebookLM/);
  assert.match(result, /conversationId=conv-1/);
  assert.match(result, /messageIds=conv-1,msg-1/);
  assert.match(result, /rawData=array\(3\)/);
  assert.match(result, /chunks=1/);
});

test("mergeHistoryMessages flattens threads and excludes internal threads", () => {
  const messages = __testOnly.mergeHistoryMessages(
    [
      [
        { id: "a1", role: "assistant", content: "planner", createdAt: "2026-04-08T00:00:01.000Z", status: "done" },
      ],
      [
        { id: "u1", role: "user", content: "real q1", createdAt: "2026-04-08T00:00:02.000Z", status: "done" },
        { id: "s1", role: "assistant", content: "real a1", createdAt: "2026-04-08T00:00:03.000Z", status: "done" },
      ],
      [
        { id: "u2", role: "user", content: "real q2", createdAt: "2026-04-08T00:00:04.000Z", status: "done" },
      ],
    ],
    ["planner-thread"],
    ["planner-thread", "visible-thread-1", "visible-thread-2"]
  );

  assert.deepEqual(
    messages.map((message) => message.id),
    ["u1", "s1", "u2"]
  );
});
