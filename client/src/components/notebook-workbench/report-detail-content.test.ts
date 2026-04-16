import assert from "node:assert/strict";
import test from "node:test";
import type { ReportEntry } from "@/api/notebooks";
import {
  resolveReportDetailContentRequest,
  shouldRenderResearchReportMarkdown,
} from "./report-detail-content";

function createReportEntry(overrides: Partial<ReportEntry> = {}): ReportEntry {
  return {
    id: "entry-1",
    entryType: "research_report",
    title: "书籍导图",
    state: "ready",
    content: null,
    errorMessage: null,
    presetId: null,
    artifactId: null,
    artifactType: null,
    contentJson: null,
    fileUrl: "/api/files/report-entry-1.md",
    createdAt: "2026-04-15T06:00:00.000Z",
    updatedAt: "2026-04-15T06:00:00.000Z",
    ...overrides,
  };
}

test("resolveReportDetailContentRequest skips markdown loading for builtin book mindmap reports", () => {
  let fetchCalls = 0;
  const cache = new Map<string, string>();
  const entry = createReportEntry({
    presetId: "builtin-book-mindmap",
    contentJson: {
      kind: "mermaid_mindmap",
      version: 1,
      code: "mindmap\n  root((深度参与))",
    },
  });

  const request = resolveReportDetailContentRequest(entry, cache, async (_fileUrl: string) => {
    fetchCalls += 1;
    return "# markdown fallback";
  });

  assert.equal(request.kind, "skip");
  assert.equal(fetchCalls, 0);
  assert.equal(shouldRenderResearchReportMarkdown(entry, "# markdown fallback"), false);
});

test("resolveReportDetailContentRequest fetches and caches markdown for normal research reports", async () => {
  let fetchCalls = 0;
  const cache = new Map<string, string>();
  const entry = createReportEntry({
    id: "entry-2",
    title: "书籍简述",
    presetId: "builtin-quick-read",
    fileUrl: "/api/files/report-entry-2.md",
  });

  const request = resolveReportDetailContentRequest(entry, cache, async (fileUrl: string) => {
    fetchCalls += 1;
    assert.equal(fileUrl, "/api/files/report-entry-2.md");
    return "# 书籍简述";
  });

  assert.equal(request.kind, "remote");
  if (request.kind !== "remote") {
    assert.fail("expected a remote markdown load request");
  }

  const content = await request.load();
  assert.equal(content, "# 书籍简述");
  assert.equal(fetchCalls, 1);
  assert.equal(cache.get(entry.id), "# 书籍简述");
  assert.equal(shouldRenderResearchReportMarkdown(entry, content), true);
});
