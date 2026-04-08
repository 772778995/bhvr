import assert from "node:assert/strict";
import test from "node:test";

import { runAutoResearch } from "./orchestrator.js";
import * as registry from "./registry.js";

test("runAutoResearch falls back to built-in questions when question generation returns empty", async () => {
  const notebookId = `nb-${crypto.randomUUID()}`;
  const prompts: string[] = [];

  await runAutoResearch(
    notebookId,
    async (_id, prompt) => {
      prompts.push(prompt);

      if (prompts.length === 1) {
        return { success: false, error: "Empty response from NotebookLM" };
      }

      return { success: true, answer: `Answer for: ${prompt}` };
    },
    { targetCount: 3, turnDelayMs: 0 }
  );

  const state = registry.get(notebookId);
  assert.equal(state?.status, "completed");
  assert.equal(state?.completedCount, 3);
  assert.equal(prompts.length, 4);
});
