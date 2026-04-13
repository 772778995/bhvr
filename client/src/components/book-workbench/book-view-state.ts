import type { ChatMessage, ResearchState } from "@/api/notebooks";

interface BookSummaryAvailabilityOptions {
  generating: boolean;
  messages: ChatMessage[];
  researchState: ResearchState;
}

export function canGenerateBookSummary(options: BookSummaryAvailabilityOptions): boolean {
  if (options.generating) {
    return false;
  }

  return options.messages.length > 0 || options.researchState.completedCount > 0;
}
