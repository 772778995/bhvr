import assert from "node:assert/strict";
import test from "node:test";
import {
  getBookCenterTransition,
  getBookCenterTransitionName,
  getBookDetailTransition,
  getWorkbenchLoaderLabel,
} from "./book-motion.js";

test("book workbench motion exposes stable transition and loader copy", () => {
  assert.equal(getBookCenterTransitionName(), "folio-panel");
  assert.equal(getWorkbenchLoaderLabel(), "正在加载工作台...");
});

test("book center transition keeps motion restrained for fixed panels", () => {
  assert.deepEqual(getBookCenterTransition(), {
    name: "folio-panel",
    enterX: 8,
    enterY: 0,
    leaveX: -6,
    durationEnterMs: 170,
    durationLeaveMs: 120,
  });
});

test("book detail transition exposes a lighter markdown folio motion", () => {
  assert.deepEqual(getBookDetailTransition(), {
    name: "folio-note",
    enterX: 10,
    enterY: 0,
    leaveX: -8,
    durationEnterMs: 180,
    durationLeaveMs: 120,
  });
});
