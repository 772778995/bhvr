import {
  getBookChatAssistantBubbleClass,
  getBookChatPrimaryButtonClass,
  getBookChatTextareaClass,
  getBookChatUserBubbleClass,
} from "./book-chat";

export function shouldSubmitBookFinderKeydown(event: Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing">): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

export function getBookFinderUserBubbleClass(): string {
  return getBookChatUserBubbleClass();
}

export function getBookFinderAssistantBubbleClass(): string {
  return getBookChatAssistantBubbleClass();
}

export function getBookFinderTextareaClass(): string {
  return getBookChatTextareaClass();
}

export function getBookFinderSubmitButtonClass(): string {
  return getBookChatPrimaryButtonClass();
}
