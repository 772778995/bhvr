import { createRequire } from "node:module";

type PDFParseCtor = new (options: { data: Buffer }) => {
  getText: () => Promise<{ text: string }>;
  destroy: () => Promise<void>;
};

function loadPdfParse(): PDFParseCtor {
  const require = createRequire(import.meta.url);
  const mod = require("pdf-parse") as { PDFParse: PDFParseCtor };
  return mod.PDFParse;
}

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
  const PDFParse = loadPdfParse();
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return normalizeExtractedPdfText(result.text);
  } finally {
    await parser.destroy();
  }
}
