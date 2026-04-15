import { api, type SummaryPreset } from "./client";
import { notebooksApi } from "./notebooks";

export type BookSummaryPresetId = "builtin-quick-read" | "builtin-deep-reading" | "builtin-book-mindmap";
export type ConfigurableBookSummaryPresetId = "builtin-quick-read" | "builtin-deep-reading";

export function generateBookSummary(notebookId: string, presetId: BookSummaryPresetId = "builtin-quick-read") {
  return notebooksApi.generateReport(notebookId, presetId);
}

export function getBookSummaryPreset(presetId: ConfigurableBookSummaryPresetId): Promise<SummaryPreset> {
  return api.getPreset(presetId);
}

export function updateBookSummaryPreset(
  presetId: ConfigurableBookSummaryPresetId,
  prompt: string,
): Promise<SummaryPreset> {
  return api.updatePreset(presetId, { prompt });
}
