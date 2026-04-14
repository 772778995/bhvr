import type { ChatMessage, ResearchState } from "@/api/notebooks";

interface BookWorkbenchHeaderStateOptions {
  notebookTitle?: string | null;
  navigate?: (path: string) => void;
}

const DEFAULT_BOOK_RESEARCH_TARGET_COUNT = 20;

export function createNotebookListPath(): string {
  return "/";
}

export function createBookWorkbenchHeaderState(options: BookWorkbenchHeaderStateOptions = {}) {
  const title = options.notebookTitle?.trim() || "Book 工作台";
  const navigate = options.navigate ?? (() => {});

  function goBack() {
    navigate(createNotebookListPath());
  }

  return {
    title,
    goBack,
  };
}

export function createStartingResearchState(previousState: ResearchState): ResearchState {
  const { lastError: _lastError, ...rest } = previousState;

  return {
    ...rest,
    status: "running",
    step: "starting",
    completedCount: 0,
    targetCount: DEFAULT_BOOK_RESEARCH_TARGET_COUNT,
  };
}

export function createBookFinderIntroCopy() {
  return {
    title: "您好，我是锐读，请输入您要找的书籍内容或类别",
    description: "我会先用大模型压缩检索意图，再只从公开书目数据源里整理可核验的候选结果。未核验的平台信息不会硬编。",
  };
}

export function createBookFinderDisplayMessages(messages: ChatMessage[]): ChatMessage[] {
  const intro = createBookFinderIntroCopy();
  const welcomeMessage: ChatMessage = {
    id: "book-finder-welcome",
    role: "assistant",
    content: `${intro.title}\n\n${intro.description}`,
    createdAt: "",
    status: "done",
  };

  const filtered: ChatMessage[] = [];

  for (const [index, message] of messages.entries()) {
    if (message.role === "assistant" && isBookFinderAssistantMessage(message.content)) {
      const previousMessage = messages[index - 1];
      if (previousMessage?.role === "user" && filtered.at(-1)?.id !== previousMessage.id) {
        filtered.push(previousMessage);
      }
      filtered.push(message);
      continue;
    }

    if (message.id.startsWith("book-finder-user:")) {
      filtered.push(message);
    }
  }

  return [welcomeMessage, ...filtered];
}

function isBookFinderAssistantMessage(content: string): boolean {
  const normalized = content.trim();
  return normalized.startsWith("# 快速找书结果")
    || normalized.includes("- 线上平台与评分：")
    || normalized.includes("- 微信读书：")
    || normalized.includes("当前没有从公开书目数据源检索到足够可靠的结果");
}

export function createBookFinderDraftPlaceholder(): string {
  return "输入书籍关键词或类别，例如：组织管理、品牌营销、心理学入门";
}

function createClientMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createOptimisticBookFinderUserMessage(content: string): ChatMessage {
  return {
    id: `book-finder-user:${createClientMessageId()}`,
    role: "user",
    content: content.trim(),
    createdAt: new Date().toISOString(),
    status: "done",
  };
}
