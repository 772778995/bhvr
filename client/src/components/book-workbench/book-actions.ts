export type BookActionKind = "quick-read" | "deep-reading";

export function getBookActionLabel(kind: BookActionKind, loading: boolean): string {
  if (kind === "deep-reading") {
    return loading ? "解读中..." : "详细解读";
  }

  return loading ? "整理中..." : "快速读书";
}
