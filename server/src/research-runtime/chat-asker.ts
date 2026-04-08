import type {
  NotebookChatHistoryItem,
  NotebookChatRequest,
  NotebookChatResponse,
  ResearchAskResult,
} from "../notebooklm/client.js";
import type { AskFn, ResearchDriver, ResearchDriverAnswerResult, ResearchDriverQuestionResult } from "./types.js";

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

  return async (_targetNotebookId: string, prompt: string): Promise<ResearchAskResult> => {
    try {
      const response = await sendMessage(notebookId, {
        prompt,
        ...(sourceIds.length > 0 ? { sourceIds } : {}),
        ...(conversationId ? { conversationId } : {}),
        ...(conversationHistory.length > 0 ? { conversationHistory } : {}),
      });

      if (!response.text?.trim()) {
        return { success: false, error: "Empty response from NotebookLM" };
      }

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
        conversationId,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

function parsePlannerQuestion(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";

  return firstLine
    .replace(/^[-*•]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^问题[:：]\s*/, "")
    .trim();
}

export function createNotebookResearchDriver(
  notebookId: string,
  sourceIds: string[],
  sendMessage: SendNotebookChatMessage
): ResearchDriver {
  const plannerAsker = createNotebookConversationAsker(notebookId, sourceIds, sendMessage);
  const visibleAsker = createNotebookConversationAsker(notebookId, sourceIds, sendMessage);

  let plannerConversationId: string | undefined;
  let visibleConversationId: string | undefined;

  return {
    async nextQuestion(_targetNotebookId: string): Promise<ResearchDriverQuestionResult> {
      const prompt = [
        "请基于当前资料与此前研究进展，只输出下一个最值得继续追问的研究问题。",
        "要求：",
        "1. 只输出一句具体问题",
        "2. 不要编号",
        "3. 不要解释",
        "4. 不要回答",
      ].join("\n");

      const result = await plannerAsker(notebookId, prompt);
      if (!result.success || !result.answer) {
        return { success: false, error: result.error, plannerConversationId };
      }

      plannerConversationId = result.conversationId ?? plannerConversationId;
      const question = parsePlannerQuestion(result.answer);
      if (!question) {
        return { success: false, error: "NotebookLM 未返回可用的下一问", plannerConversationId };
      }

      return { success: true, question, plannerConversationId };
    },

    async askQuestion(_targetNotebookId: string, question: string): Promise<ResearchDriverAnswerResult> {
      const result = await visibleAsker(notebookId, question);
      if (result.success) {
        visibleConversationId = result.conversationId ?? visibleConversationId;
      }
      return {
        success: result.success,
        answer: result.answer,
        error: result.error,
        conversationId: visibleConversationId,
      };
    },

    getHiddenConversationIds(): string[] {
      return plannerConversationId ? [plannerConversationId] : [];
    },
  };
}
