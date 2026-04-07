import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getProfilePaths,
  readAuthMeta,
  writeAuthMeta,
} from "./auth-profile.js";

function withTempHome<T>(fn: (homeDir: string) => T | Promise<T>) {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const homeDir = mkdtempSync(join(tmpdir(), "notebooklm-auth-profile-"));

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

test("getProfilePaths resolves the default profile under ~/.notebooklm/profiles", async () => {
  await withTempHome((homeDir) => {
    const paths = getProfilePaths("default");

    assert.equal(paths.baseDir, join(homeDir, ".notebooklm", "profiles", "default"));
    assert.equal(paths.browserUserDataDir, join(paths.baseDir, "browser-user-data"));
    assert.equal(paths.storageStatePath, join(paths.baseDir, "storage-state.json"));
    assert.equal(paths.authMetaPath, join(paths.baseDir, "auth-meta.json"));
  });
});

test("readAuthMeta returns missing when auth metadata does not exist", async () => {
  await withTempHome(() => {
    assert.deepEqual(readAuthMeta("default"), {
      ok: true,
      value: {
        accountId: "default",
        status: "missing",
      },
    });
  });
});

test("writeAuthMeta round-trips persisted auth metadata", async () => {
  await withTempHome(() => {
    const writeResult = writeAuthMeta("default", {
      accountId: "default",
      status: "ready",
      lastCheckedAt: "2026-04-07T12:00:00.000Z",
      lastRefreshedAt: "2026-04-07T11:30:00.000Z",
      error: undefined,
    });

    assert.equal(writeResult.ok, true);

    assert.deepEqual(readAuthMeta("default"), {
      ok: true,
      value: {
        accountId: "default",
        status: "ready",
        lastCheckedAt: "2026-04-07T12:00:00.000Z",
        lastRefreshedAt: "2026-04-07T11:30:00.000Z",
      },
    });
  });
});

test("readAuthMeta rejects malformed metadata with explicit error state", async () => {
  await withTempHome(() => {
    const paths = getProfilePaths("default");
    writeAuthMeta("default", {
      accountId: "default",
      status: "ready",
      lastCheckedAt: "2026-04-07T12:00:00.000Z",
    });

    const broken = JSON.parse(readFileSync(paths.authMetaPath, "utf-8")) as Record<string, unknown>;
    broken.status = "bogus";

    writeAuthMeta("default", broken as never);

    assert.deepEqual(readAuthMeta("default"), {
      ok: false,
      error: {
        accountId: "default",
        status: "error",
        error: "Invalid auth metadata",
      },
    });
  });
});
