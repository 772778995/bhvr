import type { ChatMessage, ResearchState } from "@/api/notebooks";

export const DEFAULT_BOOK_RESEARCH_TARGET_COUNT = 20;

export type ResearchActionPendingState = "starting" | "stopping" | null;

export function countResearchAnsweredRounds(messages: ChatMessage[]): number {
  let userCount = 0;
  let assistantCount = 0;

  for (const message of messages) {
    if (message.role === "user") {
      userCount += 1;
      continue;
    }

    if (message.role === "assistant") {
      assistantCount += 1;
    }
  }

  return Math.min(userCount, assistantCount);
}

export function getResearchPrimaryActionLabel(
  researchState: ResearchState,
  pendingState: ResearchActionPendingState = null,
): string {
  if (pendingState === "starting") {
    return "启动中...";
  }

  if (pendingState === "stopping") {
    return "停止中...";
  }

  return researchState.status === "running" ? "停止自动研究" : "开始自动研究";
}

export function getQuickReadActionLabel(loading: boolean): string {
  if (loading) {
    return "整理中...";
  }

  return "快速读书";
}

export function getResearchRoundsCopy(answeredRounds: number): string {
  return `当前共 ${answeredRounds} 轮问答`;
}

export function getResearchProgressCopy(researchState: ResearchState): string | null {
  if (researchState.status === "idle") {
    return null;
  }

  const target = researchState.targetCount > 0
    ? researchState.targetCount
    : DEFAULT_BOOK_RESEARCH_TARGET_COUNT;

  return `${researchState.completedCount} / ${target}`;
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
    return "正在围绕当前书籍自动研究，新的问题与回答会陆续写入中栏历史。";
  }

  return "围绕当前书籍自动生成问题并逐步整理回答，适合先快速摸清一本书的结构和重点。";
}
