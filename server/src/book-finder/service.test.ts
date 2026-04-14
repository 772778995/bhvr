import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  listMissingBookFinderConfig,
  resetWorkspaceEnvCacheForTests,
  renderBookFinderMarkdown,
  type BookCandidate,
} from "./service.js";

function makeCandidate(id: string, overrides?: Partial<BookCandidate>): BookCandidate {
  return {
    id,
    sourceId: "open-library",
    sourceLabel: "Open Library",
    sourceReliability: 90,
    title: `Book ${id}`,
    authors: ["Author"],
    publisher: "Test Publisher",
    publishedYear: "2024",
    description: "A concise description for testing the book finder output.",
    categories: ["Business"],
    isbns: ["9787115560506"],
    averageRating: null,
    ratingsCount: null,
    ratingSourceLabel: null,
    ratingScale: null,
    infoLink: `https://example.com/books/${id}`,
    previewLink: null,
    ...overrides,
  };
}

test("renderBookFinderMarkdown renders a flat public-source list without legacy platform fields", () => {
  const candidate = makeCandidate("a", {
    sourceLabel: "Anna's Archive",
    averageRating: 4.7,
    ratingsCount: 245,
    ratingSourceLabel: "Anna's Archive",
    ratingScale: 5,
  });

  const markdown = renderBookFinderMarkdown("组织管理", [candidate]);

  assert.doesNotMatch(markdown, /^# 快速找书结果/m);
  assert.doesNotMatch(markdown, /^## /m);
  assert.match(markdown, /- 链接：\[Anna's Archive\]\(https:\/\/example.com\/books\/a\)/);
  assert.match(markdown, /- 【Anna's Archive】评分：4\.7\/5（245 条评价）/);
  assert.doesNotMatch(markdown, /微信读书/);
  assert.doesNotMatch(markdown, /豆瓣/);
  assert.doesNotMatch(markdown, /metadata bridge/);
});

test("renderBookFinderMarkdown omits rating lines when sources expose no public scores", () => {
  const candidate = makeCandidate("b", {
    sourceLabel: "Project Gutenberg",
    infoLink: "https://www.gutenberg.org/ebooks/6435",
  });

  const markdown = renderBookFinderMarkdown("management", [candidate]);

  assert.match(markdown, /- 链接：\[Project Gutenberg\]\(https:\/\/www\.gutenberg\.org\/ebooks\/6435\)/);
  assert.doesNotMatch(markdown, /- 评分：/);
  assert.doesNotMatch(markdown, /暂无公开数据/);
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
