import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDatabasePath } from "./path.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("resolveDatabasePath is stable regardless of process cwd", () => {
  const originalCwd = process.cwd();
  const originalDatabasePath = process.env.DATABASE_PATH;

  delete process.env.DATABASE_PATH;

  try {
    process.chdir(resolve(__dirname, "../.."));
    const fromServerRoot = resolveDatabasePath();

    process.chdir(resolve(__dirname, "../../.."));
    const fromRepoRoot = resolveDatabasePath();

    assert.equal(fromServerRoot, fromRepoRoot);
    assert.equal(fromRepoRoot, resolve(__dirname, "../../../data/notebooklm.db"));
  } finally {
    process.chdir(originalCwd);
    if (originalDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = originalDatabasePath;
    }
  }
});
