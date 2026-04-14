import assert from "node:assert/strict";
import test from "node:test";

import {
  countResearchAnsweredRounds,
  getQuickReadActionLabel,
  getResearchPrimaryActionLabel,
  getResearchProgressCopy,
  getResearchRoundsCopy,
  getResearchStatusCopy,
} from "./book-actions.js";
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

function makeMessage(id: string, role: ChatMessage["role"]): ChatMessage {
  return {
    id,
    role,
    content: `${role}-${id}`,
    createdAt: "2026-04-13T12:00:00.000Z",
    status: "done",
  };
}

test("getResearchPrimaryActionLabel returns stop label while research is running", () => {
  assert.equal(getResearchPrimaryActionLabel(makeState({ status: "running" })), "停止自动研究");
  assert.equal(getResearchPrimaryActionLabel(makeState({ status: "idle" })), "开始自动研究");
  assert.equal(getResearchPrimaryActionLabel(makeState({ status: "idle" }), "starting"), "启动中...");
});

test("getResearchStatusCopy describes current research progress in book context", () => {
  assert.match(getResearchStatusCopy(makeState({ status: "idle" })), /围绕当前书籍自动生成问题/);
  assert.match(
    getResearchStatusCopy(makeState({ status: "running", step: "waiting_answer", completedCount: 12, targetCount: 20 })),
    /新的问题与回答会陆续写入中栏历史/,
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

test("getQuickReadActionLabel stays on quick-read after loading finishes", () => {
  assert.equal(getQuickReadActionLabel(false), "快速读书");
  assert.notEqual(
    getQuickReadActionLabel(true),
    getQuickReadActionLabel(false),
  );
});

test("getResearchStatusCopy keeps a concrete target count instead of question mark placeholders", () => {
  assert.doesNotMatch(
    getResearchStatusCopy(makeState({ status: "running", completedCount: 1, targetCount: 20 })),
    /\?/,
  );
  assert.doesNotMatch(
    getResearchStatusCopy(makeState({ status: "running", completedCount: 1, targetCount: 0 })),
    /\?/,
  );
});

test("getResearchPrimaryActionLabel remains stable while quick-read work is serialized elsewhere", () => {
  assert.equal(getResearchPrimaryActionLabel(makeState({ status: "idle" })), "开始自动研究");
});

test("getResearchRoundsCopy shows concrete round counts across runtime states", () => {
  assert.equal(getResearchRoundsCopy(0), "当前共 0 轮问答");
  assert.equal(getResearchRoundsCopy(3), "当前共 3 轮问答");
  assert.equal(getResearchRoundsCopy(20), "当前共 20 轮问答");
});

test("countResearchAnsweredRounds uses persisted answers instead of runtime counters", () => {
  assert.equal(
    countResearchAnsweredRounds([
      makeMessage("q-1", "user"),
      makeMessage("a-1", "assistant"),
      makeMessage("q-2", "user"),
      makeMessage("a-2", "assistant"),
      makeMessage("q-3", "user"),
    ]),
    2,
  );
});

test("getResearchProgressCopy keeps current run progress on its own line", () => {
  assert.equal(getResearchProgressCopy(makeState({ status: "idle" })), null);
  assert.equal(getResearchProgressCopy(makeState({ status: "running", completedCount: 0, targetCount: 0 })), "0 / 20");
  assert.equal(getResearchProgressCopy(makeState({ status: "running", completedCount: 7, targetCount: 12 })), "7 / 12");
});
