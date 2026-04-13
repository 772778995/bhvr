import type { ResearchState } from "@/api/notebooks";

export function getResearchPrimaryActionLabel(researchState: ResearchState): string {
  return researchState.status === "running" ? "停止自动研究" : "开始自动研究";
}

export function getQuickReadActionLabel(options: { loading: boolean; hasSummary: boolean }): string {
  if (options.loading) {
    return "整理中...";
  }

  return options.hasSummary ? "重新生成" : "快速读书";
}

export function getResearchStatusCopy(researchState: ResearchState): string {
  if (researchState.status === "failed") {
    return researchState.lastError
      ? `自动研究失败：${researchState.lastError}`
      : "自动研究失败，请稍后重试。";
  }

  if (researchState.status === "completed") {
    return `自动研究已完成，共整理 ${researchState.completedCount} 个问题。`;
  }

  if (researchState.status === "running") {
    return `正在围绕当前书籍自动研究，已完成 ${researchState.completedCount} / ${researchState.targetCount || "?"}。`;
  }

  return "围绕当前书籍自动生成问题并逐步整理回答，适合先快速摸清一本书的结构和重点。";
}
