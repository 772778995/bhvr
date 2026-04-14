import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ChatMessage, ResearchState } from "@/api/notebooks";
import {
  createBookFinderDisplayMessages,
  createBookWorkbenchHeaderState,
  createBookFinderDraftPlaceholder,
  createBookFinderIntroCopy,
  createOptimisticBookFinderUserMessage,
  createNotebookListPath,
  createStartingResearchState,
} from "./book-workbench-view";

function makeState(overrides?: Partial<ResearchState>): ResearchState {
  return {
    status: "idle",
    step: "idle",
    completedCount: 0,
    targetCount: 0,
    ...overrides,
  };
}

test("header state uses notebook title when available", () => {
  const header = createBookWorkbenchHeaderState({
    notebookTitle: "深度参与",
  });

  assert.equal(header.title, "深度参与");
});

test("header state falls back to book workbench label when title is blank", () => {
  const header = createBookWorkbenchHeaderState({
    notebookTitle: "   ",
  });

  assert.equal(header.title, "Book 工作台");
});

test("header state navigates back to notebook list", () => {
  const pushes: string[] = [];
  const header = createBookWorkbenchHeaderState({
    notebookTitle: "研究手稿",
    navigate: (path: string) => {
      pushes.push(path);
    },
  });

  header.goBack();

  assert.deepEqual(pushes, ["/"]);
  assert.equal(createNotebookListPath(), "/");
});

test("createStartingResearchState resets progress immediately for optimistic button feedback", () => {
  assert.deepEqual(
    createStartingResearchState(makeState({ status: "completed", completedCount: 12, targetCount: 12 })),
    {
      status: "running",
      step: "starting",
      completedCount: 0,
      targetCount: 20,
    },
  );
});

test("createBookFinderIntroCopy uses the fixed锐读 greeting", () => {
  assert.equal(
    createBookFinderIntroCopy().title,
    "您好，我是锐读，请输入您要找的书籍内容或类别",
  );
  assert.match(createBookFinderIntroCopy().description, /公开书目数据源/);
  assert.match(createBookFinderDraftPlaceholder(), /书籍关键词或类别/);
});

test("createOptimisticBookFinderUserMessage keeps the manual query visible before refresh", () => {
  const message = createOptimisticBookFinderUserMessage("  组织管理  ");

  assert.equal(message.role, "user");
  assert.equal(message.content, "组织管理");
  assert.equal(message.status, "done");
  assert.match(message.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(message.id, /^book-finder-user:/);
});

test("createOptimisticBookFinderUserMessage falls back when crypto.randomUUID is unavailable", () => {
  const originalCrypto = globalThis.crypto;
  const patchedCrypto = originalCrypto ? { ...originalCrypto, randomUUID: undefined } : undefined;

  try {
    Object.defineProperty(globalThis, "crypto", {
      value: patchedCrypto,
      configurable: true,
    });

    const message = createOptimisticBookFinderUserMessage("心理学入门");

    assert.equal(message.content, "心理学入门");
    assert.match(message.id, /^book-finder-user:/);
    assert.ok(message.id.length > "book-finder-user:".length);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
    });
  }
});

test("createBookFinderDisplayMessages prepends a welcome assistant bubble", () => {
  const displayed = createBookFinderDisplayMessages([]);

  assert.equal(displayed.length, 1);
  assert.equal(displayed[0]?.role, "assistant");
  assert.match(displayed[0]?.content ?? "", /您好，我是锐读/);
  assert.match(displayed[0]?.content ?? "", /公开书目数据源/);
});

test("createBookFinderDisplayMessages filters out non-book-finder history messages", () => {
  const messages: ChatMessage[] = [
    {
      id: "history-user-1",
      role: "user",
      content: "普通研究问题",
      createdAt: "2026-04-13T10:00:00.000Z",
      status: "done",
    },
    {
      id: "history-answer-1",
      role: "assistant",
      content: "这是课题研究历史回答",
      createdAt: "2026-04-13T10:00:01.000Z",
      status: "done",
    },
    {
      id: "book-finder-user:1",
      role: "user",
      content: "组织管理",
      createdAt: "2026-04-13T10:01:00.000Z",
      status: "done",
    },
    {
      id: "assistant-book-finder-1",
      role: "assistant",
      content: "1. **《组织的逻辑》**\n- 链接：[豆瓣](https://book.douban.com/subject/1/)\n- 【豆瓣】评分：8.6/10（245 条评价）",
      createdAt: "2026-04-13T10:01:01.000Z",
      status: "done",
    },
  ];

  const displayed = createBookFinderDisplayMessages(messages);

  assert.deepEqual(displayed.map((message) => message.id), [
    "book-finder-welcome",
    "book-finder-user:1",
    "assistant-book-finder-1",
  ]);
});

