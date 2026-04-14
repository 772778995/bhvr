import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  findBooksForQuery,
  listMissingBookFinderConfig,
  resetWorkspaceEnvCacheForTests,
  renderBookFinderMarkdown,
  sanitizeBookSelection,
  sanitizeDynamicBookSelection,
  type BookFinderResult,
  type BookCandidate,
  type BookSelection,
} from "./service.js";

function makeCandidate(id: string, overrides?: Partial<BookCandidate>): BookCandidate {
  return {
    id,
    title: `Book ${id}`,
    authors: ["Author"],
    publisher: "Test Publisher",
    publishedYear: "2024",
    description: "A concise description for testing the book finder output.",
    categories: ["Business"],
    isbns: [],
    averageRating: 4.5,
    ratingsCount: 120,
    ratingSourceLabel: null,
    ratingScale: null,
    infoLink: `https://example.com/books/${id}`,
    previewLink: `https://example.com/books/${id}/preview`,
    wereadLink: null,
    sourceLabel: "Google Books",
    ...overrides,
  };
}

test("sanitizeBookSelection drops unknown ids and duplicates from model output", () => {
  const candidates = [makeCandidate("a"), makeCandidate("b"), makeCandidate("c")];
  const selection: BookSelection = {
    foundationIds: ["a", "missing", "a", "b"],
    practiceIds: ["missing", "c"],
    logicIds: ["c", "b", "c"],
    topRatedIds: ["missing", "b", "a", "b"],
  };

  assert.deepEqual(sanitizeBookSelection(selection, candidates), {
    foundationIds: ["a", "b"],
    practiceIds: ["c"],
    logicIds: ["c", "b"],
    topRatedIds: ["b", "a"],
  });
});

