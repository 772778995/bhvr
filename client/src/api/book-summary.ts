import { notebooksApi } from "./notebooks";

export function generateBookSummary(notebookId: string) {
  return notebooksApi.generateReport(notebookId, "builtin-quick-read");
}
