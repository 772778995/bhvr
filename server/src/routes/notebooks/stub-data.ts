export type NotebookStub = {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
};

export type NotebookSourceStub = {
  id: string;
  title: string;
  type: "pdf" | "web" | "text";
  status: "ready" | "processing";
  summary: string;
};

export type ChatMessageStub = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: "sent" | "streaming" | "done";
};

export type StudioToolStub = {
  id: string;
  name: string;
  description: string;
  available: boolean;
};

export type ResearchEntryStub = {
  id: string;
  name: string;
  status: "idle" | "running" | "done";
  message: string;
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
    description: `Stub notebook workspace for ${id.slice(0, 8) || "unknown"} (${(h % 97) + 1})`,
    updatedAt: isoFromOffsetMinutes((h % 1440) + 60),
  };
}

export function buildNotebookSourcesStub(id: string): NotebookSourceStub[] {
  const h = hashText(id);
  const count = (h % 3) + 2;
  const types: Array<NotebookSourceStub["type"]> = ["pdf", "web", "text"];

  return Array.from({ length: count }, (_, index) => ({
    id: `${id}-source-${index + 1}`,
    title: `Source ${index + 1} for ${id.slice(0, 6) || "notebook"}`,
    type: types[(h + index) % types.length] ?? "text",
    status: (h + index) % 2 === 0 ? "ready" : "processing",
    summary: `Summary ${index + 1}: deterministic source snippet for ${id.slice(0, 6) || "notebook"}`,
  }));
}

export function buildChatMessagesStub(id: string): ChatMessageStub[] {
  const h = hashText(id);
  const count = (h % 4) + 2;

  return Array.from({ length: count }, (_, index) => {
    const isUser = index % 2 === 0;
    return {
      id: `${id}-message-${index + 1}`,
      role: isUser ? "user" : "assistant",
      content: isUser
        ? `Question ${index + 1} about notebook ${id.slice(0, 6) || "n/a"}`
        : `Stub answer ${index + 1} generated for notebook ${id.slice(0, 6) || "n/a"}`,
      createdAt: isoFromOffsetMinutes((h % 720) + index * 5 + 120),
      status: isUser ? "sent" : index === count - 1 ? "streaming" : "done",
    };
  });
}

export function buildStudioToolsStub(id: string): StudioToolStub[] {
  const h = hashText(id);
  const tools: Array<Pick<StudioToolStub, "id" | "name" | "description">> = [
    {
      id: "audio-overview",
      name: "Audio Overview",
      description: "Generate a podcast-style conversation from your sources.",
    },
    {
      id: "study-guide",
      name: "Study Guide",
      description: "Create a concise study guide with key takeaways.",
    },
    {
      id: "faq",
      name: "FAQ",
      description: "Produce frequently asked questions and direct answers.",
    },
    {
      id: "timeline",
      name: "Timeline",
      description: "Organize major events and milestones chronologically.",
    },
    {
      id: "briefing-doc",
      name: "Briefing Doc",
      description: "Summarize the topic into an executive briefing format.",
    },
    {
      id: "mind-map",
      name: "Mind Map",
      description: "Map concepts and relationships into a visual structure.",
    },
  ];

  return tools.map((tool, index) => ({
    ...tool,
    available: (h + index) % 2 === 0,
  }));
}

export function buildResearchStub(id: string): ResearchEntryStub {
  const h = hashText(id);
  const totalSteps = (h % 6) + 2;
  const completedSteps = h % (totalSteps + 1);
  const status: ResearchEntryStub["status"] =
    completedSteps === 0 ? "idle" : completedSteps === totalSteps ? "done" : "running";

  const message =
    status === "idle"
      ? "Research has not started."
      : status === "running"
        ? `Research in progress (${completedSteps}/${totalSteps}).`
        : `Research complete (${completedSteps}/${totalSteps}).`;

  return {
    id: `${id}-research`,
    name: `Research ${id.slice(0, 8) || "notebook"}`,
    status,
    message,
  };
}
