export type NotebookStub = {
  id: string;
  title: string;
  topic: string;
  sourceCount: number;
  messageCount: number;
  updatedAt: string;
};

export type NotebookSourceStub = {
  id: string;
  notebookId: string;
  title: string;
  type: "pdf" | "web" | "text";
  status: "ready" | "processing";
};

export type ChatMessageStub = {
  id: string;
  notebookId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type StudioToolStub = {
  id: string;
  label: string;
  enabled: boolean;
};

export type NotebookResearchStub = {
  notebookId: string;
  status: "idle" | "running" | "done";
  totalQuestions: number;
  answeredQuestions: number;
};

function hashText(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2147483647;
  }
  return hash;
}

function isoFromOffsetMinutes(offsetMinutes: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, offsetMinutes, 0)).toISOString();
}

export function buildNotebookStub(id: string): NotebookStub {
  const h = hashText(id);
  return {
    id,
    title: `Notebook ${id.slice(0, 8) || "unknown"}`,
    topic: `Topic-${h % 97}`,
    sourceCount: (h % 6) + 1,
    messageCount: (h % 21) + 3,
    updatedAt: isoFromOffsetMinutes((h % 1440) + 60),
  };
}

export function buildNotebookSourcesStub(id: string): NotebookSourceStub[] {
  const h = hashText(id);
  const count = (h % 3) + 2;
  const types: Array<NotebookSourceStub["type"]> = ["pdf", "web", "text"];

  return Array.from({ length: count }, (_, index) => ({
    id: `${id}-source-${index + 1}`,
    notebookId: id,
    title: `Source ${index + 1} for ${id.slice(0, 6) || "notebook"}`,
    type: types[(h + index) % types.length] ?? "text",
    status: (h + index) % 2 === 0 ? "ready" : "processing",
  }));
}

export function buildChatMessagesStub(id: string): ChatMessageStub[] {
  const h = hashText(id);
  const count = (h % 4) + 2;

  return Array.from({ length: count }, (_, index) => {
    const isUser = index % 2 === 0;
    return {
      id: `${id}-message-${index + 1}`,
      notebookId: id,
      role: isUser ? "user" : "assistant",
      content: isUser
        ? `Question ${index + 1} about notebook ${id.slice(0, 6) || "n/a"}`
        : `Stub answer ${index + 1} generated for notebook ${id.slice(0, 6) || "n/a"}`,
      createdAt: isoFromOffsetMinutes((h % 720) + index * 5 + 120),
    };
  });
}

export function buildStudioToolsStub(id: string): StudioToolStub[] {
  const h = hashText(id);
  const toolIds = ["audio-overview", "mindmap", "timeline", "quiz"];

  return toolIds.map((toolId, index) => ({
    id: toolId,
    label: toolId,
    enabled: (h + index) % 2 === 0,
  }));
}

export function buildResearchStub(id: string): NotebookResearchStub {
  const h = hashText(id);
  const totalQuestions = (h % 8) + 3;
  const answeredQuestions = h % (totalQuestions + 1);
  const status: NotebookResearchStub["status"] =
    answeredQuestions === 0
      ? "idle"
      : answeredQuestions === totalQuestions
        ? "done"
        : "running";

  return {
    notebookId: id,
    status,
    totalQuestions,
    answeredQuestions,
  };
}
