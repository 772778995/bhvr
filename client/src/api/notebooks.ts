export interface Notebook {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
}

export interface Source {
  id: string;
  title: string;
  type: string;
  status: string;
  url?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: string;
}

export type ResearchStatus = "idle" | "running" | "failed" | "completed" | "stopped";

/**
 * Granular step within a running research loop, aligned with server ResearchStep.
 */
export type ResearchStep =
  | "idle"
  | "starting"
  | "generating_question"
  | "waiting_answer"
  | "refreshing_messages"
  | "completed"
  | "failed";

/** Runtime state of auto-research for a notebook (mirrors ResearchRuntimeState). */
export interface ResearchState {
  status: ResearchStatus;
  step: ResearchStep;
  completedCount: number;
  targetCount: number;
  lastError?: string;
}

/** Start-research request body. */
export interface StartResearchRequest {
  topic?: string;
  numQuestions?: number;
}

/** Start-research response. */
export interface StartResearchResponse {
  message: string;
  status: string;
}

/** Generate-report response. */
export interface GenerateReportResponse {
  message: string;
}

export interface SourceAddResponse {
  sourceIds: string[];
  wasChunked: boolean;
}

export interface SourceSearchResponse {
  sessionId: string;
  web: Array<{ url: string; title: string; id?: string; type?: string }>;
  drive: Array<{ fileId: string; mimeType: string; title: string; id?: string }>;
}

export interface SourceProcessingStatus {
  allReady: boolean;
  processing: string[];
}

export interface SendMessageHistoryItem {
  role: "user" | "assistant";
  message: string;
}

export interface SendMessageRequest {
  content: string;
  conversationId?: string;
  conversationHistory?: SendMessageHistoryItem[];
}

export interface SendMessageResponse {
  conversationId: string | null;
  message: ChatMessage;
  messageIds?: [string, string];
}

export interface BookFinderResponse {
  normalizedQuery: string;
  message: ChatMessage;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface RequestOptions extends RequestInit {
  /** Called when the backend returns success:true but also includes a warning message. */
  onWarning?: (message: string) => void;
}

async function request<T>(url: string, options?: RequestOptions): Promise<T> {
  const { onWarning, ...fetchOptions } = options ?? {};
  const headers: Record<string, string> = { ...(fetchOptions.headers as Record<string, string>) };
  const method = fetchOptions.method?.toUpperCase() ?? "GET";
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    headers["Content-Type"] ??= "application/json";
  }

