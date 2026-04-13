import { streamPostSSE, type ProgressEvent, type StreamResult } from "./source-stream";
import type { SourceAddResponse } from "./notebooks";

export function uploadBookSourcePdf(
  notebookId: string,
  file: File,
  onProgress: (event: ProgressEvent) => void,
): Promise<StreamResult<SourceAddResponse>> {
  const formData = new FormData();
  formData.append("file", file);

  return streamPostSSE<SourceAddResponse>(
    `/api/notebooks/${notebookId}/book-source/stream/upload-pdf`,
    formData,
    onProgress,
  );
}
