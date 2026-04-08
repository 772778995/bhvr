import assert from "node:assert/strict";
import test from "node:test";

import { createNotebookConversationAsker } from "./chat-asker.js";

test("createNotebookConversationAsker uses send-message flow and preserves conversation context", async () => {
  const calls: Array<{
    notebookId: string;
    prompt: string;
    sourceIds?: string[];
    conversationId?: string;
    conversationHistory?: Array<{ role: "user" | "assistant"; message: string }>;
  }> = [];

  const ask = createNotebookConversationAsker(
    "nb-1",
    ["source-a", "source-b"],
    async (notebookId, request) => {
      calls.push({ notebookId, ...request });

      if (calls.length === 1) {
        return {
          text: "1. First question\n2. Second question",
          conversationId: "conv-1",
          messageIds: ["conv-1", "msg-1"],
          citations: [],
        };
      }

      return {
        text: "Second answer",
        conversationId: "conv-1",
        messageIds: ["conv-1", "msg-2"],
        citations: [],
      };
    }
  );

  const first = await ask("nb-1", "Generate questions");
  const second = await ask("nb-1", "Ask the first question");

  assert.deepEqual(first, {
    success: true,
    answer: "1. First question\n2. Second question",
    citations: [],
  });
  assert.deepEqual(second, {
    success: true,
    answer: "Second answer",
    citations: [],
  });

  assert.deepEqual(calls, [
    {
      notebookId: "nb-1",
      prompt: "Generate questions",
      sourceIds: ["source-a", "source-b"],
    },
    {
      notebookId: "nb-1",
      prompt: "Ask the first question",
      sourceIds: ["source-a", "source-b"],
      conversationId: "conv-1",
      conversationHistory: [
        { role: "user", message: "Generate questions" },
        { role: "assistant", message: "1. First question\n2. Second question" },
      ],
    },
  ]);
});

test("createNotebookConversationAsker maps send-message failures to unsuccessful ask results", async () => {
  const ask = createNotebookConversationAsker("nb-1", [], async () => {
    throw new Error("backend exploded");
  });

  const result = await ask("nb-1", "Hello");

  assert.deepEqual(result, {
    success: false,
    error: "backend exploded",
  });
});
