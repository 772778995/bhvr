import type { ReportEntry } from "@/api/notebooks";

const HISTORY_TAB = { key: "history", label: "课题研究历史" } as const;
const SUMMARY_TAB = { key: "summary", label: "书籍总结" } as const;

export function getBookCenterTabs(hasSummary: boolean) {
  return hasSummary ? [HISTORY_TAB, SUMMARY_TAB] : [HISTORY_TAB];
}

export function getBookSummaryEntry(entries: ReportEntry[]): ReportEntry | null {
  const reports = entries
    .filter((entry) => entry.entryType === "research_report" && entry.presetId === "builtin-quick-read")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return reports[0] ?? null;
}
