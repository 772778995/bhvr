import type { ReportEntry } from "@/api/notebooks";

export type ReportDetailContentRequest =
  | { kind: "skip" }
  | { kind: "inline"; content: string }
  | { kind: "cache"; content: string }
  | { kind: "remote"; load: () => Promise<string> };

export function isBookMindmapReportEntry(entry?: ReportEntry | null): boolean {
  return entry?.entryType === "research_report" && entry?.presetId === "builtin-book-mindmap";
}

export function resolveReportDetailContentRequest(
  entry: ReportEntry | undefined,
  cache: Map<string, string>,
  fetchEntryContent: (fileUrl: string) => Promise<string>,
): ReportDetailContentRequest {
  if (!entry) {
    return { kind: "skip" };
  }

  const isResearchReport = entry.entryType === "research_report";
  const isReportArtifact = entry.entryType === "artifact" && entry.artifactType === "report";
  if (!isResearchReport && !isReportArtifact) {
    return { kind: "skip" };
  }

  if (isBookMindmapReportEntry(entry)) {
    return { kind: "skip" };
  }

  if (isResearchReport && typeof entry.content === "string" && entry.content) {
    return { kind: "inline", content: entry.content };
  }

  if (isReportArtifact && !entry.fileUrl) {
    const inlineContent = entry.contentJson?.content;
    if (typeof inlineContent === "string" && inlineContent) {
      return { kind: "inline", content: inlineContent };
    }
    return { kind: "skip" };
  }

  const cached = cache.get(entry.id);
  if (cached) {
    return { kind: "cache", content: cached };
  }

  if (!entry.fileUrl) {
    return { kind: "skip" };
  }

  return {
    kind: "remote",
    load: async () => {
      const text = await fetchEntryContent(entry.fileUrl!);
      cache.set(entry.id, text);
      return text;
    },
  };
}

export function shouldRenderResearchReportMarkdown(
  entry: ReportEntry | undefined,
  fetchedContent: string | null | undefined,
): boolean {
  return !isBookMindmapReportEntry(entry) && typeof fetchedContent === "string" && fetchedContent.length > 0;
}
