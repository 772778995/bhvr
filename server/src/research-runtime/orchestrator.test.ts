import assert from "node:assert/strict";
import test from "node:test";

import { runAutoResearch } from "./orchestrator.js";
import * as registry from "./registry.js";
import type { ResearchDriver } from "./types.js";

test("runAutoResearch fails when next-question generation returns empty", async () => {
  const notebookId = `nb-${crypto.randomUUID()}`;
  const prompts: string[] = [];
  const driver: ResearchDriver = {
    async nextQuestion() {
      prompts.push("planner");
      return { success: false, error: "Empty response from NotebookLM" };
    },
    async askQuestion(_id, question) {
      prompts.push(question);
      return { success: true, answer: `Answer for: ${question}`, conversationId: "visible-thread" };
    },
    getHiddenConversationIds() {
      return ["planner-thread"];
    },
  };

  await runAutoResearch(
    notebookId,
    driver,
    { targetCount: 3, turnDelayMs: 0 }
  );

  const state = registry.get(notebookId);
  assert.equal(state?.status, "failed");
  assert.equal(state?.completedCount, 0);
  assert.equal(prompts.length, 1);
});

test("runAutoResearch stops when stop is requested", async () => {
  const notebookId = `nb-${crypto.randomUUID()}`;
  let answerCount = 0;
  const driver: ResearchDriver = {
    async nextQuestion() {
      return { success: true, question: `Question ${answerCount + 1}`, plannerConversationId: "planner-thread" };
    },
    async askQuestion() {
      answerCount += 1;
      const result = {
        success: true,
        answer: `Answer ${answerCount}`,
        conversationId: "visible-thread",
      };

      if (answerCount === 2) {
        registry.requestStop(notebookId);
      }

      return result;
    },
    getHiddenConversationIds() {
      return ["planner-thread"];
    },
  };

  await runAutoResearch(
    notebookId,
    driver,
    { targetCount: 5, turnDelayMs: 0 }
  );

  const state = registry.get(notebookId);
  assert.equal(state?.status, "stopped");
  assert.equal(state?.completedCount, 2);
});
