import type {
  NotebookChatHistoryItem,
  NotebookChatRequest,
  NotebookChatResponse,
  ResearchAskResult,
} from "../notebooklm/client.js";
import type { AskFn } from "./types.js";
import { appendAssistantMessage, appendUserMessage, clearLiveMessages } from "./live-messages.js";

type SendNotebookChatMessage = (
  notebookId: string,
  request: NotebookChatRequest
) => Promise<NotebookChatResponse>;

export function createNotebookConversationAsker(
  notebookId: string,
  sourceIds: string[],
  sendMessage: SendNotebookChatMessage
): AskFn {
  let conversationId: string | undefined;
  let conversationHistory: NotebookChatHistoryItem[] = [];

  clearLiveMessages(notebookId);

  return async (_targetNotebookId: string, prompt: string): Promise<ResearchAskResult> => {
    try {
      appendUserMessage(notebookId, prompt);

      const response = await sendMessage(notebookId, {
        prompt,
        ...(sourceIds.length > 0 ? { sourceIds } : {}),
        ...(conversationId ? { conversationId } : {}),
        ...(conversationHistory.length > 0 ? { conversationHistory } : {}),
      });

      if (!response.text?.trim()) {
        return { success: false, error: "Empty response from NotebookLM" };
      }

      appendAssistantMessage(notebookId, response.text);
      conversationId = response.conversationId ?? conversationId;
      conversationHistory = [
        ...conversationHistory,
        { role: "user", message: prompt },
        { role: "assistant", message: response.text },
      ];

      return {
        success: true,
        answer: response.text,
        citations: response.citations,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
