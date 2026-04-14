import assert from "node:assert/strict";
import test from "node:test";

import {
  getBookCenterTabButtonClass,
  getBookCenterTabIndicatorClass,
  getBookCenterTabs,
  getBookSummaries,
  getBookSummaryEntry,
} from "./book-center.js";
import type { ReportEntry } from "@/api/notebooks";

test("getBookCenterTabs keeps 对话、书籍总结、快速找书 as the stable middle order", () => {
  assert.deepEqual(getBookCenterTabs(false), [
    { key: "chat", label: "对话" },
    { key: "summary", label: "书籍总结" },
    { key: "book-finder", label: "快速找书" },
  ]);
  assert.deepEqual(getBookCenterTabs(true), [
    { key: "chat", label: "对话" },
    { key: "summary", label: "书籍总结" },
    { key: "book-finder", label: "快速找书" },
  ]);
});

test("getBookCenterTabs puts 书籍总结 before 快速找书", () => {
  const tabs = getBookCenterTabs(true);

  assert.equal(tabs[0]?.key, "chat");
  assert.equal(tabs[0]?.label, "对话");
  assert.equal(tabs[1]?.key, "summary");
  assert.equal(tabs[2]?.key, "book-finder");
  assert.equal(tabs[1]?.label, "书籍总结");
  assert.equal(tabs[2]?.label, "快速找书");
});

test("getBookSummaryEntry returns the latest supported book summary report", () => {
  const entries: ReportEntry[] = [
    {
      id: "entry-1",
      entryType: "artifact",
      title: "音频概述",
      state: "ready",
      artifactType: "audio",
      createdAt: "2026-04-13T10:00:00.000Z",
      updatedAt: "2026-04-13T10:00:00.000Z",
    },
    {
      id: "entry-2",
      entryType: "research_report",
      title: "旧书籍总结",
      state: "ready",
      presetId: "builtin-quick-read",
      createdAt: "2026-04-13T09:00:00.000Z",
      updatedAt: "2026-04-13T09:00:00.000Z",
    },
    {
      id: "entry-3",
      entryType: "research_report",
      title: "最新详细解读",
      state: "ready",
      presetId: "builtin-deep-reading",
      createdAt: "2026-04-13T11:00:00.000Z",
      updatedAt: "2026-04-13T11:00:00.000Z",
    },
  ];

  assert.equal(getBookSummaryEntry(entries)?.id, "entry-3");
  assert.equal(getBookSummaryEntry([]), null);
});

test("getBookSummaryEntry only returns supported book summary presets", () => {
  const entries: ReportEntry[] = [
    {
      id: "entry-plain-report",
      entryType: "research_report",
      title: "普通研究报告",
      state: "ready",
      presetId: null,
      createdAt: "2026-04-13T12:00:00.000Z",
      updatedAt: "2026-04-13T12:00:00.000Z",
    },
    {
      id: "entry-summary",
      entryType: "research_report",
      title: "快速读书总结",
      state: "ready",
      presetId: "builtin-quick-read",
      createdAt: "2026-04-13T10:00:00.000Z",
      updatedAt: "2026-04-13T10:00:00.000Z",
    },
    {
      id: "entry-deep-reading",
      entryType: "research_report",
      title: "详细解读",
      state: "ready",
      presetId: "builtin-deep-reading",
      createdAt: "2026-04-13T11:00:00.000Z",
      updatedAt: "2026-04-13T11:00:00.000Z",
    },
  ];

  assert.equal(getBookSummaryEntry(entries)?.id, "entry-deep-reading");
  assert.equal(getBookSummaryEntry(entries.slice(0, 1)), null);
});

test("getBookSummaries returns quick-read and deep-reading reports newest first", () => {
  const entries: ReportEntry[] = [
    {
      id: "entry-older",
      entryType: "research_report",
      title: "较早总结",
      state: "ready",
      presetId: "builtin-quick-read",
      createdAt: "2026-04-13T09:00:00.000Z",
      updatedAt: "2026-04-13T09:00:00.000Z",
    },
    {
      id: "entry-ignore",
      entryType: "research_report",
      title: "普通研究报告",
      state: "ready",
      presetId: null,
      createdAt: "2026-04-13T12:00:00.000Z",
      updatedAt: "2026-04-13T12:00:00.000Z",
    },
    {
      id: "entry-latest",
      entryType: "research_report",
      title: "最新详细解读",
      state: "ready",
      presetId: "builtin-deep-reading",
      createdAt: "2026-04-13T11:00:00.000Z",
      updatedAt: "2026-04-13T11:00:00.000Z",
    },
  ];

  assert.deepEqual(getBookSummaries(entries).map((entry) => entry.id), ["entry-latest", "entry-older"]);
});

test("getBookCenterTabIndicatorClass keeps markup decorative-only after moving underline to button edge", () => {
  assert.match(getBookCenterTabIndicatorClass(true), /sr-only/);
  assert.equal(getBookCenterTabIndicatorClass(false), getBookCenterTabIndicatorClass(true));
  assert.doesNotMatch(getBookCenterTabIndicatorClass(true), /当前标签/);
});

test("getBookCenterTabButtonClass uses a stable bottom border for the active underline", () => {
  assert.match(getBookCenterTabButtonClass(true), /relative/);
  assert.match(getBookCenterTabButtonClass(true), /border-b-2/);
  assert.match(getBookCenterTabButtonClass(true), /border-\[#3a2e20\]/);
  assert.match(getBookCenterTabButtonClass(false), /border-transparent/);
});
