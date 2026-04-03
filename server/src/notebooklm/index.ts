export {
  askNotebook,
  listNotebooks,
  extractNotebookId,
  getAuthStatus,
  disposeClient,
  // New gateway methods
  getNotebookDetail,
  getNotebookSources,
  getNotebookMessages,
  askNotebookForResearch,
  ensureNotebookAccessible,
  // Types
  type AuthStatus,
  type AskResult,
  type NotebookDetail,
  type NotebookSource,
  type NotebookMessage,
  type NotebookMessagesResult,
  type ResearchAskResult,
  type AccessCheckResult,
} from "./client.js";
