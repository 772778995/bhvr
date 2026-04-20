import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_ACCOUNT_ID } from "./notebooklm/auth-manager.js";
import { createQueueAuthGate } from "./queue-auth-gate.js";

function withTempHome<T>(fn: (homeDir: string) => T | Promise<T>) {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const homeDir = mkdtempSync(join(tmpdir(), "notebooklm-index-auth-gate-"));

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  return Promise.resolve()
    .then(() => fn(homeDir))
    .finally(() => {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
      rmSync(homeDir, { recursive: true, force: true });
    });
}

test("queue auth gate uses normalized auth state for custom storage-state missing", async () => {
  await withTempHome(async (homeDir) => {
    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = join(homeDir, "app", "data", "storage-state.json");

    const profileDir = join(homeDir, ".notebooklm", "profiles", DEFAULT_ACCOUNT_ID);
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "auth-meta.json"), JSON.stringify({
      accountId: DEFAULT_ACCOUNT_ID,
      status: "ready",
      lastCheckedAt: "2026-04-20T10:00:00.000Z",
    }));

    try {
      const gate = createQueueAuthGate();
      assert.equal(await gate.isReauthRequired(), true);
    } finally {
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
    }
  });
});
