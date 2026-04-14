import type { ReportEntry } from "@/api/notebooks";

const HISTORY_TAB = { key: "history", label: "课题研究历史" } as const;
const BOOK_FINDER_TAB = { key: "book-finder", label: "快速找书" } as const;
const SUMMARY_TAB = { key: "summary", label: "书籍总结" } as const;

export function getBookCenterTabs(hasSummary: boolean) {
  void hasSummary;
  return [HISTORY_TAB, BOOK_FINDER_TAB, SUMMARY_TAB];
}

export function getBookCenterTabButtonClass(active: boolean): string {
  const base = "relative flex-1 border-b-2 px-3 py-2.5 text-base transition-colors duration-100";

  if (active) {
    return `${base} border-[#3a2e20] text-[#2f271f]`;
  }

  return `${base} border-transparent text-[#8f7f6e] hover:text-[#665746]`;
}

export function getBookCenterTabIndicatorClass(active: boolean): string {
  void active;
  return "sr-only";
}

export function getBookSummaries(entries: ReportEntry[]): ReportEntry[] {
  return entries
    .filter((entry) => entry.entryType === "research_report" && entry.presetId === "builtin-quick-read")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getBookSummaryEntry(entries: ReportEntry[]): ReportEntry | null {
  return getBookSummaries(entries)[0] ?? null;
}
