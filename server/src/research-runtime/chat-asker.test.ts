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
    conversationId: "conv-1",
  });
  assert.deepEqual(second, {
    success: true,
    answer: "Second answer",
    citations: [],
    conversationId: "conv-1",
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
      conversationId: "conv-1",
      conversationHistory: [
        { role: "user", message: "Generate questions" },
        { role: "assistant", message: "1. First question\n2. Second question" },
      ],
    },
  ]);
});

test("createNotebookConversationAsker drops source ids after the first turn", async () => {
  const calls: Array<{
    notebookId: string;
    prompt: string;
    sourceIds?: string[];
    conversationId?: string;
    conversationHistory?: Array<{ role: "user" | "assistant"; message: string }>;
  }> = [];

  const ask = createNotebookConversationAsker(
    "nb-1",
    ["source-a"],
    async (notebookId, request) => {
      calls.push({ notebookId, ...request });

      if (calls.length === 1) {
        return {
          text: "First answer",
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

  await ask("nb-1", "First question");
  await ask("nb-1", "Follow-up question");

  assert.deepEqual(calls, [
    {
      notebookId: "nb-1",
      prompt: "First question",
      sourceIds: ["source-a"],
    },
    {
      notebookId: "nb-1",
      prompt: "Follow-up question",
      conversationId: "conv-1",
      conversationHistory: [
        { role: "user", message: "First question" },
        { role: "assistant", message: "First answer" },
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

test("createNotebookConversationAsker accepts fallback response text when primary text is empty", async () => {
  const ask = createNotebookConversationAsker(
    "nb-1",
    [],
    async () => ({
      text: "1. Recovery question",
      conversationId: "conv-1",
      messageIds: ["conv-1", "msg-1"],
      citations: [],
    })
  );

  const result = await ask("nb-1", "Generate questions");

  assert.deepEqual(result, {
    success: true,
    answer: "1. Recovery question",
    citations: [],
    conversationId: "conv-1",
  });
});
