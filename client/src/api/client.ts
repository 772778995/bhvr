// API client — typed fetch wrapper for the research backend

export interface ResearchTask {
  id: string;
  notebookUrl: string;
  topic: string | null;
  status: "pending" | "generating_questions" | "asking" | "summarizing" | "done" | "error";
  numQuestions: number;
  completedQuestions: number;
  report: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface Question {
  id: string;
  taskId: string;
  orderNum: number;
  questionText: string;
  answerText: string | null;
  status: "pending" | "asking" | "done" | "error";
  errorMessage: string | null;
  createdAt: string;
}

export interface TaskDetail extends ResearchTask {
  questions: Question[];
}

export interface TaskStatus {
  id: string;
  status: ResearchTask["status"];
  numQuestions: number;
  completedQuestions: number;
  errorMessage: string | null;
  queueLength: number;
  queueRunning: boolean;
}

export interface CreateResearchRequest {
  notebookUrl: string;
  topic?: string;
  numQuestions?: number;
}

export interface CreateResearchResponse {
  id: string;
  status: string;
  message: string;
}

export interface AuthStatus {
  accountId: string;
  status: "missing" | "ready" | "refreshing" | "expired" | "reauth_required" | "error";
  lastCheckedAt?: string;
  lastRefreshedAt?: string;
  error?: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> };
  const method = options?.method?.toUpperCase() ?? "GET";
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    headers["Content-Type"] ??= "application/json";
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  createResearch(data: CreateResearchRequest) {
    return request<CreateResearchResponse>("/api/research", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  listTasks() {
    return request<ResearchTask[]>("/api/research");
  },

  getTask(id: string) {
    return request<TaskDetail>(`/api/research/${id}`);
  },

  getTaskStatus(id: string) {
    return request<TaskStatus>(`/api/research/${id}/status`);
  },

  getAuthStatus() {
    return request<AuthStatus>("/api/auth/status");
  },

  listAccounts() {
    return request<AccountsListResponse>("/api/auth/accounts");
  },

  triggerLogin(accountId: string) {
    return request<{ message: string }>(`/api/auth/accounts/${accountId}/login`, {
      method: "POST",
    });
  },

  deleteAccount(accountId: string) {
    return request<{ message: string }>(`/api/auth/accounts/${accountId}`, {
      method: "DELETE",
    });
  },
};

export interface AccountsListResponse {
  accounts: AuthStatus[];
}
