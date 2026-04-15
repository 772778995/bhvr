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
