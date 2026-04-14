import assert from "node:assert/strict";
import test from "node:test";

import {
  getBookSummaryDownloadButtonClass,
  shouldShowBookSummaryDownload,
} from "./book-summary-list.js";
import type { ReportEntry } from "@/api/notebooks";

function makeEntry(overrides?: Partial<ReportEntry>): ReportEntry {
  return {
    id: "entry-1",
    entryType: "research_report",
    title: "书籍总结",
    state: "ready",
    presetId: "builtin-quick-read",
    createdAt: "2026-04-14T08:00:00.000Z",
    updatedAt: "2026-04-14T08:00:00.000Z",
    ...overrides,
  };
}

test("shouldShowBookSummaryDownload only enables icon for ready markdown summaries", () => {
  assert.equal(shouldShowBookSummaryDownload(makeEntry({ content: "# summary" })), true);
  assert.equal(shouldShowBookSummaryDownload(makeEntry({ fileUrl: "/reports/summary.md" })), true);
  assert.equal(shouldShowBookSummaryDownload(makeEntry({ content: undefined, fileUrl: undefined })), false);
  assert.equal(shouldShowBookSummaryDownload(makeEntry({ state: "creating", content: "# summary" })), false);
});

test("getBookSummaryDownloadButtonClass keeps the list download action icon-only", () => {
  assert.doesNotMatch(getBookSummaryDownloadButtonClass(false), /rounded-full/);
  assert.doesNotMatch(getBookSummaryDownloadButtonClass(false), /border/);
  assert.match(getBookSummaryDownloadButtonClass(false), /rounded/);
  assert.match(getBookSummaryDownloadButtonClass(false), /text-\[#6a5b49\]/);
  assert.match(getBookSummaryDownloadButtonClass(false), /hover:bg-\[#efe7d7\]/);
  assert.match(getBookSummaryDownloadButtonClass(true), /opacity-40/);
  assert.match(getBookSummaryDownloadButtonClass(true), /cursor-not-allowed/);
});