  const res = await fetch(url, { ...fetchOptions, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  }

  // 204 No Content — nothing to parse
  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json() as ApiResponse<T> | T;
  if (typeof body === "object" && body !== null && "success" in body) {
    const typed = body as ApiResponse<T>;
    if (!typed.success) {
      throw new Error(typed.message ?? "请求失败");
    }
    if (typed.message && onWarning) {
      onWarning(typed.message);
    }
    return typed.data;
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Artifact types
// ---------------------------------------------------------------------------

export const ArtifactType = {
  UNKNOWN: 0,
  REPORT: 1,
  QUIZ: 5,
  FLASHCARDS: 6,
  MIND_MAP: 7,
  INFOGRAPHIC: 8,
  SLIDE_DECK: 9,
  AUDIO: 10,
  VIDEO: 11,
} as const;

export type ArtifactTypeValue = (typeof ArtifactType)[keyof typeof ArtifactType];

export const ArtifactState = {
  UNKNOWN: 0,
  CREATING: 1,
  READY: 2,
  FAILED: 3,
} as const;

export type ArtifactStateValue = (typeof ArtifactState)[keyof typeof ArtifactState];

/** Quiz question as returned by the SDK. */
export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
  hint?: string;
}

/** Flashcard pair as returned by the SDK. */
export interface FlashcardPair {
  question: string;
  answer: string;
}

export interface Artifact {
  artifactId: string;
  type: ArtifactTypeValue;
  state: ArtifactStateValue;
  title?: string;
  createdAt?: string;
  /** Download/stream URL for file-backed artifacts when available. */
  fileUrl?: string | null;
  // ── Rich content fields (present when state === READY) ──
  /** Base64-encoded MP3 audio data (AUDIO type). */
  audioData?: string;
  /** Audio duration in seconds (AUDIO type). */
  duration?: number;
  /** Report text content in Markdown (REPORT type). */
  content?: string;
  /** Quiz questions (QUIZ type). */
  questions?: QuizQuestion[];
  /** Total question count (QUIZ type). */
  totalQuestions?: number;
  /** Parsed flashcard pairs (FLASHCARDS type). */
  flashcards?: FlashcardPair[];
  /** Raw CSV string (FLASHCARDS type). */
  csv?: string;
}

export interface CreateArtifactResponse {
  artifactId: string;
  state: string;
}

/**
 * Unified entry returned by GET /api/notebooks/:id/entries.
 * Covers both locally-generated research reports and Studio artifacts.
 */
export interface ReportEntry {
  id: string;
  entryType: "research_report" | "artifact";
  title: string | null;
  state: "creating" | "ready" | "failed";
  /** Markdown content — research_report only */
  content?: string | null;
  errorMessage?: string | null;
  presetId?: string | null;
  /** NotebookLM SDK artifact ID — artifact only */
  artifactId?: string | null;
  /** SDK artifact type string — artifact only */
  artifactType?: string | null;
  /** Small structured content (quiz questions, flashcards, etc.) — artifact only */
  contentJson?: Record<string, unknown> | null;
  /** Absolute URL to download/stream the file (audio, PDF) — artifact only */
  fileUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const notebooksApi = {
  getNotebooks() {
    return request<Notebook[]>("/api/notebooks");
  },

  createNotebook(body: { title: string }) {
    return request<Notebook>("/api/notebooks", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  deleteNotebook(id: string) {
    return request<{ id: string }>(`/api/notebooks/${id}`, {
      method: "DELETE",
    });
  },

  getNotebook(id: string) {
    return request<Notebook>(`/api/notebooks/${id}`);
  },

  getSources(id: string) {
    return request<Source[]>(`/api/notebooks/${id}/sources`);
  },

  addSourceFromUrl(id: string, body: { url: string; title?: string }) {
    return request<SourceAddResponse>(`/api/notebooks/${id}/sources/add/url`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  addSourceFromText(id: string, body: { title: string; content: string }) {
    return request<SourceAddResponse>(`/api/notebooks/${id}/sources/add/text`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  addSourceFromFile(id: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    return request<SourceAddResponse>(`/api/notebooks/${id}/sources/add/file`, {
      method: "POST",
      body: formData,
      headers: {},
    });
  },

  searchSources(id: string, body: { query: string; sourceType: "web" | "drive"; mode: "fast" | "deep" }) {
    return request<SourceSearchResponse>(`/api/notebooks/${id}/sources/add/search`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  addDiscoveredSources(
    id: string,
    body: {
      sessionId: string;
      webSources?: Array<{ title: string; url: string }>;
      driveSources?: Array<{ fileId: string; title: string; mimeType: string }>;
    }
  ) {
    return request<{ sourceIds: string[] }>(`/api/notebooks/${id}/sources/add/discovered`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getSourceProcessingStatus(id: string) {
    return request<SourceProcessingStatus>(`/api/notebooks/${id}/sources/status`);
  },

  deleteSource(notebookId: string, sourceId: string) {
    return request<void>(`/api/notebooks/${notebookId}/sources/${sourceId}`, {
      method: "DELETE",
    });
  },

  /** Chat messages for a notebook. */
  getMessages(id: string) {
    return request<ChatMessage[]>(`/api/notebooks/${id}/messages`);
  },

  getChatMessages(id: string) {
    return request<ChatMessage[]>(`/api/notebooks/${id}/chat/messages`);
  },

  getBookFinderMessages(id: string) {
    return request<ChatMessage[]>(`/api/notebooks/${id}/book-finder/messages`);
  },

  sendMessage(id: string, body: SendMessageRequest) {
    return request<SendMessageResponse>(`/api/notebooks/${id}/chat/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  searchBooks(id: string, body: { query: string }) {
    return request<BookFinderResponse>(`/api/notebooks/${id}/book-finder/search`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** Start auto-research for a notebook. */
  startResearch(id: string, body?: StartResearchRequest) {
    return request<StartResearchResponse>(`/api/notebooks/${id}/research/start`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    });
  },

  stopResearch(id: string) {
    return request<StartResearchResponse>(`/api/notebooks/${id}/research/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  /** Trigger report generation from completed Q&A answers. */
  generateReport(id: string, presetId?: string, extraBody?: Record<string, unknown>) {
    return request<GenerateReportResponse>(`/api/notebooks/${id}/report/generate`, {
      method: "POST",
      body: JSON.stringify({ ...(presetId ? { presetId } : {}), ...extraBody }),
    });
  },

  // -------------------------------------------------------------------------
  // Artifacts
  // -------------------------------------------------------------------------

  /** Create an artifact (audio, quiz, flashcards, etc.) for a notebook. */
  createArtifact(id: string, type: string, options?: unknown) {
    return request<CreateArtifactResponse>(`/api/notebooks/${id}/artifacts`, {
      method: "POST",
      body: JSON.stringify({ type, options }),
    });
  },

  /** Get a single artifact by ID. */
  getArtifact(id: string, artifactId: string) {
    return request<Artifact>(`/api/notebooks/${id}/artifacts/${artifactId}`);
  },

  // -------------------------------------------------------------------------
  // Unified entries (research_reports + artifacts merged)
  // -------------------------------------------------------------------------

  /** List all entries (reports + artifacts) for a notebook, newest first. */
  listEntries(id: string) {
    return request<ReportEntry[]>(`/api/notebooks/${id}/entries`);
  },

  /** Delete a unified entry (report or artifact). */
  deleteEntry(id: string, entryId: string) {
    return request<{ id: string }>(`/api/notebooks/${id}/entries/${entryId}`, {
      method: "DELETE",
    });
  },

  /**
   * Fetch raw text content from a file URL (e.g. markdown report).
   *
   * Uses native fetch instead of the request() wrapper because file endpoints
   * return plain text (text/markdown), not the JSON { success, data } envelope
   * that request() expects.
   */
  async fetchEntryContent(fileUrl: string): Promise<string> {
    const res = await fetch(fileUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch file: HTTP ${res.status}`);
    }
    return res.text();
  },
};
