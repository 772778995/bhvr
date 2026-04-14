export function getBookChatUserBubbleClass(): string {
  return "inline-block shrink-0 max-w-[75%] whitespace-pre-wrap overflow-wrap-anywhere break-words rounded-2xl rounded-tr-sm bg-[#3a2e20] text-left text-[#f5ede0]";
}

export function getBookChatAssistantBubbleClass(): string {
  return "inline-block max-w-[88%] overflow-wrap-anywhere break-words rounded-2xl rounded-tl-sm border border-[#e0d5c0] bg-[#fffaf2] text-left text-[#2f271f]";
}

export function getBookChatTextareaClass(): string {
  return "flex-1 resize-none rounded-md border border-[#d8cfbe] bg-white px-3 py-2.5 text-base text-[#2f271f] transition-colors duration-100 disabled:bg-[#f0e8d8] disabled:text-[#9a8a78]";
}

export function getBookChatPrimaryButtonClass(): string {
  return "rounded-md bg-[#3a2e20] px-3 py-2.5 text-base text-[#f5ede0] transition-all duration-100 hover:bg-[#2f271f] active:scale-95 disabled:cursor-not-allowed disabled:bg-[#b8a99a]";
}
