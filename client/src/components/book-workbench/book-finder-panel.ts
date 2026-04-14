export function shouldSubmitBookFinderKeydown(event: Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing">): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

export function getBookFinderUserBubbleClass(): string {
  return "inline-block shrink-0 max-w-[75%] whitespace-pre-wrap overflow-wrap-anywhere break-words rounded-2xl rounded-tr-sm bg-[#3a2e20] text-[#f5ede0]";
}

export function getBookFinderAssistantBubbleClass(): string {
  return "rounded-2xl rounded-tl-sm border border-[#e0d5c0] bg-[#fffaf2] text-[#2f271f]";
}
