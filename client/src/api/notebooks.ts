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
  summary: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: string;
}

export interface StudioTool {
  id: string;
  name: string;
  description: string;
  available: boolean;
}

export interface ResearchEntry {
  id: string;
  name: string;
  status: string;
  message: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  }

  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) {
    throw new Error(body.message ?? "请求失败");
  }

  return body.data;
}

export const notebooksApi = {
  getNotebook(id: string) {
    return request<Notebook>(`/api/notebooks/${id}`);
  },

  getSources(id: string) {
    return request<Source[]>(`/api/notebooks/${id}/sources`);
  },

  getMessages(id: string) {
    return request<ChatMessage[]>(`/api/notebooks/${id}/chat/messages`);
  },

  getStudioTools(id: string) {
    return request<StudioTool[]>(`/api/notebooks/${id}/studio/tools`);
  },

  getResearchEntry(id: string) {
    return request<ResearchEntry>(`/api/notebooks/${id}/research`);
  },
};
