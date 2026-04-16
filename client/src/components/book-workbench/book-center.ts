import type { ReportEntry } from "@/api/notebooks";

const BOOK_SUMMARY_PRESET_IDS = new Set(["builtin-quick-read", "builtin-deep-reading", "builtin-book-mindmap"]);

const CHAT_TAB = { key: "chat", label: "读书互动" } as const;
const SUMMARY_TAB = { key: "summary", label: "快速读书" } as const;
const BOOK_FINDER_TAB = { key: "book-finder", label: "快速找书" } as const;

export function getBookCenterTabs(hasSummary: boolean) {
  void hasSummary;
  return [CHAT_TAB, SUMMARY_TAB, BOOK_FINDER_TAB];
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
    .filter((entry) => entry.entryType === "research_report" && BOOK_SUMMARY_PRESET_IDS.has(entry.presetId ?? ""))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getBookSummaryEntry(entries: ReportEntry[]): ReportEntry | null {
  return getBookSummaries(entries)[0] ?? null;
}
