import type { ReportEntry } from "@/api/notebooks";

export function shouldShowBookSummaryDownload(entry: ReportEntry): boolean {
  if (entry.state !== "ready") {
    return false;
  }

  return Boolean(entry.content || entry.fileUrl);
}

export function getBookSummaryDownloadButtonClass(disabled: boolean): string {
  const base = "inline-flex h-7 w-7 items-center justify-center rounded text-[#6a5b49] transition-colors duration-100";

  if (disabled) {
    return `${base} cursor-not-allowed opacity-40`;
  }

  return `${base} hover:bg-[#efe7d7] active:scale-95`;
}

export async function downloadBookSummaryEntry(
  entry: ReportEntry,
  fetchEntryContent: (fileUrl: string) => Promise<string>,
): Promise<void> {
  const inlineContent = typeof entry.content === "string" && entry.content.trim().length > 0
    ? entry.content
    : null;

  const content = inlineContent ?? (entry.fileUrl ? await fetchEntryContent(entry.fileUrl) : null);
  if (!content) {
    return;
  }

  const filename = `${entry.title || "report"}.md`;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
