import assert from "node:assert/strict";
import test from "node:test";

import { findBooksForQuery, type BookFinderResult } from "./service.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function annaSearchHtml(): string {
  return [
    "<!doctype html>",
    '<div class="flex  pt-3 pb-3 border-b last:border-b-0 border-gray-100">',
    '<a href="/md5/6a5ea8bc67fa38056fa37e9c8b8a76a3" class="custom-a block mr-2 sm:mr-4 hover:opacity-80"></a>',
    '<div class="max-w-full overflow-hidden flex flex-col justify-around">',
    "<div>",
    '<div class="line-clamp-[2] overflow-hidden break-words text-[9px] text-gray-500 font-mono">ia/managed-heart.pdf</div>',
    '<a href="/md5/6a5ea8bc67fa38056fa37e9c8b8a76a3" class="line-clamp-[3] overflow-hidden break-words js-vim-focus custom-a text-[#2563eb] inline-block outline-offset-[-2px] outline-2 rounded-[3px] focus:outline font-semibold text-lg leading-[1.2] hover:opacity-80 mt-1">The Managed Heart</a>',
    '<a href="/search?q=Arlie Hochschild" class="line-clamp-[2] overflow-hidden break-words block custom-a text-sm hover:opacity-70 leading-[1.2] mt-1"><span class="icon-[mdi--user-edit] text-base align-sub"></span> Arlie Hochschild</a>',
    '<a href="/search?q=University of California Press" class="line-clamp-[2] overflow-hidden break-words block custom-a text-sm hover:opacity-70 leading-[1.2] mt-1"><span class="icon-[mdi--company] text-base align-sub"></span> University of California Press, 1983</a>',
    "</div>",
    "<div>",
    '<div class="line-clamp-[5]"></div>',
    '<div class="relative"><div class="line-clamp-[2] overflow-hidden break-words text-sm text-gray-600 mt-2 mb-2 leading-[1.3]">A classic study of emotional labor.</div></div>',
    "</div>",
    '<div class="text-gray-800 dark:text-slate-400 font-semibold text-sm leading-[1.2] mt-2">✅ English [en] · PDF · 9.2MB · 1983 · 📘 Book (non-fiction)</div>',
    "</div>",
    "</div>",
  ].join("");
}

function gutenbergSearchFeed(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "<entry>",
    "<id>https://www.gutenberg.org/ebooks/6435.opds</id>",
    "<title>The Principles of Scientific Management</title>",
    '<content type="text">Frederick Winslow Taylor</content>',
    '<link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/6435.opds"/>',
    "</entry>",
    "</feed>",
  ].join("");
}

function gutenbergDetailFeed(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "<entry>",
    "<title>The Principles of Scientific Management</title>",
    '<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Summary: Classic management text.</p><p>Downloads: 1821</p><p>Language: English</p></div></content>',
    "<author><name>Taylor, Frederick Winslow</name></author>",
    '<category scheme="http://purl.org/dc/terms/LCSH" term="Management"/>',
    "</entry>",
    "</feed>",
  ].join("");
}

function gutenbergDetailFeedWithRelativeAcquisition(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "<entry>",
    "<title>The Principles of Scientific Management</title>",
    '<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Summary: Classic management text.</p><p>Downloads: 1821</p><p>Language: English</p></div></content>',
    "<author><name>Taylor, Frederick Winslow</name></author>",
    '<category scheme="http://purl.org/dc/terms/LCSH" term="Management"/>',
    '<link rel="http://opds-spec.org/acquisition" href="/ebooks/6435.epub.images"/>',
    "</entry>",
    "</feed>",
  ].join("");
}

function zLibrarySearchHtml(): string {
  return [
    "<!doctype html>",
    '<div id="searchResultBox"><div class="divider"></div><div class="book-item resItemBoxBooks ">',
    '<div class="counter">1</div>',
    '<z-bookcard id="1" isbn="9787508600000" href="/book/z123/organization-handbook.html" publisher="机械工业出版社" language="Chinese" year="2020" extension="epub" filesize="1.2 MB" rating="4.0" quality="4.0">',
    '<div slot="title">组织管理手册</div>',
    '<div slot="author">张三</div>',
    "</z-bookcard>",
    "</div></div>",
  ].join("");
}

