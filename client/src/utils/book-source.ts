import type { Source } from "@/api/notebooks";

export function getCurrentBookSource(sources: Source[]): Source | null {
  if (sources.length === 0) {
    return null;
  }

  return sources.find((source) => source.type === "pdf") ?? sources[0] ?? null;
}
