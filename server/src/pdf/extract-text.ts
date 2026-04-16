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
  const { text } = await extractText(pdf, { mergePages: true });
  return normalizeExtractedPdfText(text);
}
