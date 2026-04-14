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

test("importing db/index refreshes builtin book presets with the latest prompts", async () => {
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

    assert.equal(quickPreset?.name, "书籍简述");
    assert.match(String(quickPreset?.description ?? ""), /300字/);
    assert.match(String(quickPreset?.prompt ?? ""), /300字以内/);
    assert.match(String(quickPreset?.prompt ?? ""), /关键案例/);
    assert.match(String(quickPreset?.prompt ?? ""), /适用人群/);

    assert.equal(deepPreset?.name, "详细解读");
    assert.match(String(deepPreset?.prompt ?? ""), /5000字以内/);
    assert.match(String(deepPreset?.prompt ?? ""), /延展阅读/);
    assert.match(String(deepPreset?.prompt ?? ""), /企业/);
  } finally {
    client.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows may keep a transient lock on the sqlite file after the child exits.
    }
  }
});
