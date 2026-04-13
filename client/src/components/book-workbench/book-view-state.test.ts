import assert from "node:assert/strict";
import test from "node:test";

import { canGenerateBookSummary, hasBookResearchHistory } from "./book-view-state.js";
import type { ChatMessage, ResearchState } from "@/api/notebooks";

function makeState(overrides?: Partial<ResearchState>): ResearchState {
  return {
    status: "idle",
    step: "idle",
    completedCount: 0,
    targetCount: 0,
    ...overrides,
  };
}

function makeMessage(id: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "summary-ready",
    createdAt: "2026-04-13T12:00:00.000Z",
    status: "done",
  };
}

test("hasBookResearchHistory stays true when persisted history exists", () => {
  assert.equal(
    hasBookResearchHistory({
      messages: [makeMessage("msg-1")],
      researchState: makeState({ completedCount: 0 }),
    }),
    true,
  );
});

test("hasBookResearchHistory stays true when runtime research progress already exists", () => {
  assert.equal(
    hasBookResearchHistory({
      messages: [],
      researchState: makeState({ completedCount: 2 }),
    }),
    true,
  );
});

test("canGenerateBookSummary blocks only when there is no history or a request is already running", () => {
  assert.equal(
    canGenerateBookSummary({
      generating: false,
      messages: [makeMessage("msg-1")],
      researchState: makeState({ completedCount: 0 }),
    }),
    true,
  );

  assert.equal(
    canGenerateBookSummary({
      generating: false,
      messages: [],
      researchState: makeState({ completedCount: 0 }),
    }),
    false,
  );

  assert.equal(
    canGenerateBookSummary({
      generating: true,
      messages: [makeMessage("msg-1")],
      researchState: makeState({ completedCount: 3 }),
    }),
    false,
  );
});
