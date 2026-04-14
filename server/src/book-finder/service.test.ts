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
  type BookCandidate,
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
    ratingSourceLabel: "豆瓣",
    ratingScale: 10,
    infoLink: `https://example.com/books/${id}`,
    previewLink: `https://example.com/books/${id}/preview`,
    wereadLink: null,
    wereadRecommendationScore: null,
    wereadRecommendationCount: null,
    sourceLabel: "豆瓣",
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function createDoubanSubjectSearchHtml(
  items: Array<{
    id: number;
    title: string;
    url?: string;
    abstract?: string;
    ratingValue?: number;
    ratingCount?: number;
  }>,
): string {
  return [
    "<!DOCTYPE html>",
    "<html><body>",
    `<script>window.__DATA__ = ${JSON.stringify({
      count: items.length,
      total: items.length,
      start: 0,
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url ?? `https://book.douban.com/subject/${item.id}/`,
        abstract: item.abstract ?? "",
        rating: {
          value: item.ratingValue ?? 0,
          count: item.ratingCount ?? 0,
          rating_info: "",
          star_count: 0,
        },
      })),
    })};</script>`,
    "</body></html>",
  ].join("");
}

function createDoubanDetailHtml(options: {
  title: string;
  subtitle?: string;
  authors: string[];
  publisher: string;
  publishedYear: string;
  isbn: string;
  description: string;
  averageRating?: number | null;
  ratingsCount?: number | null;
}): string {
  const authorsMarkup = options.authors
    .map((author) => `<a class="" href="/search/${encodeURIComponent(author)}">${author}</a>`)
    .join("");
  const subtitleMarkup = options.subtitle
    ? `<h2 class="subtitle"><span property="v:subtitle">${options.subtitle}</span></h2>`
    : "";
  const ratingMarkup = typeof options.averageRating === "number"
    ? [
      "<div id=\"interest_sectl\">",
      `<strong class=\"ll rating_num\" property=\"v:average\"> ${options.averageRating} </strong>`,
      `<a href=\"comments\" class=\"rating_people\"><span property=\"v:votes\">${options.ratingsCount ?? 0}</span>人评价</a>`,
      "</div>",
    ].join("")
    : "";

  return [
    "<!DOCTYPE html>",
    "<html><head>",
    ...options.authors.map((author) => `<meta property=\"book:author\" content=\"${author}\" />`),
    `<meta property=\"book:isbn\" content=\"${options.isbn}\" />`,
    "</head><body>",
    `<h1 class=\"title\"><span property=\"v:itemreviewed\">${options.title}</span></h1>`,
    subtitleMarkup,
    "<div id=\"info\">",
    `<span><span class=\"pl\"> 作者</span>: ${authorsMarkup}</span><br/>`,
    `<span class=\"pl\">出版社:</span>${options.publisher}<br/>`,
    `<span class=\"pl\">出版年:</span> ${options.publishedYear}<br/>`,
    `<span class=\"pl\">ISBN:</span> ${options.isbn}<br/>`,
    "</div>",
    ratingMarkup,
    "<div id=\"link-report\">",
    "<span class=\"all hidden\"><div class=\"intro\">",
    `<p>${options.description}</p>`,
    "</div></span>",
    "</div>",
    "</body></html>",
  ].join("");
}

function createWereadSearchJson(
  items: Array<{
    title: string;
    author: string;
    publisher?: string;
    intro?: string;
    newRating?: number;
    newRatingCount?: number;
    bookId?: string;
  }>,
): {
  books: Array<{ bookInfo: Record<string, unknown>; searchIdx: number; type: number }>;
  totalCount: number;
} {
  return {
    books: items.map((item, index) => ({
      bookInfo: {
        bookId: item.bookId ?? String(index + 1),
        title: item.title,
        author: item.author,
        publisher: item.publisher ?? "",
        intro: item.intro ?? "",
        newRating: item.newRating,
        newRatingCount: item.newRatingCount,
      },
      searchIdx: index + 1,
      type: 0,
    })),
    totalCount: items.length,
  };
}

