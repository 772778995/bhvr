import { extractText, getDocumentProxy } from "unpdf";

export function normalizeExtractedPdfText(text: string): string {
  const normalized = text
    .replace(/\f/g, "\n")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\v\u00A0]+/g, " ")
    .replace(/[ \u3000]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    throw new Error("PDF 中未提取到可用文本");
  }

  return normalized;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });

  try {
    return normalizeExtractedPdfText(text);
  } catch {
    if (totalPages > 0) {
      throw new Error(
        `PDF 共 ${totalPages} 页，但未提取到任何文字。该 PDF 可能是扫描件或纯图片，无法直接提取文本。请上传含有文字层的 PDF。`,
      );
    }
    throw new Error("PDF 中未提取到可用文本（文件可能为空或已损坏）");
  }
}
