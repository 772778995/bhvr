export {
  askNotebook,
  listNotebooks,
  extractNotebookId,
  getAuthStatus,
  disposeClient,
  isNotebookAuthError,
  // New gateway methods
  getNotebookDetail,
  getNotebookSources,
  getNotebookMessages,
  askNotebookForResearch,
  ensureNotebookAccessible,
  addSourceFromUrl,
  addSourceFromText,
  addSourceFromFile,
  searchWebSources,
  addDiscoveredSources,
  getSourceProcessingStatus,
  deleteSource,
  sendNotebookChatMessage,
  createNotebook,
  // Artifact operations
  createArtifact,
  getArtifact,
  listArtifacts,
  ArtifactType,
  ArtifactState,
  // Types
  type AuthStatus,
  type AskResult,
  type NotebookDetail,
  type NotebookSource,
  type NotebookMessage,

  type NotebookChatHistoryItem,
  type NotebookChatRequest,
  type NotebookChatResponse,
  type ResearchAskResult,
  type AccessCheckResult,
  type SourceAddResponse,
  type SourceSearchInput,
  type CreateNotebookInput,
  type CreateArtifactResult,
  type Artifact,
  type CreateArtifactOptions,
} from "./client.js";

export {
  DEFAULT_ACCOUNT_ID,
  authManager,
  configureAuthManager,
  createAuthManager,
  type AuthManager,
  type AuthManagerDependencies,
} from "./auth-manager.js";

export {
  getProfilePaths,
  ensureProfileDirectories,
  readAuthMeta,
  writeAuthMeta,
  readStorageState,
  writeStorageState,
  type AuthMeta,
  type AuthState,
} from "./auth-profile.js";

export { loginAccount } from "./login.js";