test("renderBookFinderMarkdown renders 微信读书 暂无数据 when bridge fields are missing", () => {
  const candidate = makeCandidate("a", {
    sourceLabel: "Google Books",
    averageRating: 4.7,
    ratingsCount: 245,
  });

  const markdown = renderBookFinderMarkdown("组织管理", {
    sections: [
      { title: "Agent 入门与经典", books: [candidate] },
      { title: "企业应用与实践", books: [candidate] },
      { title: "延展与底层方法", books: [candidate] },
    ],
    topRated: [candidate],
  });

  assert.doesNotMatch(markdown, /^# 快速找书结果/m);
  assert.doesNotMatch(markdown, /检索主题：/);
  assert.doesNotMatch(markdown, /说明：以下书目信息/);
  assert.match(markdown, /微信读书：暂无数据/);
  assert.match(markdown, /Google Books 评分 4\.7\/5（245 条评价）/);
  assert.doesNotMatch(markdown, /微信读书评分/);
});

test("renderBookFinderMarkdown separates books and hides public detail links in recommendation blocks", () => {
  const foundationBooks = [
    makeCandidate("a", {
      title: "组织的逻辑",
      infoLink: "https://books.google.com/example-a",
      previewLink: "https://books.google.com/example-a/preview",
    }),
    makeCandidate("b", {
      title: "管理的实践",
      infoLink: "https://openlibrary.org/example-b",
      previewLink: null,
      sourceLabel: "Open Library",
      averageRating: null,
      ratingsCount: null,
    }),
  ];

  const markdown = renderBookFinderMarkdown("组织管理", {
    sections: [
      { title: "企业应用与实践", books: foundationBooks },
      { title: "延展与底层方法", books: [makeCandidate("c")] },
    ],
    topRated: [],
  });

  assert.match(markdown, /\*\*《组织的逻辑》\*\*[\s\S]*?\n---\n\n2\. \*\*《管理的实践》\*\*/);
  assert.doesNotMatch(markdown, /详情：https?:\/\//);
  assert.doesNotMatch(markdown, /预览：https?:\/\//);
  assert.doesNotMatch(markdown, /books\.google\.com/);
  assert.doesNotMatch(markdown, /openlibrary\.org\/example-b/);
  assert.ok(markdown.includes("线上平台与评分："));
  assert.ok(markdown.includes("\n- 微信读书："));
  assert.match(markdown, /## [^\n]+\n\n[\s\S]*?\n\n\n## [^\n]+/);
});

test("sanitizeDynamicBookSelection keeps dynamic section titles while dropping unknown ids", () => {
  const candidates = [makeCandidate("a"), makeCandidate("b"), makeCandidate("c")];

  assert.deepEqual(
    sanitizeDynamicBookSelection(
      [
        { title: "Agent 入门与经典", bookIds: ["a", "missing", "b"] },
        { title: "企业级 Agent 实践", bookIds: ["c", "c"] },
        { title: "   ", bookIds: ["a"] },
      ],
      candidates,
    ),
    [
      { title: "Agent 入门与经典", bookIds: ["a", "b"] },
      { title: "企业级 Agent 实践", bookIds: ["c"] },
    ],
  );
});

test("listMissingBookFinderConfig applies cached workspace env values to each env object", () => {
  const originalCwd = process.cwd();
  const fixtureDir = mkdtempSync(join(tmpdir(), "book-finder-env-"));

  writeFileSync(join(fixtureDir, ".env"), [
    "OPENAI_BASE_URL=https://example.test/v1",
    "OPENAI_TOKEN=test-token",
    "OPENAI_MODEL=test-model",
  ].join("\n"));

  try {
    resetWorkspaceEnvCacheForTests();
    process.chdir(fixtureDir);

    const firstEnv: NodeJS.ProcessEnv = {};
    const secondEnv: NodeJS.ProcessEnv = {};

    assert.deepEqual(listMissingBookFinderConfig(firstEnv), []);
    assert.deepEqual(listMissingBookFinderConfig(secondEnv), []);
    assert.equal(secondEnv.OPENAI_BASE_URL, "https://example.test/v1");
    assert.equal(secondEnv.OPENAI_TOKEN, "test-token");
    assert.equal(secondEnv.OPENAI_MODEL, "test-model");
  } finally {
    process.chdir(originalCwd);
    resetWorkspaceEnvCacheForTests();
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("findBooksForQuery does not call Google Books after the product data-source switch", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const fetchCalls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push(url);

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 foundationIds")
        ? JSON.stringify({ foundationIds: ["openlibrary:/works/OL1W"], practiceIds: [], logicIds: [] })
        : JSON.stringify({ searchText: "组织管理", keywords: ["组织", "管理"], languagePreference: "zh" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return new Response(JSON.stringify({
        docs: [
          {
            key: "/works/OL1W",
            title: "组织的逻辑",
            author_name: ["作者甲"],
            publisher: ["测试出版社"],
            first_publish_year: 2020,
            subject: ["组织", "管理"],
            isbn: ["9787532172313"],
          },
        ],
      }), { status: 200 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("组织管理", env, fetchImpl);

  assert.equal(result.sections.sections[0]?.books.length, 1);
  assert.equal(fetchCalls.some((url) => url.includes("googleapis.com/books")), false);
});

test("findBooksForQuery renders 微信读书 暂无数据 when metadata bridge fails", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
    BOOK_METADATA_BASE_URL: "https://metadata.example.test",
    BOOK_METADATA_API_KEY: "meta-key",
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 foundationIds")
        ? JSON.stringify({ foundationIds: ["openlibrary:/works/OL1W"], practiceIds: [], logicIds: [] })
        : JSON.stringify({ searchText: "心理学 入门", keywords: ["心理学"], languagePreference: "zh" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return new Response(JSON.stringify({
        docs: [
          {
            key: "/works/OL1W",
            title: "心理学与生活",
            author_name: ["作者乙"],
            publisher: ["测试出版社"],
            first_publish_year: 2021,
            subject: ["心理学", "基础"],
            isbn: ["9787532172313"],
          },
        ],
      }), { status: 200 });
    }

    if (url.startsWith("https://metadata.example.test/metadata")) {
      return new Response(JSON.stringify({ code: 500, errmsg: "upstream failed" }), { status: 500 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("心理学 入门", env, fetchImpl);

  assert.match(result.markdown, /微信读书：暂无数据/);
  assert.doesNotMatch(result.markdown, /Google Books/);
});

test("findBooksForQuery renders metadata bridge success with 豆瓣 /10 rating and WeRead link", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
    BOOK_METADATA_BASE_URL: "https://metadata.example.test",
    BOOK_METADATA_API_KEY: "meta-key",
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 foundationIds")
        ? JSON.stringify({ foundationIds: ["openlibrary:/works/OL2W"], practiceIds: [], logicIds: [] })
        : JSON.stringify({ searchText: "组织学习", keywords: ["组织", "学习"], languagePreference: "zh" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return new Response(JSON.stringify({
        docs: [
          {
            key: "/works/OL2W",
            title: "旧标题",
            author_name: ["旧作者"],
            publisher: ["旧出版社"],
            first_publish_year: 2018,
            subject: ["组织", "学习"],
            isbn: ["0000000000000", "9787532172313"],
          },
        ],
      }), { status: 200 });
    }

    if (url.startsWith("https://metadata.example.test/metadata?isbn=0000000000000")) {
      return new Response(JSON.stringify({ code: 404, errmsg: "not found" }), { status: 404 });
    }

    if (url.startsWith("https://metadata.example.test/metadata?isbn=9787532172313")) {
      return new Response(JSON.stringify({
        code: 200,
        data: {
          title: "第五项修炼",
          author: "彼得·圣吉",
          publisher: "中信出版社",
          published: "2024-01",
          douban_rating: 8.6,
          douban_intro: "一本关于组织学习的经典书。",
          weread_intro: "微信读书里的简介。",
          weread_url: "https://weread.qq.com/web/bookDetail/example",
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("组织学习", env, fetchImpl);

  assert.match(result.markdown, /豆瓣 评分 8\.6\/10/);
  assert.match(result.markdown, /微信读书：https:\/\/weread\.qq\.com\/web\/bookDetail\/example/);
  assert.match(result.markdown, /第五项修炼/);
});

test("findBooksForQuery rejects partial metadata bridge config instead of silently sending unauthenticated requests", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
    BOOK_METADATA_BASE_URL: "https://metadata.example.test",
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 foundationIds")
        ? JSON.stringify({ foundationIds: [], practiceIds: [], logicIds: [] })
        : JSON.stringify({ searchText: "组织学习", keywords: ["组织", "学习"], languagePreference: "zh" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return new Response(JSON.stringify({ docs: [] }), { status: 200 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  await assert.rejects(
    () => findBooksForQuery("组织学习", env, fetchImpl),
    /快速找书 metadata bridge 缺少必要配置：BOOK_METADATA_API_KEY/,
  );
});

test("findBooksForQuery normalizes natural-language request into topic keywords before searching Open Library", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const searchedQueries: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 foundationIds")
        ? JSON.stringify({ foundationIds: [], practiceIds: [], logicIds: [] })
        : JSON.stringify({ searchText: "帮我找和 Agent 相关的书籍", keywords: ["Agent", "自动化", "系统"], languagePreference: "any" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      const parsedUrl = new URL(url);
      searchedQueries.push(parsedUrl.searchParams.get("q") ?? "");
      return new Response(JSON.stringify({ docs: [] }), { status: 200 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("帮我找和 Agent 相关的书籍", env, fetchImpl);

  assert.equal(searchedQueries[0], "Agent 自动化 系统");
  assert.equal(result.normalizedQuery, "Agent 自动化 系统");
});

test("findBooksForQuery retries Open Library with relaxed query when normalized search gets HTTP 422", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const searchedQueries: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 foundationIds")
        ? JSON.stringify({ foundationIds: ["openlibrary:/works/OL3W"], practiceIds: [], logicIds: [] })
        : JSON.stringify({ searchText: "Agent 自动化 系统", keywords: ["Agent", "自动化", "系统"], languagePreference: "any" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      const parsedUrl = new URL(url);
      const q = parsedUrl.searchParams.get("q") ?? "";
      searchedQueries.push(q);

      if (q === "Agent 自动化 系统") {
        return new Response("invalid query", { status: 422 });
      }

      if (q === "Agent") {
        return new Response(JSON.stringify({
          docs: [
            {
              key: "/works/OL3W",
              title: "Human + Machine",
              author_name: ["Paul R. Daugherty"],
              publisher: ["Harvard Business Review Press"],
              first_publish_year: 2018,
              subject: ["Agent", "Automation"],
              isbn: ["9781633693869"],
            },
          ],
        }), { status: 200 });
      }
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("帮我找和 Agent 相关的书籍", env, fetchImpl);

  assert.deepEqual(searchedQueries, ["Agent 自动化 系统", "Agent"]);
  assert.equal(result.sections.sections[0]?.books.length, 1);
});

test("findBooksForQuery uses query-derived fallback section titles instead of fixed category names", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "组织学习", keywords: ["组织学习"], languagePreference: "zh" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return new Response(JSON.stringify({
        docs: [
          {
            key: "/works/OL4W",
            title: "组织学习手册",
            author_name: ["作者丙"],
            publisher: ["测试出版社"],
            first_publish_year: 2022,
            subject: ["组织学习"],
            isbn: ["9780000000004"],
          },
        ],
      }), { status: 200 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("组织学习", env, fetchImpl);

  assert.equal(result.sections.sections.length, 1);
  assert.match(result.sections.sections[0]?.title ?? "", /组织学习/);
  assert.doesNotMatch(result.markdown, /基础教材与经典类|行业与企业实践类|底层逻辑与延展类/);
});

test("findBooksForQuery returns empty dynamic sections instead of crashing on no results", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ searchText: "冷门主题", keywords: ["冷门主题"], languagePreference: "zh" }) } }],
      }), { status: 200 });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return new Response(JSON.stringify({ docs: [] }), { status: 200 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("冷门主题", env, fetchImpl);

  assert.deepEqual(result.sections.sections, []);
  assert.deepEqual(result.sections.topRated, []);
  assert.match(result.markdown, /当前没有从公开书目数据源检索到足够可靠的结果/);
});
