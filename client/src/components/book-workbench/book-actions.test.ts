import assert from "node:assert/strict";
import test from "node:test";

import { getQuickReadActionLabel, getResearchPrimaryActionLabel, getResearchStatusCopy } from "./book-actions.js";
import type { ResearchState } from "@/api/notebooks";

function makeState(overrides?: Partial<ResearchState>): ResearchState {
  return {
    status: "idle",
    step: "idle",
    completedCount: 0,
    targetCount: 0,
    ...overrides,
  };
}

test("getResearchPrimaryActionLabel returns stop label while research is running", () => {
  assert.equal(getResearchPrimaryActionLabel(makeState({ status: "running" })), "停止自动研究");
  assert.equal(getResearchPrimaryActionLabel(makeState({ status: "idle" })), "开始自动研究");
});

test("getResearchStatusCopy describes current research progress in book context", () => {
  assert.match(getResearchStatusCopy(makeState({ status: "idle" })), /围绕当前书籍自动生成问题/);
  assert.match(
    getResearchStatusCopy(makeState({ status: "running", step: "waiting_answer", completedCount: 12, targetCount: 20 })),
    /已完成 12 \/ 20/,
  );
  assert.match(
    getResearchStatusCopy(makeState({ status: "failed", lastError: "network error" })),
    /network error/,
  );
});

test("getQuickReadActionLabel exposes loading and idle labels", () => {
  assert.equal(getQuickReadActionLabel(false), "快速读书");
  assert.equal(getQuickReadActionLabel(true), "整理中...");
});

test("getQuickReadActionLabel reports loading state separately from the base label", () => {
  assert.notEqual(getQuickReadActionLabel(true), getQuickReadActionLabel(false));
});
