export type BookActionKind = "quick-read" | "deep-reading" | "mindmap";

export function getBookActionLabel(kind: BookActionKind, loading: boolean): string {
  if (kind === "deep-reading") {
    return loading ? "解读中..." : "详细解读";
  }

  if (kind === "mindmap") {
    return loading ? "导图生成中..." : "书籍导图";
  }

  return loading ? "整理中..." : "书籍简述";
}
