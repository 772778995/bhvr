import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";

test("importing db/index initializes required tables for a fresh database", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "notebooklm-db-init-"));
  const databasePath = join(tempDir, "fresh.db");
  const client = createClient({ url: `file:${databasePath}` });

  try {
    const result = spawnSync(
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

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const response = await client.execute(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('research_tasks', 'questions', 'research_reports', 'notebook_source_states')
      ORDER BY name
    `);

    assert.deepEqual(response.rows.map((row) => row.name), [
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