function zLibraryDetailHtml(): string {
  return [
    "<!doctype html>",
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Book","name":"组织管理手册","description":"一本关于组织管理的中文书。","author":[{"@type":"Person","name":"张三"}],"publisher":{"@type":"Organization","name":"机械工业出版社"},"isbn":"9787508600000","datePublished":2020}</script>',
    '<h1 class="book-title" itemprop="name">组织管理手册</h1>',
    '<i class="authors"><a class="color1" href="/author/张三">张三</a></i>',
    '<div id="bookDescriptionBox">一本关于组织管理的中文书。</div>',
    '<div class="bookDetailsBox">',
    '<div class="bookProperty property_year"><div class="property_label">Year:</div><div class="property_value">2020</div></div>',
    '<div class="bookProperty property_publisher"><div class="property_label">Publisher:</div><div class="property_value">机械工业出版社</div></div>',
    '<div class="bookProperty property_language"><div class="property_label">Language:</div><span class="property_value text-capitalize">Chinese</span></div>',
    '<div class="bookProperty property_isbn 13"><div class="property_label">ISBN 13:</div><div class="property_value">9787508600000</div></div>',
    '<div class="bookProperty property__file"><div class="property_label">File:</div><div class="property_value">EPUB, 1.2 MB</div></div>',
    "</div>",
  ].join("");
}

function zLibraryDetailHtmlWithPartialJsonLd(): string {
  return [
    "<!doctype html>",
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Book","name":"组织管理手册"}</script>',
    '<h1 class="book-title" itemprop="name">组织管理手册</h1>',
    '<i class="authors"><a class="color1" href="/author/张三">张三</a></i>',
    '<div id="bookDescriptionBox">一本来自 HTML 详情页的摘要。</div>',
    '<div class="bookDetailsBox">',
    '<div class="bookProperty property_year"><div class="property_label">Year:</div><div class="property_value">2021</div></div>',
    '<div class="bookProperty property_publisher"><div class="property_label">Publisher:</div><div class="property_value">中信出版社</div></div>',
    '<div class="bookProperty property_language"><div class="property_label">Language:</div><span class="property_value text-capitalize">Chinese</span></div>',
    '<div class="bookProperty property_isbn 13"><div class="property_label">ISBN 13:</div><div class="property_value">9787508600001</div></div>',
    "</div>",
  ].join("");
}

function gutenbergSearchFeedWithEntries(entries: Array<{ ebookId: number; title: string; author: string }>): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    ...entries.flatMap((entry) => [
      "<entry>",
      `<id>https://www.gutenberg.org/ebooks/${entry.ebookId}.opds</id>`,
      `<title>${entry.title}</title>`,
      `<content type="text">${entry.author}</content>`,
      `<link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/${entry.ebookId}.opds"/>`,
      "</entry>",
    ]),
    "</feed>",
  ].join("");
}

function gutenbergDetailFeedFor(title: string, author: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "<entry>",
    `<title>${title}</title>`,
    `<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Summary: ${title} summary.</p><p>Downloads: 1821</p><p>Language: English</p></div></content>`,
    `<author><name>${author}</name></author>`,
    '<category scheme="http://purl.org/dc/terms/LCSH" term="Management"/>',
    "</entry>",
    "</feed>",
  ].join("");
}

function zLibrarySearchHtmlWithCount(count: number): string {
  return [
    "<!doctype html>",
    ...Array.from({ length: count }, (_unused, index) => {
      const item = index + 1;
      const isbn = `97875086010${String(item).padStart(2, "0")}`;
      return `<z-bookcard id="${item}" isbn="${isbn}" href="/book/z${item}/organization-handbook-${item}.html" publisher="机械工业出版社" language="Chinese" year="202${item % 10}" extension="epub" filesize="1.2 MB" rating="4.0" quality="4.0"><div slot="title">组织管理手册${item}</div><div slot="author">作者${item}</div></z-bookcard>`;
    }),
  ].join("");
}

function zLibraryDetailHtmlFor(index: number): string {
  const isbn = `97875086010${String(index).padStart(2, "0")}`;
  return [
    "<!doctype html>",
    `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Book","name":"组织管理手册${index}","description":"第${index}本书的详情摘要。","author":[{"@type":"Person","name":"作者${index}"}],"publisher":{"@type":"Organization","name":"机械工业出版社"},"isbn":"${isbn}","datePublished":202${index % 10}}</script>`,
    `<h1 class="book-title" itemprop="name">组织管理手册${index}</h1>`,
    `<i class="authors"><a class="color1" href="/author/作者${index}">作者${index}</a></i>`,
    `<div id="bookDescriptionBox">第${index}本书的详情摘要。</div>`,
    '<div class="bookDetailsBox">',
    `<div class="bookProperty property_year"><div class="property_label">Year:</div><div class="property_value">202${index % 10}</div></div>`,
    '<div class="bookProperty property_publisher"><div class="property_label">Publisher:</div><div class="property_value">机械工业出版社</div></div>',
    `<div class="bookProperty property_isbn 13"><div class="property_label">ISBN 13:</div><div class="property_value">${isbn}</div></div>`,
    "</div>",
  ].join("");
}

