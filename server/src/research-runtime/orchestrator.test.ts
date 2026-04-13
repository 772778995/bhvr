import assert from "node:assert/strict";
import test from "node:test";

import { runAutoResearch } from "./orchestrator.js";
import * as registry from "./registry.js";
import type { ResearchDriver } from "./types.js";

test("runAutoResearch falls back instead of failing when next-question generation returns empty", async () => {
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
    async feedContext() {},
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
  assert.equal(state?.status, "completed");
  assert.equal(state?.completedCount, 3);
  assert.equal(prompts.length, 6);
});

test("runAutoResearch falls back to default Chinese questions when planner returns empty response", async () => {
  const notebookId = `nb-${crypto.randomUUID()}`;
  const askedQuestions: string[] = [];
  let plannerAttempted = false;

  const driver: ResearchDriver = {
    async nextQuestion() {
      if (!plannerAttempted) {
        plannerAttempted = true;
        return { success: false, error: "Empty response from NotebookLM" };
      }
      return { success: true, question: "unused" };
    },
    async askQuestion(_id, question) {
      askedQuestions.push(question);
      return { success: true, answer: `Answer for: ${question}`, conversationId: "visible-thread" };
    },
    async feedContext() {},
    getHiddenConversationIds() {
      return ["planner-thread"];
    },
  };

  await runAutoResearch(
    notebookId,
    driver,
    { targetCount: 1, turnDelayMs: 0 }
  );

  const state = registry.get(notebookId);
  assert.equal(state?.status, "completed");
  assert.equal(state?.completedCount, 1);
  assert.equal(askedQuestions.length, 1);
  assert.match(askedQuestions[0] ?? "", /最核心的研究问题|关键的结论|背景、现状、趋势/);
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
    async feedContext() {},
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
