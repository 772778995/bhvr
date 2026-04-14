import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getBookSourcePanelLayout,
  getBookSummaryDetailLayout,
} from "./book-layout.js";

test("book source panel pins footer actions to bottom in both empty and loaded states", () => {
  assert.deepEqual(getBookSourcePanelLayout(false), {
    bodyClass: "min-h-0 flex flex-1 flex-col px-5 py-5",
    contentClass: "min-h-0 flex flex-1 flex-col",
    footerClass: "mt-auto border-t border-[#e0d5c3] pt-6",
  });

  assert.deepEqual(getBookSourcePanelLayout(true), {
    bodyClass: "min-h-0 flex flex-1 flex-col px-5 py-5",
    contentClass: "min-h-0 flex flex-1 flex-col overflow-hidden",
    footerClass: "mt-auto border-t border-[#e0d5c3] pt-6",
  });
});

test("book summary detail layout constrains width and overflow inside center column", () => {
  assert.deepEqual(getBookSummaryDetailLayout(), {
    shellClass: "flex h-full min-h-0 overflow-hidden border border-[#d8cfbe] bg-[#fbf6ed]",
    detailPaneClass: "relative min-w-0 min-h-0 flex-1 overflow-hidden",
    detailTransitionName: "folio-note",
  });
});

test("book source and action panels no longer expose quick find buttons", () => {
  const sourcePanelSource = readFileSync(new URL("./BookSourcePanel.vue", import.meta.url), "utf8");
  const actionPanelSource = readFileSync(new URL("./BookActionsPanel.vue", import.meta.url), "utf8");

  assert.equal((sourcePanelSource.match(/上传书籍/gu) ?? []).length, 1);
  assert.doesNotMatch(sourcePanelSource, /快速找书/);
  assert.doesNotMatch(sourcePanelSource, /onBookFinder/);
  assert.doesNotMatch(actionPanelSource, /快速找书/);
  assert.doesNotMatch(actionPanelSource, /onBookFinder/);
});
