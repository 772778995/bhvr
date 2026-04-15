import { notebooksApi } from "./notebooks";

export type BookSummaryPresetId = "builtin-quick-read" | "builtin-deep-reading" | "builtin-book-mindmap";

export function generateBookSummary(notebookId: string, presetId: BookSummaryPresetId = "builtin-quick-read") {
  return notebooksApi.generateReport(notebookId, presetId);
}