test("createBookFinderDisplayMessages keeps persisted book-finder user messages even without optimistic id prefix", () => {
  const messages: ChatMessage[] = [
    {
      id: "db-user-message-1",
      role: "user",
      content: "帮我找和 Agent 相关的书籍",
      createdAt: "2026-04-14T09:01:00.000Z",
      status: "done",
    },
    {
      id: "assistant-book-finder-2",
      role: "assistant",
      content: "1. **《Designing Agents》**\n- 链接：[Open Library](https://openlibrary.org/works/OL1W)\n- 评分：暂无公开数据",
      createdAt: "2026-04-14T09:01:01.000Z",
      status: "done",
    },
  ];

  const displayed = createBookFinderDisplayMessages(messages);

  assert.deepEqual(displayed.map((message) => message.id), [
    "book-finder-welcome",
    "db-user-message-1",
    "assistant-book-finder-2",
  ]);
});

test("createBookFinderDisplayMessages keeps persisted quick-find user messages even when search failed", () => {
  const messages: ChatMessage[] = [
    {
      id: "db-user-message-failed-search",
      role: "user",
      content: "冷门主题",
      createdAt: "2026-04-14T09:01:00.000Z",
      status: "done",
    },
  ];

  const displayed = createBookFinderDisplayMessages(messages);

  assert.deepEqual(displayed.map((message) => message.id), [
    "book-finder-welcome",
    "db-user-message-failed-search",
  ]);
});

test("createBookFinderDisplayMessages keeps persisted assistant results after system headings were removed", () => {
  const messages: ChatMessage[] = [
    {
      id: "db-user-message-2",
      role: "user",
      content: "组织学习",
      createdAt: "2026-04-14T09:02:00.000Z",
      status: "done",
    },
    {
      id: "assistant-book-finder-3",
      role: "assistant",
      content: "1. **《第五项修炼》**\n- 链接：[豆瓣](https://book.douban.com/subject/10554308/) | [微信读书](https://weread.qq.com/example)\n- 【豆瓣】评分：8.6/10\n- 【微信读书】推荐值：78.0%（664 人）",
      createdAt: "2026-04-14T09:02:01.000Z",
      status: "done",
    },
  ];

  const displayed = createBookFinderDisplayMessages(messages);

  assert.deepEqual(displayed.map((message) => message.id), [
    "book-finder-welcome",
    "db-user-message-2",
    "assistant-book-finder-3",
  ]);
});

test("createBookFinderDisplayMessages recognizes flat assistant results by link and rating lines", () => {
  const messages: ChatMessage[] = [
    {
      id: "db-user-message-3",
      role: "user",
      content: "组织学习",
      createdAt: "2026-04-14T09:03:00.000Z",
      status: "done",
    },
    {
      id: "assistant-book-finder-4",
      role: "assistant",
      content: "1. **《学习型组织》**\n- 链接：[豆瓣](https://book.douban.com/subject/2/)\n- 【豆瓣】评分：8.4/10（320 条评价）",
      createdAt: "2026-04-14T09:03:01.000Z",
      status: "done",
    },
  ];

  const displayed = createBookFinderDisplayMessages(messages);

  assert.deepEqual(displayed.map((message) => message.id), [
    "book-finder-welcome",
    "db-user-message-3",
    "assistant-book-finder-4",
  ]);
});

test("BookWorkbenchView no longer wires quick find buttons into side panels", () => {
  const source = readFileSync(new URL("./BookWorkbenchView.vue", import.meta.url), "utf8");

  assert.doesNotMatch(source, /:on-book-finder="openBookFinder"/);
  assert.doesNotMatch(source, /:book-finder-loading="bookFinderSending"/);
  assert.doesNotMatch(source, /function openBookFinder\(\)/);
});

test("ReportDetailPanel no longer keeps the markdown download toolbar button", () => {
  const source = readFileSync(new URL("../components/notebook-workbench/ReportDetailPanel.vue", import.meta.url), "utf8");

  assert.doesNotMatch(source, /下载 \.md/);
  assert.doesNotMatch(source, /const isMarkdownEntry/);
  assert.doesNotMatch(source, /function downloadMarkdown/);
});