type SearchWithOptions = (
  query: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  options: {
    recordSourceStat: (entry: Record<string, unknown>) => Promise<void> | void;
  },
) => Promise<BookFinderResult>;

test("findBooksForQuery queries adapter sources, isolates failures, and records source availability without legacy providers", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const fetchCalls: string[] = [];
  const sourceStats: Array<Record<string, unknown>> = [];
  const search = findBooksForQuery as unknown as SearchWithOptions;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push(url);

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "management", keywords: ["management"], languagePreference: "en" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return jsonResponse({
        docs: [
          {
            key: "/works/OL1W",
            title: "Management",
            author_name: ["Peter Drucker"],
            publisher: ["HarperBusiness"],
            first_publish_year: 1973,
            subject: ["Management"],
            isbn: ["9780060112400"],
          },
        ],
      });
    }

    if (url === "https://annas-archive.gl/search?q=management") {
      return new Response(annaSearchHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://www.gutenberg.org/ebooks/search.opds/?query=management") {
      return new Response(gutenbergSearchFeed(), {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    }

    if (url === "https://www.gutenberg.org/ebooks/6435.opds") {
      return new Response(gutenbergDetailFeed(), {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    }

    if (url === "https://z-lib.fm/s/management") {
      return new Response("upstream unavailable", { status: 503 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await search("management", env, fetchImpl, {
    recordSourceStat: async (entry) => {
      sourceStats.push(entry);
    },
  });

  assert.deepEqual(
    result.results.map((book) => book.sourceLabel).sort(),
    ["Anna's Archive", "Open Library", "Project Gutenberg"],
  );
  assert.equal(fetchCalls.some((url) => url.includes("douban")), false);
  assert.equal(fetchCalls.some((url) => url.includes("weread")), false);
  assert.equal(fetchCalls.some((url) => url.includes("metadata")), false);

  const bySource = new Map(sourceStats.map((entry) => [String(entry.sourceId), entry]));
  assert.equal(bySource.get("open-library")?.status, "success");
  assert.equal(bySource.get("anna-archive")?.status, "success");
  assert.equal(bySource.get("project-gutenberg")?.status, "success");
  assert.equal(bySource.get("z-library")?.status, "failure");
});

test("findBooksForQuery routes Chinese queries through Z-Library and records empty sources without falling back to legacy providers", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const fetchCalls: string[] = [];
  const sourceStats: Array<Record<string, unknown>> = [];
  const search = findBooksForQuery as unknown as SearchWithOptions;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push(url);

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "组织管理", keywords: ["组织管理"], languagePreference: "zh" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return jsonResponse({ docs: [] });
    }

    if (url === "https://annas-archive.gl/search?q=%E7%BB%84%E7%BB%87%E7%AE%A1%E7%90%86") {
      return new Response("<!doctype html><div>Results 1-50 (0 total)</div>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://z-lib.fm/s/%E7%BB%84%E7%BB%87%E7%AE%A1%E7%90%86") {
      return new Response(zLibrarySearchHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://z-lib.fm/book/z123/organization-handbook.html") {
      return new Response(zLibraryDetailHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await search("组织管理", env, fetchImpl, {
    recordSourceStat: async (entry) => {
      sourceStats.push(entry);
    },
  });

  assert.equal(result.results[0]?.sourceLabel, "Z-Library");
  assert.equal(result.results[0]?.title, "组织管理手册");
  assert.equal(fetchCalls.some((url) => url.includes("douban")), false);
  assert.equal(fetchCalls.some((url) => url.includes("weread")), false);
  assert.equal(fetchCalls.some((url) => url.includes("metadata")), false);
  assert.equal(fetchCalls.some((url) => url.startsWith("https://www.gutenberg.org/ebooks/search.opds")), false);

  const bySource = new Map(sourceStats.map((entry) => [String(entry.sourceId), entry]));
  assert.equal(bySource.get("open-library")?.status, "empty");
  assert.equal(bySource.get("anna-archive")?.status, "empty");
  assert.equal(bySource.get("z-library")?.status, "success");
});

test("findBooksForQuery keeps successful candidates when source-stat recording fails", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const search = findBooksForQuery as unknown as SearchWithOptions;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "management", keywords: ["management"], languagePreference: "en" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return jsonResponse({
        docs: [
          {
            key: "/works/OL1W",
            title: "Management",
            author_name: ["Peter Drucker"],
          },
        ],
      });
    }

    if (url === "https://annas-archive.gl/search?q=management") {
      return new Response("<!doctype html><div>Results 1-50 (0 total)</div>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://www.gutenberg.org/ebooks/search.opds/?query=management") {
      return new Response('<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    }

    if (url === "https://z-lib.fm/s/management") {
      return new Response("busy", { status: 503 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await search("management", env, fetchImpl, {
    recordSourceStat: async (entry) => {
      if (entry.sourceId === "open-library") {
        throw new Error("stats storage unavailable");
      }
    },
  });

  assert.equal(result.results.some((book) => book.sourceId === "open-library"), true);
});

test("findBooksForQuery retries Open Library with a relaxed query after a 422 response", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const openLibraryQueries: string[] = [];
  const sourceStats: Array<Record<string, unknown>> = [];
  const search = findBooksForQuery as unknown as SearchWithOptions;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "management handbook", keywords: ["management", "handbook"], languagePreference: "en" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      const query = new URL(url).searchParams.get("q") ?? "";
      openLibraryQueries.push(query);
      if (query === "management handbook") {
        return jsonResponse({ error: "bad query" }, 422);
      }
      if (query === "management") {
        return jsonResponse({
          docs: [
            {
              key: "/works/OL1W",
              title: "Management",
              author_name: ["Peter Drucker"],
            },
          ],
        });
      }
      return jsonResponse({ docs: [] });
    }

    if (url === "https://annas-archive.gl/search?q=management+handbook") {
      return new Response("<!doctype html><div>Results 1-50 (0 total)</div>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://www.gutenberg.org/ebooks/search.opds/?query=management+handbook") {
      return new Response('<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    }

    if (url === "https://z-lib.fm/s/management%20handbook") {
      return new Response("busy", { status: 503 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await search("management handbook", env, fetchImpl, {
    recordSourceStat: async (entry) => {
      sourceStats.push(entry);
    },
  });

  assert.deepEqual(openLibraryQueries, ["management handbook", "management"]);
  assert.equal(result.results.some((book) => book.sourceId === "open-library"), true);

  const bySource = new Map(sourceStats.map((entry) => [String(entry.sourceId), entry]));
  assert.equal(bySource.get("open-library")?.status, "success");
});

test("findBooksForQuery falls back to Z-Library HTML fields when JSON-LD is partial", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const search = findBooksForQuery as unknown as SearchWithOptions;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "组织管理", keywords: ["组织管理"], languagePreference: "zh" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return jsonResponse({ docs: [] });
    }

    if (url === "https://annas-archive.gl/search?q=%E7%BB%84%E7%BB%87%E7%AE%A1%E7%90%86") {
      return new Response("<!doctype html><div>Results 1-50 (0 total)</div>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://z-lib.fm/s/%E7%BB%84%E7%BB%87%E7%AE%A1%E7%90%86") {
      return new Response(zLibrarySearchHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://z-lib.fm/book/z123/organization-handbook.html") {
      return new Response(zLibraryDetailHtmlWithPartialJsonLd(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await search("组织管理", env, fetchImpl, {
    recordSourceStat: async () => {},
  });

  assert.equal(result.results[0]?.description, "一本来自 HTML 详情页的摘要。");
  assert.equal(result.results[0]?.publishedYear, "2021");
  assert.equal(result.results[0]?.publisher, "中信出版社");
  assert.deepEqual(result.results[0]?.isbns, ["9787508600001"]);
});

test("findBooksForQuery normalizes relative Project Gutenberg acquisition links", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const search = findBooksForQuery as unknown as SearchWithOptions;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "management", keywords: ["management"], languagePreference: "en" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return jsonResponse({ docs: [] });
    }

    if (url === "https://annas-archive.gl/search?q=management") {
      return new Response("<!doctype html><div>Results 1-50 (0 total)</div>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://www.gutenberg.org/ebooks/search.opds/?query=management") {
      return new Response(gutenbergSearchFeed(), {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    }

    if (url === "https://www.gutenberg.org/ebooks/6435.opds") {
      return new Response(gutenbergDetailFeedWithRelativeAcquisition(), {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    }

    if (url === "https://z-lib.fm/s/management") {
      return new Response("busy", { status: 503 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await search("management", env, fetchImpl, {
    recordSourceStat: async () => {},
  });

  const gutenberg = result.results.find((book) => book.sourceId === "project-gutenberg");
  assert.equal(gutenberg?.previewLink, "https://www.gutenberg.org/ebooks/6435.epub.images");
});

test("findBooksForQuery keeps Project Gutenberg search candidates beyond the detail fetch limit", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const detailUrls: string[] = [];
  const entries = Array.from({ length: 7 }, (_unused, index) => ({
    ebookId: 7001 + index,
    title: `Management Volume ${index + 1}`,
    author: `Author ${index + 1}`,
  }));
  const search = findBooksForQuery as unknown as SearchWithOptions;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "management", keywords: ["management"], languagePreference: "en" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return jsonResponse({ docs: [] });
    }

    if (url === "https://annas-archive.gl/search?q=management") {
      return new Response("<!doctype html><div>Results 1-50 (0 total)</div>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://www.gutenberg.org/ebooks/search.opds/?query=management") {
      return new Response(gutenbergSearchFeedWithEntries(entries), {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    }

    if (url.startsWith("https://www.gutenberg.org/ebooks/") && url.endsWith(".opds")) {
      detailUrls.push(url);
      const entry = entries.find((candidate) => url === `https://www.gutenberg.org/ebooks/${candidate.ebookId}.opds`);
      if (!entry) {
        throw new Error(`Unexpected Gutenberg detail URL in test: ${url}`);
      }
      return new Response(gutenbergDetailFeedFor(entry.title, entry.author), {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      });
    }

    if (url === "https://z-lib.fm/s/management") {
      return new Response("busy", { status: 503 });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await search("management", env, fetchImpl, {
    recordSourceStat: async () => {},
  });

  assert.equal(result.results.some((book) => book.title === "Management Volume 7"), true);
  assert.deepEqual(detailUrls, entries.slice(0, 6).map((entry) => `https://www.gutenberg.org/ebooks/${entry.ebookId}.opds`));
});

test("findBooksForQuery keeps Z-Library search candidates beyond the detail fetch limit", async () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_BASE_URL: "https://llm.example.test/v1",
    OPENAI_TOKEN: "token",
    OPENAI_MODEL: "book-model",
  };

  const detailUrls: string[] = [];
  const search = findBooksForQuery as unknown as SearchWithOptions;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://llm.example.test/v1/chat/completions") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const prompt = body.messages?.[0]?.content ?? "";
      const content = prompt.includes("字段固定为 sections")
        ? JSON.stringify({ sections: [] })
        : JSON.stringify({ searchText: "组织管理", keywords: ["组织管理"], languagePreference: "zh" });
      return jsonResponse({ choices: [{ message: { content } }] });
    }

    if (url.startsWith("https://openlibrary.org/search.json")) {
      return jsonResponse({ docs: [] });
    }

    if (url === "https://annas-archive.gl/search?q=%E7%BB%84%E7%BB%87%E7%AE%A1%E7%90%86") {
      return new Response("<!doctype html><div>Results 1-50 (0 total)</div>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === "https://z-lib.fm/s/%E7%BB%84%E7%BB%87%E7%AE%A1%E7%90%86") {
      return new Response(zLibrarySearchHtmlWithCount(7), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url.startsWith("https://z-lib.fm/book/z")) {
      detailUrls.push(url);
      const match = url.match(/organization-handbook-(\d+)\.html$/u);
      const index = Number.parseInt(match?.[1] ?? "", 10);
      if (!Number.isFinite(index)) {
        throw new Error(`Unexpected Z-Library detail URL in test: ${url}`);
      }
      return new Response(zLibraryDetailHtmlFor(index), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const result = await search("组织管理", env, fetchImpl, {
    recordSourceStat: async () => {},
  });

  assert.equal(result.results.some((book) => book.title === "组织管理手册7"), true);
  assert.deepEqual(detailUrls, Array.from({ length: 6 }, (_unused, index) => {
    const item = index + 1;
    return `https://z-lib.fm/book/z${item}/organization-handbook-${item}.html`;
  }));
});
