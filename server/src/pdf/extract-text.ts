import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { definePDFJSModule, extractText, getDocumentProxy } from "unpdf";

// Use pdfjs-dist/legacy for Node.js: includes NodeBinaryDataFactory which
// reads CMap files from the filesystem (needed for CJK/Chinese PDFs).
// The serverless bundle bundled in unpdf does not support file:// CMap loading.
let pdfJsInitialized: Promise<void> | null = null;
function ensurePdfJs(): Promise<void> {
  if (!pdfJsInitialized) {
    pdfJsInitialized = definePDFJSModule(
      () => import("pdfjs-dist/legacy/build/pdf.mjs"),
    ).catch(() => {
      // Fall back to the bundled serverless build if pdfjs-dist is not installed
      pdfJsInitialized = null;
    });
  }
  return pdfJsInitialized!;
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

function getCMapPath(): string | undefined {
  try {
    // Must be a plain filesystem path (with trailing slash), NOT a file:// URL.
    // pdfjs-dist NodeBinaryDataFactory calls fs.readFile(url) where url is a
    // string — Node.js fs.readFile does NOT accept "file:///..." strings,
    // only real paths or URL objects.
    const pkgJson = fileURLToPath(
      import.meta.resolve("pdfjs-dist/package.json"),
    );
    return join(pkgJson, "../cmaps") + "/";
  } catch {
    return undefined;
  }
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  await ensurePdfJs();
  const cMapUrl = getCMapPath();
  const pdf = await getDocumentProxy(new Uint8Array(buffer), {
    ...(cMapUrl ? { cMapUrl, cMapPacked: true } : {}),
  });
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
