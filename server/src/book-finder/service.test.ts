import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  listMissingBookFinderConfig,
  resetWorkspaceEnvCacheForTests,
  renderBookFinderMarkdown,
  sanitizeBookSelection,
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
    averageRating: 4.5,
    ratingsCount: 120,
    infoLink: `https://example.com/books/${id}`,
    previewLink: `https://example.com/books/${id}/preview`,
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

test("renderBookFinderMarkdown marks unverified 微信读书 fields instead of inventing them", () => {
  const candidate = makeCandidate("a", {
    sourceLabel: "Google Books",
    averageRating: 4.7,
    ratingsCount: 245,
  });

  const markdown = renderBookFinderMarkdown("组织管理", {
    foundation: [candidate],
    practice: [candidate],
    logic: [candidate],
    topRated: [candidate],
  });

  assert.match(markdown, /微信读书：未核验/);
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
    foundation: foundationBooks,
    practice: [],
    logic: [],
    topRated: [],
  });

  assert.match(markdown, /\*\*《组织的逻辑》\*\*[\s\S]*?\n---\n\n2\. \*\*《管理的实践》\*\*/);
  assert.doesNotMatch(markdown, /详情：https?:\/\//);
  assert.doesNotMatch(markdown, /预览：https?:\/\//);
  assert.doesNotMatch(markdown, /books\.google\.com/);
  assert.doesNotMatch(markdown, /openlibrary\.org\/example-b/);
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
