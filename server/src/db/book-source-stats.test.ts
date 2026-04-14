import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("recordBookSourceStat aggregates concurrent updates for the same source", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "notebooklm-book-source-stats-"));
  const databasePath = join(tempDir, "stats.db");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        [
          'const stats = await import("./src/db/book-source-stats.ts");',
          "await Promise.all([",
          '  stats.recordBookSourceStat({ sourceId: "open-library", sourceLabel: "Open Library", status: "success", latencyMs: 10 }),',
          '  stats.recordBookSourceStat({ sourceId: "open-library", sourceLabel: "Open Library", status: "empty", latencyMs: 11 }),',
          '  stats.recordBookSourceStat({ sourceId: "open-library", sourceLabel: "Open Library", status: "failure", latencyMs: 12, error: "timeout" }),',
          "]);",
          'const row = await stats.getBookSourceStat("open-library");',
          'console.log(JSON.stringify({ marker: "ROW", row }));',
        ].join(" "),
      ],
      {
        cwd: resolve(import.meta.dirname, "../.."),
        env: {
          ...process.env,
          DATABASE_PATH: databasePath,
        },
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const rowLine = result.stdout
      .split(/\r?\n/u)
      .find((line) => line.includes('"marker":"ROW"'));

    assert.ok(rowLine, result.stdout || result.stderr);

    const row = (JSON.parse(rowLine) as {
      marker: string;
      row: {
        sourceId: string;
        sourceLabel: string;
        attemptCount: number;
        successCount: number;
        emptyCount: number;
        failureCount: number;
      };
    }).row as {
      sourceId: string;
      sourceLabel: string;
      attemptCount: number;
      successCount: number;
      emptyCount: number;
      failureCount: number;
    };

    assert.equal(row.sourceId, "open-library");
    assert.equal(row.sourceLabel, "Open Library");
    assert.equal(row.attemptCount, 3);
    assert.equal(row.successCount, 1);
    assert.equal(row.emptyCount, 1);
    assert.equal(row.failureCount, 1);
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows may keep a transient lock on the sqlite file after the child exits.
    }
  }
});
