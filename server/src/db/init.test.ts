import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";

function runDbInit(databasePath: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "-e", 'await import("./src/db/index.ts")'],
    {
      cwd: resolve(import.meta.dirname, "../.."),
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
      },
      encoding: "utf8",
    }
  );
}

test("importing db/index initializes required tables for a fresh database", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "notebooklm-db-init-"));
  const databasePath = join(tempDir, "fresh.db");
  const client = createClient({ url: `file:${databasePath}` });

  try {
    const result = runDbInit(databasePath);

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const response = await client.execute(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('book_source_stats', 'research_tasks', 'questions', 'research_reports', 'notebook_source_states')
      ORDER BY name
    `);

    assert.deepEqual(response.rows.map((row) => row.name), [
      "book_source_stats",
      "notebook_source_states",
      "questions",
      "research_reports",
      "research_tasks",
    ]);
  } finally {
    client.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows may keep a transient lock on the sqlite file after the child exits.
    }
  }
});

test("importing db/index keeps user-updated builtin book preset prompts across restarts", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "notebooklm-db-preset-refresh-"));
  const databasePath = join(tempDir, "preset-refresh.db");
  const client = createClient({ url: `file:${databasePath}` });

  try {
    let result = runDbInit(databasePath);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    await client.execute({
      sql: "UPDATE summary_presets SET name = ?, description = ?, prompt = ? WHERE id = ?",
      args: ["快速读书", "旧说明", "旧的书籍简述 prompt", "builtin-quick-read"],
    });
    await client.execute({
      sql: "UPDATE summary_presets SET prompt = ? WHERE id = ?",
      args: ["旧的详细解读 prompt", "builtin-deep-reading"],
    });

    result = runDbInit(databasePath);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const quickPreset = (await client.execute({
      sql: "SELECT name, description, prompt FROM summary_presets WHERE id = ?",
      args: ["builtin-quick-read"],
    })).rows[0];
    const deepPreset = (await client.execute({
      sql: "SELECT name, description, prompt FROM summary_presets WHERE id = ?",
      args: ["builtin-deep-reading"],
    })).rows[0];

    assert.equal(quickPreset?.name, "快速读书");
    assert.equal(String(quickPreset?.description ?? ""), "旧说明");
    assert.equal(String(quickPreset?.prompt ?? ""), "旧的书籍简述 prompt");

    assert.equal(deepPreset?.name, "详细解读");
    assert.equal(String(deepPreset?.prompt ?? ""), "旧的详细解读 prompt");
  } finally {
    client.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows may keep a transient lock on the sqlite file after the child exits.
    }
  }
});

test("importing db/index seeds the builtin book mindmap preset", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "notebooklm-db-mindmap-preset-"));
  const databasePath = join(tempDir, "mindmap-preset.db");
  const client = createClient({ url: `file:${databasePath}` });

  try {
    const result = runDbInit(databasePath);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const preset = (await client.execute({
      sql: "SELECT name, description, prompt FROM summary_presets WHERE id = ?",
      args: ["builtin-book-mindmap"],
    })).rows[0];

    assert.equal(preset?.name, "书籍导图");
    assert.match(String(preset?.description ?? ""), /结构化摘要/);
    assert.match(String(preset?.prompt ?? ""), /核心主旨/);
    assert.match(String(preset?.prompt ?? ""), /关键概念/);
    assert.match(String(preset?.prompt ?? ""), /论证脉络/);
  } finally {
    client.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows may keep a transient lock on the sqlite file after the child exits.
    }
  }
});

test("importing db/index seeds stronger builtin book reading prompts", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "notebooklm-db-book-reading-prompts-"));
  const databasePath = join(tempDir, "book-reading-prompts.db");
  const client = createClient({ url: `file:${databasePath}` });

  try {
    const result = runDbInit(databasePath);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const quickPreset = (await client.execute({
      sql: "SELECT prompt FROM summary_presets WHERE id = ?",
      args: ["builtin-quick-read"],
    })).rows[0];
    const deepPreset = (await client.execute({
      sql: "SELECT prompt FROM summary_presets WHERE id = ?",
      args: ["builtin-deep-reading"],
    })).rows[0];

    const quickPrompt = String(quickPreset?.prompt ?? "");
    const deepPrompt = String(deepPreset?.prompt ?? "");

    assert.match(quickPrompt, /如果某项信息无法从当前来源确认，明确写“信息不足”/);
    assert.match(quickPrompt, /不要补充作者背景、出版信息、外部评价或延伸资料/);

    assert.match(deepPrompt, /不要推荐额外书单或外部资料/);
    assert.match(deepPrompt, /凡是当前来源无法确认的章节细节、案例、引文或背景信息，都不要补写/);
    assert.equal(
      String((await client.execute({
        sql: "SELECT description FROM summary_presets WHERE id = ?",
        args: ["builtin-deep-reading"],
      })).rows[0]?.description ?? ""),
      "5000字内的结构化深度解读，覆盖论证、概念、边界与实践启发",
    );
  } finally {
    client.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows may keep a transient lock on the sqlite file after the child exits.
    }
  }
});

test("importing db/index upgrades untouched legacy builtin book prompts on existing databases", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "notebooklm-db-legacy-book-prompts-"));
  const databasePath = join(tempDir, "legacy-book-prompts.db");
  const client = createClient({ url: `file:${databasePath}` });

  try {
    let result = runDbInit(databasePath);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    await client.execute({
      sql: "UPDATE summary_presets SET prompt = ? WHERE id = ?",
      args: [
        `请忽略此前任何对话、提问、回答和中间研究结论，只根据本笔记本当前来源中的文档内容，输出一份中文《书籍简述》。\n\n请你根据当前来源自行识别并填写书名与作者；若信息不足，请明确说明。\n\n请简述《书名》，作者：[作者名]。\n要求：\n- 核心观点：用1-2句话概括全书主旨\n- 内容结构：分3-4个要点说明主要章节或论点\n- 关键案例：列举2-3个书中代表性例子\n- 适用人群：这本书适合谁读\n- 使用 Markdown\n- 字数控制在300字以内\n- 语言理性、准确、精炼\n- 所有内容必须基于笔记本中的文档来源，不得凭空捏造`,
        "builtin-quick-read",
      ],
    });
    await client.execute({
      sql: "UPDATE summary_presets SET prompt = ?, description = ? WHERE id = ?",
      args: [
        `请忽略此前任何对话、提问、回答和中间研究结论，只根据本笔记本当前来源中的文档内容，输出一份中文《详细解读》报告。\n\n请按以下结构深度解析一本书籍，总字数控制在5000字以内，确保10分钟内可读完：\n\n【基础信息】\n- 书名及英文原版名（如有）\n- 作者姓名及背景简介\n- 出版时间\n\n【结构与内容】\n1. 核心主旨：一句话概括全书思想内核\n2. 目录脉络：\n   - 全书分几部分、几章，章节间逻辑关系（递进、平行、问题-解决等）\n   - 逐章提炼：每章2-3个核心观点 + 1句金句，每章300字以上\n3. 独创贡献：列出书中原创概念、模型、工具，并做简要阐释\n\n【价值与意义】\n- 对企业的应用价值\n- 对个人工作的具体用处\n- 局限性及适用边界\n\n【延展阅读】\n推荐3-5本同主题相关书籍\n\n写作要求：\n- 使用 Markdown\n- 每条目不超过200字，多用短句\n- 分论点展开，拒绝信息堆砌\n- 语言理性、准确、精炼，不发散\n- 所有内容必须基于笔记本中的文档来源，不得凭空捏造`,
        "5000字内的结构化深度解读，覆盖脉络、价值、边界与延展阅读",
        "builtin-deep-reading",
      ],
    });

    result = runDbInit(databasePath);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const quickPreset = (await client.execute({
      sql: "SELECT prompt FROM summary_presets WHERE id = ?",
      args: ["builtin-quick-read"],
    })).rows[0];
    const deepPreset = (await client.execute({
      sql: "SELECT description, prompt FROM summary_presets WHERE id = ?",
      args: ["builtin-deep-reading"],
    })).rows[0];

    assert.match(String(quickPreset?.prompt ?? ""), /如果某项信息无法从当前来源确认，明确写“信息不足”/);
    assert.match(String(deepPreset?.prompt ?? ""), /不要推荐额外书单或外部资料/);
    assert.equal(String(deepPreset?.description ?? ""), "5000字内的结构化深度解读，覆盖论证、概念、边界与实践启发");
  } finally {
    client.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows may keep a transient lock on the sqlite file after the child exits.
    }
  }
});
