import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBookMindmapFromSummary,
  normalizeBookMindmapPayload,
  type BookMindmapPayload,
} from "./service.js";

test("normalizeBookMindmapPayload trims labels, truncates copy, and drops invalid children", () => {
  const payload = normalizeBookMindmapPayload({
    title: "  深度参与  ",
    root: {
      label: "  深度参与  ",
      note: "A".repeat(300),
      children: [
        {
          label: "  组织反馈  ",
          note: "B".repeat(400),
          children: [
            { label: "   ", note: "无效节点", children: [] },
            { label: "实践", children: "not-array" as unknown as [] },
          ],
        },
      ],
    },
  });

  assert.equal(payload.kind, "book_mindmap");
  assert.equal(payload.version, 1);
  assert.equal(payload.title, "深度参与");
  assert.equal(payload.root.label, "深度参与");
  assert.equal(payload.root.note?.length, 160);
  assert.equal(payload.root.children.length, 1);
  assert.equal(payload.root.children[0]?.label, "组织反馈");
  assert.equal(payload.root.children[0]?.note?.length, 160);
  assert.deepEqual(payload.root.children[0]?.children, [{ label: "实践", children: [] }]);
});

test("normalizeBookMindmapPayload enforces a usable root node", () => {
  assert.throws(
    () => normalizeBookMindmapPayload({ root: { label: "   ", children: [] } }),
    /书籍导图 JSON 缺少有效根节点/,
  );
});

test("buildBookMindmapFromSummary requests openai-compatible json and returns cleaned tree", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  const result = await buildBookMindmapFromSummary(
    "# 深度参与\n\n- 核心主旨：把工作拆到足够诚实。",
    {
      OPENAI_BASE_URL: "https://openai.example.com/v1",
      OPENAI_TOKEN: "token",
      OPENAI_MODEL: "mindmap-model",
    } as NodeJS.ProcessEnv,
    async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });

      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "深度参与",
                root: {
                  label: "深度参与",
                  note: "把工作拆到足够诚实。",
                  children: [{ label: "核心问题", note: "为什么组织失去反馈。", children: [] }],
                },
              } satisfies Partial<BookMindmapPayload>),
            },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://openai.example.com/v1/chat/completions");
  assert.equal(calls[0]?.body.model, "mindmap-model");
  assert.match(JSON.stringify(calls[0]?.body.messages ?? []), /book_mindmap/);
  assert.match(JSON.stringify(calls[0]?.body.messages ?? []), /children/);
  assert.equal(result.kind, "book_mindmap");
  assert.equal(result.root.children[0]?.label, "核心问题");
});

test("buildBookMindmapFromSummary surfaces explicit config errors", async () => {
  await assert.rejects(
    () => buildBookMindmapFromSummary("# 摘要", {} as NodeJS.ProcessEnv),
    /书籍导图依赖 OPENAI_BASE_URL \/ OPENAI_TOKEN \/ OPENAI_MODEL 配置/,
  );
});

test("buildBookMindmapFromSummary does not read workspace env when a custom env object is provided", async () => {
  let called = false;

  await assert.rejects(
    () => buildBookMindmapFromSummary("# 摘要", {} as NodeJS.ProcessEnv, async () => {
      called = true;
      return new Response(null, { status: 500 });
    }),
    /书籍导图依赖 OPENAI_BASE_URL \/ OPENAI_TOKEN \/ OPENAI_MODEL 配置/,
  );

  assert.equal(called, false);
});
