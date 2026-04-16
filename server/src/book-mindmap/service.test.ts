import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBookMindmapFromSummary,
  parseMermaidMindmapPayload,
  type MermaidMindmapPayload,
} from "./service.js";

test("parseMermaidMindmapPayload extracts plain mindmap code", () => {
  const result = parseMermaidMindmapPayload("mindmap\n  root((书名))\n    核心主旨");
  assert.equal(result.kind, "mermaid_mindmap");
  assert.equal(result.version, 1);
  assert.match(result.code, /^mindmap/);
});

test("parseMermaidMindmapPayload strips fenced code block markers", () => {
  const result = parseMermaidMindmapPayload("```mermaid\nmindmap\n  root((书名))\n```");
  assert.equal(result.kind, "mermaid_mindmap");
  assert.match(result.code, /^mindmap/);
  assert.doesNotMatch(result.code, /```/);
});

test("parseMermaidMindmapPayload strips plain fenced markers", () => {
  const result = parseMermaidMindmapPayload("```\nmindmap\n  root((书名))\n```");
  assert.match(result.code, /^mindmap/);
});

test("parseMermaidMindmapPayload throws when code does not start with mindmap", () => {
  assert.throws(
    () => parseMermaidMindmapPayload("{\"title\": \"书名\"}"),
    /mindmap/,
  );
});

test("buildBookMindmapFromSummary requests openai-compatible mermaid and returns payload", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  const result = await buildBookMindmapFromSummary(
    "# 深度工作\n\n- 核心：专注创造稀缺价值。",
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
              content: "mindmap\n  root((深度工作))\n    核心主旨\n      专注创造稀缺价值",
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
  assert.match(JSON.stringify(calls[0]?.body.messages ?? []), /mindmap/);
  assert.equal(result.kind, "mermaid_mindmap");
  assert.match(result.code, /^mindmap/);
  assert.match(result.code, /深度工作/);
});

test("buildBookMindmapFromSummary handles fenced code block from model", async () => {
  const result = await buildBookMindmapFromSummary(
    "# 测试",
    {
      OPENAI_BASE_URL: "https://openai.example.com/v1",
      OPENAI_TOKEN: "token",
      OPENAI_MODEL: "mindmap-model",
    } as NodeJS.ProcessEnv,
    async () => new Response(JSON.stringify({
      choices: [{ message: { content: "```mermaid\nmindmap\n  root((测试))\n```" } }],
    }), { status: 200, headers: { "content-type": "application/json" } }),
  );

  assert.equal(result.kind, "mermaid_mindmap");
  assert.match(result.code, /^mindmap/);
  assert.doesNotMatch(result.code, /```/);
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

// Ensure the type is exported correctly (compile-time check)
const _typeCheck: MermaidMindmapPayload = { kind: "mermaid_mindmap", version: 1, code: "mindmap\n  root((test))" };
void _typeCheck;
