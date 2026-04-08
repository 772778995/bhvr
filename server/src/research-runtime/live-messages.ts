import type { NotebookMessage } from "../notebooklm/client.js";

const liveMessagesMap = new Map<string, NotebookMessage[]>();

function createMessage(role: "user" | "assistant", content: string): NotebookMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    status: "done",
  };
}

export function getLiveMessages(notebookId: string): NotebookMessage[] {
  return [...(liveMessagesMap.get(notebookId) ?? [])];
}

export function appendUserMessage(notebookId: string, content: string): void {
  const current = liveMessagesMap.get(notebookId) ?? [];
  liveMessagesMap.set(notebookId, [...current, createMessage("user", content)]);
}

export function appendAssistantMessage(notebookId: string, content: string): void {
  const current = liveMessagesMap.get(notebookId) ?? [];
  liveMessagesMap.set(notebookId, [...current, createMessage("assistant", content)]);
}

export function clearLiveMessages(notebookId: string): void {
  liveMessagesMap.delete(notebookId);
}
