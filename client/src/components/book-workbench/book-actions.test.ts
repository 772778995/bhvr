import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getBookActionLabel } from "./book-actions.js";

test("getBookActionLabel exposes loading and idle labels for book brief and deep reading", () => {
  assert.equal(getBookActionLabel("quick-read", false), "书籍简述");
  assert.equal(getBookActionLabel("quick-read", true), "整理中...");
  assert.equal(getBookActionLabel("deep-reading", false), "详细解读");
  assert.equal(getBookActionLabel("deep-reading", true), "解读中...");
  assert.equal(getBookActionLabel("mindmap", false), "书籍导图");
  assert.equal(getBookActionLabel("mindmap", true), "导图生成中...");
});

test("getBookActionLabel restores idle labels after loading finishes", () => {
  assert.equal(getBookActionLabel("quick-read", false), "书籍简述");
  assert.equal(getBookActionLabel("deep-reading", false), "详细解读");
  assert.equal(getBookActionLabel("mindmap", false), "书籍导图");
  assert.notEqual(
    getBookActionLabel("quick-read", true),
    getBookActionLabel("quick-read", false),
  );
  assert.notEqual(
    getBookActionLabel("deep-reading", true),
    getBookActionLabel("deep-reading", false),
  );
  assert.notEqual(
    getBookActionLabel("mindmap", true),
    getBookActionLabel("mindmap", false),
  );
});

test("BookActionsPanel renders quick read and deep reading actions without the old nested card wrapper", () => {
  const source = readFileSync(new URL("./BookActionsPanel.vue", import.meta.url), "utf8");

  assert.match(source, /getBookActionLabel\("quick-read"/);
  assert.match(source, /getBookActionLabel\("deep-reading"/);
  assert.match(source, /getBookActionLabel\("mindmap"/);
  assert.match(source, /onDeepReading/);
  assert.match(source, /onMindmap/);
  assert.match(source, /onConfigureQuickRead/);
  assert.match(source, /onConfigureDeepReading/);
  assert.match(source, /historyEntries/);
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /onSelectEntry/);
  assert.match(source, /未命名阅读产出/);
  assert.match(source, /再生成书籍简述、详细解读或书籍导图。/);
  assert.match(source, /aria-label="配置书籍简述提示词"/);
  assert.match(source, /aria-label="配置详细解读提示词"/);
  assert.match(source, /onDeleteHistoryEntry/);
  assert.match(source, /aria-label="删除阅读产出"/);
  assert.match(source, /@click\.stop="onDeleteHistoryEntry\(entry\.id\)"/);
  assert.doesNotMatch(source, /class="mt-auto border border-\[#d4c6b1\] bg-\[#fbf6ed\] px-4 py-4"/);
  assert.doesNotMatch(source, /基于当前上传的书籍直接整理一份阅读摘要，不再要求先准备额外问答历史。/);
  assert.doesNotMatch(source, /再开始快速读书/);
});