function createWereadSearchHtml(
  items: Array<{
    href: string;
    title: string;
    author: string;
    description?: string;
  }>,
): string {
  return [
    "<!DOCTYPE html>",
    "<html><body><ul class=\"search_bookDetail_list\">",
    ...items.map((item) => [
      "<li class=\"wr_bookList_item\">",
      `<a href=\"${item.href}\" class=\"wr_bookList_item_link\"></a>`,
      "<div class=\"wr_bookList_item_container\"><div class=\"wr_bookList_item_info\">",
      `<p class=\"wr_bookList_item_title\">${item.title}</p>`,
      `<p class=\"wr_bookList_item_author\"><a href=\"#\">${item.author}</a></p>`,
      `<p class=\"wr_bookList_item_desc\">${item.description ?? ""}</p>`,
      "</div></div>",
      "</li>",
    ].join("")),
    "</ul></body></html>",
  ].join("");
}

test("renderBookFinderMarkdown renders flat results with explicit link fallback and 豆瓣 rating", () => {
  const candidate = makeCandidate("a", {
    averageRating: 4.7,
    ratingsCount: 245,
    infoLink: null,
    previewLink: null,
  });

  const markdown = renderBookFinderMarkdown("组织管理", [candidate]);

  assert.doesNotMatch(markdown, /^# 快速找书结果/m);
  assert.doesNotMatch(markdown, /^## /m);
  assert.doesNotMatch(markdown, /检索主题：/);
  assert.doesNotMatch(markdown, /说明：以下书目信息/);
  assert.match(markdown, /- 链接：暂无公开链接/);
  assert.match(markdown, /- 【豆瓣】评分：4\.7\/10（245 条评价）/);
  assert.doesNotMatch(markdown, /微信读书：暂无数据/);
  assert.doesNotMatch(markdown, /微信读书评分/);
  assert.doesNotMatch(markdown, /- 评分：暂无公开数据/);
});

test("renderBookFinderMarkdown renders clickable links and multiple platform ratings in a flat list", () => {
  const foundationBooks = [
    makeCandidate("a", {
      title: "组织的逻辑",
      infoLink: "https://book.douban.com/subject/example-a/",
      previewLink: "https://book.douban.com/subject/example-a/preview",
      wereadLink: "https://weread.qq.com/web/bookDetail/example-a",
      wereadRecommendationScore: 78,
      wereadRecommendationCount: 664,
      averageRating: 8.6,
      ratingsCount: 245,
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

  const markdown = renderBookFinderMarkdown("组织管理", foundationBooks);

  assert.match(markdown, /\*\*《组织的逻辑》\*\*[\s\S]*?\n---\n\n2\. \*\*《管理的实践》\*\*/);
  assert.match(markdown, /- 链接：\[豆瓣\]\(https:\/\/book\.douban\.com\/subject\/example-a\/\) \| \[公开预览\]\(https:\/\/book\.douban\.com\/subject\/example-a\/preview\) \| \[微信读书\]\(https:\/\/weread\.qq\.com\/web\/bookDetail\/example-a\)/);
  assert.match(markdown, /- 【豆瓣】评分：8\.6\/10（245 条评价）/);
  assert.match(markdown, /- 【微信读书】推荐值：78\.0%（664 人）/);
  assert.match(markdown, /- 链接：\[Open Library\]\(https:\/\/openlibrary\.org\/example-b\)/);
  assert.match(markdown, /- 评分：暂无公开数据/);
  assert.doesNotMatch(markdown, /线上平台与评分：/);
  assert.doesNotMatch(markdown, /微信读书：/);
  assert.doesNotMatch(markdown, /^## /m);
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
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [{ title: "组织管理入门", bookIds: ["douban:35407520"] }] })
        : JSON.stringify({ searchText: "组织管理", keywords: ["组织", "管理"], languagePreference: "zh" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://book.douban.com/j/subject_suggest")) {
      return jsonResponse([
        {
          id: "35407520",
          type: "b",
          title: "价值共生",
          author_name: "陈春花",
          year: "2021",
          url: "https://book.douban.com/subject/35407520/",
        },
      ]);
    }

    if (url.startsWith("https://search.douban.com/book/subject_search")) {
      return new Response(createDoubanSubjectSearchHtml([
        {
          id: 35407520,
          title: "价值共生 : 数字化时代的组织管理",
          abstract: "陈春花 / 人民邮电出版社 / 2021-5 / 78.00元",
          ratingValue: 7.3,
          ratingCount: 845,
        },
      ]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://book.douban.com/subject/35407520/") {
      return new Response(createDoubanDetailHtml({
        title: "价值共生",
        subtitle: "数字化时代的组织管理",
        authors: ["陈春花"],
        publisher: "人民邮电出版社",
        publishedYear: "2021-5",
        isbn: "9787115560506",
        description: "这是一本关于数字时代组织管理的书。",
        averageRating: 7.3,
        ratingsCount: 845,
      }), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("组织管理", env, fetchImpl);

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.sourceLabel, "豆瓣");
  assert.equal(result.results[0]?.title, "价值共生");
  assert.equal(fetchCalls.some((url) => url.includes("googleapis.com/books")), false);
  assert.equal(fetchCalls.some((url) => url.startsWith("https://openlibrary.org/search.json")), false);
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
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [{ title: "心理学入门", bookIds: ["douban:10554308"] }] })
        : JSON.stringify({ searchText: "心理学 入门", keywords: ["心理学"], languagePreference: "zh" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://book.douban.com/j/subject_suggest")) {
      return jsonResponse([
        {
          id: "10554308",
          type: "b",
          title: "白夜行",
          author_name: "东野圭吾",
          year: "2013",
          url: "https://book.douban.com/subject/10554308/",
        },
      ]);
    }

    if (url.startsWith("https://search.douban.com/book/subject_search")) {
      return new Response(createDoubanSubjectSearchHtml([
        {
          id: 10554308,
          title: "白夜行",
          abstract: "[日] 东野圭吾 / 南海出版公司 / 2013-1-1 / 39.50元",
          ratingValue: 9.2,
          ratingCount: 529028,
        },
      ]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://book.douban.com/subject/10554308/") {
      return new Response(createDoubanDetailHtml({
        title: "白夜行",
        authors: ["[日] 东野圭吾"],
        publisher: "南海出版公司",
        publishedYear: "2013-1-1",
        isbn: "9787544258609",
        description: "一本经典推理小说。",
        averageRating: 9.2,
        ratingsCount: 529028,
      }), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url.startsWith("https://metadata.example.test/metadata")) {
      return jsonResponse({ code: 500, errmsg: "upstream failed" }, 500);
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("心理学 入门", env, fetchImpl);

  assert.match(result.markdown, /- 链接：\[豆瓣\]\(https:\/\/book\.douban\.com\/subject\/10554308\/\)/);
  assert.doesNotMatch(result.markdown, /Google Books/);
  assert.match(result.markdown, /- 【豆瓣】评分：9\.2\/10（529028 条评价）/);
  assert.doesNotMatch(result.markdown, /微信读书：暂无数据/);
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
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [{ title: "组织学习", bookIds: ["douban:35407520"] }] })
        : JSON.stringify({ searchText: "组织学习", keywords: ["组织", "学习"], languagePreference: "zh" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://book.douban.com/j/subject_suggest")) {
      return jsonResponse([
        {
          id: "35407520",
          type: "b",
          title: "价值共生",
          author_name: "陈春花",
          year: "2021",
          url: "https://book.douban.com/subject/35407520/",
        },
      ]);
    }

    if (url.startsWith("https://search.douban.com/book/subject_search")) {
      return new Response(createDoubanSubjectSearchHtml([
        {
          id: 35407520,
          title: "价值共生 : 数字化时代的组织管理",
          abstract: "陈春花 / 人民邮电出版社 / 2021-5 / 78.00元",
          ratingValue: 7.3,
          ratingCount: 845,
        },
      ]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://book.douban.com/subject/35407520/") {
      return new Response(createDoubanDetailHtml({
        title: "价值共生",
        subtitle: "数字化时代的组织管理",
        authors: ["陈春花"],
        publisher: "人民邮电出版社",
        publishedYear: "2021-5",
        isbn: "9787115560506",
        description: "一本关于组织学习的管理书。",
        averageRating: 7.3,
        ratingsCount: 845,
      }), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url.startsWith("https://metadata.example.test/metadata?isbn=9787115560506")) {
      return jsonResponse({
        code: 200,
        data: {
          title: "价值共生",
          author: "陈春花",
          publisher: "中信出版社",
          published: "2024-01",
          douban_rating: 8.6,
          douban_intro: "一本关于组织学习的经典书。",
          weread_intro: "微信读书里的简介。",
          weread_url: "https://weread.qq.com/web/bookDetail/example",
        },
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("组织学习", env, fetchImpl);

  assert.match(result.markdown, /- 链接：\[豆瓣\]\(https:\/\/book\.douban\.com\/subject\/35407520\/\) \| \[微信读书\]\(https:\/\/weread\.qq\.com\/web\/bookDetail\/example\)/);
  assert.match(result.markdown, /- 【豆瓣】评分：8\.6\/10/);
  assert.match(result.markdown, /价值共生/);
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
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "组织学习", keywords: ["组织", "学习"], languagePreference: "zh" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://book.douban.com/j/subject_suggest")) {
      return jsonResponse([]);
    }

    if (url.startsWith("https://search.douban.com/book/subject_search")) {
      return new Response(createDoubanSubjectSearchHtml([]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  await assert.rejects(
    () => findBooksForQuery("组织学习", env, fetchImpl),
    /快速找书 metadata bridge 缺少必要配置：BOOK_METADATA_API_KEY/,
  );
});

test("findBooksForQuery does not fall back to Open Library for Chinese queries when Douban has no reliable matches", async () => {
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
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "组织管理", keywords: ["组织", "管理"], languagePreference: "zh" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://book.douban.com/j/subject_suggest")) {
      return jsonResponse([]);
    }

    if (url.startsWith("https://search.douban.com/book/subject_search")) {
      return new Response(createDoubanSubjectSearchHtml([]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return jsonResponse({
        docs: [
          {
            key: "/works/OL1W",
            title: "Should Not Appear",
            author_name: ["Open Library Author"],
          },
        ],
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("组织管理", env, fetchImpl);

  assert.deepEqual(result.results, []);
  assert.match(result.markdown, /当前没有从公开书目数据源检索到足够可靠的结果/);
  assert.equal(fetchCalls.some((url) => url.startsWith("https://openlibrary.org/search.json")), false);
});

test("findBooksForQuery falls back to Open Library for English queries when Chinese sources are not preferred", async () => {
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
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [{ title: "English Books", bookIds: ["openlibrary:/works/OL5W"] }] })
        : JSON.stringify({ searchText: "leadership", keywords: ["leadership"], languagePreference: "en" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      const parsed = new URL(url);
      searchedQueries.push(parsed.searchParams.get("q") ?? "");
      return jsonResponse({
        docs: [
          {
            key: "/works/OL5W",
            title: "Leadership and Self-Deception",
            author_name: ["The Arbinger Institute"],
            publisher: ["Berrett-Koehler"],
            first_publish_year: 2000,
            subject: ["Leadership"],
            isbn: ["9781576759776"],
          },
        ],
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("leadership", env, fetchImpl);

  assert.deepEqual(searchedQueries, ["leadership"]);
  assert.equal(result.results[0]?.sourceLabel, "Open Library");
  assert.match(result.markdown, /Leadership and Self-Deception/);
});

test("findBooksForQuery keeps Chinese routing for mixed Chinese queries with English acronyms", async () => {
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
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [{ title: "产品方法", bookIds: ["douban:35407520"] }] })
        : JSON.stringify({ searchText: "AI 产品经理", keywords: ["AI", "产品经理"], languagePreference: "any" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://book.douban.com/j/subject_suggest")) {
      return jsonResponse([
        {
          id: "35407520",
          type: "b",
          title: "启示录",
          author_name: "Marty Cagan",
          year: "2022",
          url: "https://book.douban.com/subject/35407520/",
        },
      ]);
    }

    if (url.startsWith("https://search.douban.com/book/subject_search")) {
      return new Response(createDoubanSubjectSearchHtml([]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://book.douban.com/subject/35407520/") {
      return new Response(createDoubanDetailHtml({
        title: "启示录",
        subtitle: "打造用户喜爱的产品",
        authors: ["Marty Cagan"],
        publisher: "人民邮电出版社",
        publishedYear: "2022-1",
        isbn: "9787115560506",
        description: "产品经理领域经典。",
        averageRating: 8.9,
        ratingsCount: 3200,
      }), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("AI 产品经理", env, fetchImpl);

  assert.equal(result.results[0]?.sourceLabel, "豆瓣");
  assert.equal(fetchCalls.some((url) => url.startsWith("https://openlibrary.org/search.json")), false);
});

test("findBooksForQuery falls back to public WeRead search when metadata bridge has no weread link", async () => {
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
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [{ title: "组织管理", bookIds: ["douban:35407520"] }] })
        : JSON.stringify({ searchText: "组织管理", keywords: ["组织", "管理"], languagePreference: "zh" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://book.douban.com/j/subject_suggest")) {
      return jsonResponse([
        {
          id: "35407520",
          type: "b",
          title: "价值共生",
          author_name: "陈春花",
          year: "2021",
          url: "https://book.douban.com/subject/35407520/",
        },
      ]);
    }

    if (url.startsWith("https://search.douban.com/book/subject_search")) {
      return new Response(createDoubanSubjectSearchHtml([
        {
          id: 35407520,
          title: "价值共生 : 数字化时代的组织管理",
          abstract: "陈春花 / 人民邮电出版社 / 2021-5 / 78.00元",
          ratingValue: 7.3,
          ratingCount: 845,
        },
      ]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://book.douban.com/subject/35407520/") {
      return new Response(createDoubanDetailHtml({
        title: "价值共生",
        subtitle: "数字化时代的组织管理",
        authors: ["陈春花"],
        publisher: "人民邮电出版社",
        publishedYear: "2021-5",
        isbn: "9787115560506",
        description: "这是一本关于数字时代组织管理的书。",
        averageRating: 7.3,
        ratingsCount: 845,
      }), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url.startsWith("https://metadata.example.test/metadata?isbn=9787115560506")) {
      return jsonResponse({
        code: 200,
        data: {
          title: "价值共生",
          author: "陈春花",
          publisher: "人民邮电出版社",
          published: "2021-5",
          douban_rating: 7.3,
          douban_intro: "豆瓣简介",
        },
      });
    }

    if (url.startsWith("https://weread.qq.com/web/search/global")) {
      return jsonResponse(createWereadSearchJson([
        {
          title: "价值共生：数字化时代的组织管理",
          author: "陈春花",
          publisher: "人民邮电出版社",
          intro: "微信读书简介",
          newRating: 780,
          newRatingCount: 664,
          bookId: "37178837",
        },
      ]));
    }

    if (url.startsWith("https://weread.qq.com/web/search/books")) {
      return new Response(createWereadSearchHtml([
        {
          href: "/web/reader/dc5324b072374dd5dc5ac13",
          title: "价值共生：数字化时代的组织管理",
          author: "陈春花",
          description: "微信读书简介",
        },
      ]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("组织管理", env, fetchImpl);

  assert.match(result.markdown, /- 链接：\[豆瓣\]\(https:\/\/book\.douban\.com\/subject\/35407520\/\) \| \[微信读书\]\(https:\/\/weread\.qq\.com\/web\/reader\/dc5324b072374dd5dc5ac13\)/);
  assert.match(result.markdown, /- 【豆瓣】评分：7\.3\/10（845 条评价）/);
  assert.match(result.markdown, /- 【微信读书】推荐值：78\.0%（664 人）/);
});

test("findBooksForQuery uses WeRead HTML fallback when public JSON search returns no match", async () => {
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
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [{ title: "组织管理", bookIds: ["douban:35407520"] }] })
        : JSON.stringify({ searchText: "组织管理", keywords: ["组织", "管理"], languagePreference: "zh" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://book.douban.com/j/subject_suggest")) {
      return jsonResponse([
        {
          id: "35407520",
          type: "b",
          title: "价值共生",
          author_name: "陈春花",
          year: "2021",
          url: "https://book.douban.com/subject/35407520/",
        },
      ]);
    }

    if (url.startsWith("https://search.douban.com/book/subject_search")) {
      return new Response(createDoubanSubjectSearchHtml([]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://book.douban.com/subject/35407520/") {
      return new Response(createDoubanDetailHtml({
        title: "价值共生",
        subtitle: "数字化时代的组织管理",
        authors: ["陈春花"],
        publisher: "人民邮电出版社",
        publishedYear: "2021-5",
        isbn: "9787115560506",
        description: "这是一本关于数字时代组织管理的书。",
        averageRating: 7.3,
        ratingsCount: 845,
      }), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url.startsWith("https://metadata.example.test/metadata?isbn=9787115560506")) {
      return jsonResponse({
        code: 200,
        data: {
          title: "价值共生",
          author: "陈春花",
          publisher: "人民邮电出版社",
          published: "2021-5",
          douban_rating: 7.3,
          douban_intro: "豆瓣简介",
        },
      });
    }

    if (url.startsWith("https://weread.qq.com/web/search/global")) {
      return jsonResponse(createWereadSearchJson([]));
    }

    if (url.startsWith("https://weread.qq.com/web/search/books")) {
      return new Response(createWereadSearchHtml([
        {
          href: "/web/bookDetail/f9332a70811e5d70fg01855b",
          title: "价值共生：数字化时代的组织管理",
          author: "陈春花",
          description: "微信读书 HTML 补链简介",
        },
      ]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("组织管理", env, fetchImpl);

  assert.match(result.markdown, /- 链接：\[豆瓣\]\(https:\/\/book\.douban\.com\/subject\/35407520\/\) \| \[微信读书\]\(https:\/\/weread\.qq\.com\/web\/bookDetail\/f9332a70811e5d70fg01855b\)/);
  assert.match(result.markdown, /- 【豆瓣】评分：7\.3\/10（845 条评价）/);
  assert.doesNotMatch(result.markdown, /- 【微信读书】推荐值：/);
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
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "帮我找和 Agent 相关的书籍", keywords: ["Agent", "自动化", "系统"], languagePreference: "en" });
      return jsonResponse({ choices: [{ message: { content } }] });
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
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [{ title: "English Books", bookIds: ["openlibrary:/works/OL3W"] }] })
        : JSON.stringify({ searchText: "Agent 自动化 系统", keywords: ["Agent", "自动化", "系统"], languagePreference: "en" });
      return jsonResponse({ choices: [{ message: { content } }] });
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
  assert.equal(result.results.length, 1);
});

test("findBooksForQuery renders a flat result list without category headings or score ranking blocks", async () => {
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
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://book.douban.com/j/subject_suggest")) {
      return jsonResponse([
        {
          id: "10554308",
          type: "b",
          title: "第五项修炼",
          author_name: "彼得·圣吉",
          year: "2024",
          url: "https://book.douban.com/subject/10554308/",
        },
      ]);
    }

    if (url.startsWith("https://search.douban.com/book/subject_search")) {
      return new Response(createDoubanSubjectSearchHtml([
        {
          id: 10554308,
          title: "第五项修炼",
          abstract: "彼得·圣吉 / 中信出版社 / 2024-1 / 69.00元",
          ratingValue: 8.6,
          ratingCount: 1200,
        },
      ]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://book.douban.com/subject/10554308/") {
      return new Response(createDoubanDetailHtml({
        title: "第五项修炼",
        subtitle: "学习型组织的艺术与实践",
        authors: ["彼得·圣吉"],
        publisher: "中信出版社",
        publishedYear: "2024-1",
        isbn: "9787521761238",
        description: "组织学习经典著作。",
        averageRating: 8.6,
        ratingsCount: 1200,
      }), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await findBooksForQuery("组织学习", env, fetchImpl);

  assert.equal(result.results.length, 1);
  assert.match(result.markdown, /^1\. \*\*《第五项修炼》\*\*/m);
  assert.doesNotMatch(result.markdown, /^## /m);
  assert.doesNotMatch(result.markdown, /已核验评分最高|入门与经典|实践与案例|思想与延展/);
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

  assert.deepEqual(result.results, []);
  assert.match(result.markdown, /当前没有从公开书目数据源检索到足够可靠的结果/);
});
