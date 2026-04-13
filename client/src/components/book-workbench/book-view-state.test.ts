import assert from "node:assert/strict";
import test from "node:test";

import { canGenerateBookSummary } from "./book-view-state.js";
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

test("canGenerateBookSummary stays available when persisted history exists", () => {
  assert.equal(
    canGenerateBookSummary({
      generating: false,
      messages: [makeMessage("msg-1")],
      researchState: makeState({ completedCount: 0 }),
    }),
    true,
  );
});

test("canGenerateBookSummary blocks when there is no history or a request is already running", () => {
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
