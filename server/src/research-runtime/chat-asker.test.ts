import assert from "node:assert/strict";
import test from "node:test";

import { createNotebookConversationAsker, createNotebookResearchDriver } from "./chat-asker.js";

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

test("createNotebookResearchDriver asks planner and visible turns in Chinese", async () => {
  const requests: string[] = [];
  const driver = createNotebookResearchDriver(
    "nb-1",
    ["source-a"],
    async (_notebookId, request) => {
      requests.push(request.prompt);

      if (requests.length === 1) {
        return {
          text: "请从作者的问题意识切入，这本书最值得先追问什么？",
          conversationId: "planner-1",
          messageIds: ["planner-1", "msg-1"],
          citations: [],
        };
      }

      return {
        text: "这是中文回答。",
        conversationId: "visible-1",
        messageIds: ["visible-1", "msg-2"],
        citations: [],
      };
    }
  );

  const questionResult = await driver.nextQuestion("nb-1");
  assert.equal(questionResult.success, true);
  assert.match(requests[0] ?? "", /请使用中文/);
  assert.match(requests[0] ?? "", /不要输出与问题无关的任何内容/);
  assert.match(requests[0] ?? "", /第 n 轮|第 3 轮|包装文本/);

  const answerResult = await driver.askQuestion("nb-1", questionResult.question!);
  assert.equal(answerResult.success, true);
  assert.match(requests[1] ?? "", /请仅使用中文回答/);
});

test("createNotebookResearchDriver strips round markers and other wrappers from planner output", async () => {
  const driver = createNotebookResearchDriver(
    "nb-1",
    ["source-a"],
    async () => ({
      text: "（第 3 轮）问题：这本书最值得优先验证的核心论点是什么？",
      conversationId: "planner-1",
      messageIds: ["planner-1", "msg-1"],
      citations: [],
    })
  );

  const questionResult = await driver.nextQuestion("nb-1");

  assert.equal(questionResult.success, true);
  assert.equal(questionResult.question, "这本书最值得优先验证的核心论点是什么？");
});

test("createNotebookResearchDriver falls back when planner returns an English question", async () => {
  const driver = createNotebookResearchDriver(
    "nb-1",
    ["source-a"],
    async () => ({
      text: "What is the author's core argument?",
      conversationId: "planner-1",
      messageIds: ["planner-1", "msg-1"],
      citations: [],
    })
  );

  const questionResult = await driver.nextQuestion("nb-1");

  assert.equal(questionResult.success, false);
  assert.match(questionResult.error ?? "", /中文/);
});
