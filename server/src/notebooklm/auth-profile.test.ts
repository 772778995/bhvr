import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getDefaultStorageStatePath,
  getProfilePaths,
  prepareStorageStateFromEnv,
  readAuthMeta,
  readStorageState,
  writeAuthMeta,
  writeStorageState,
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

// ---------------------------------------------------------------------------
// Docker / env-var storage state injection tests
// ---------------------------------------------------------------------------

test("getDefaultStorageStatePath returns NOTEBOOKLM_STORAGE_STATE_PATH when set", async () => {
  await withTempHome(() => {
    const original = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = "/custom/path/storage-state.json";
    try {
      const result = getDefaultStorageStatePath();
      assert.equal(result, "/custom/path/storage-state.json");
    } finally {
      if (original === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = original;
      }
    }
  });
});

test("getDefaultStorageStatePath returns default profile path when env not set", async () => {
  await withTempHome((homeDir) => {
    const original = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    try {
      const result = getDefaultStorageStatePath();
      assert.equal(result, join(homeDir, ".notebooklm", "profiles", "default", "storage-state.json"));
    } finally {
      if (original !== undefined) {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = original;
      }
    }
  });
});

test("prepareStorageStateFromEnv writes base64 content to target path when file does not exist", async () => {
  await withTempHome((homeDir) => {
    const storageState = { cookies: [{ name: "SID", value: "abc", domain: ".google.com" }] };
    const b64 = Buffer.from(JSON.stringify(storageState)).toString("base64");
    const targetPath = join(homeDir, "test-storage-state.json");

    const original = process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
    process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = b64;
    try {
      prepareStorageStateFromEnv(targetPath);
      assert.ok(existsSync(targetPath));
      const written = JSON.parse(readFileSync(targetPath, "utf-8"));
      assert.deepEqual(written, storageState);
    } finally {
      if (original === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = original;
      }
    }
  });
});

test("prepareStorageStateFromEnv does NOT overwrite existing file", async () => {
  await withTempHome((homeDir) => {
    const existing = { cookies: [{ name: "OLD", value: "old", domain: ".google.com" }] };
    const newContent = { cookies: [{ name: "NEW", value: "new", domain: ".google.com" }] };
    const targetPath = join(homeDir, "existing-storage-state.json");
    writeFileSync(targetPath, JSON.stringify(existing));

    const b64 = Buffer.from(JSON.stringify(newContent)).toString("base64");
    const original = process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
    process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = b64;
    try {
      prepareStorageStateFromEnv(targetPath);
      const content = JSON.parse(readFileSync(targetPath, "utf-8"));
      assert.deepEqual(content, existing);
    } finally {
      if (original === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = original;
      }
    }
  });
});

test("prepareStorageStateFromEnv throws on invalid base64 content", async () => {
  await withTempHome((homeDir) => {
    const targetPath = join(homeDir, "missing.json");
    const original = process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
    // Invalid base64: characters not in base64 alphabet
    process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = "!!!not-valid-base64!!!";
    try {
      assert.throws(() => prepareStorageStateFromEnv(targetPath), /invalid base64/i);
    } finally {
      if (original === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = original;
      }
    }
  });
});

test("prepareStorageStateFromEnv throws on valid base64 but invalid JSON", async () => {
  await withTempHome((homeDir) => {
    const targetPath = join(homeDir, "missing.json");
    const b64 = Buffer.from("not json at all {{{").toString("base64");
    const original = process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
    process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = b64;
    try {
      assert.throws(() => prepareStorageStateFromEnv(targetPath), /invalid json/i);
    } finally {
      if (original === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = original;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// NOTEBOOKLM_STORAGE_STATE_PATH unified path coverage (fix for broken read/write)
// ---------------------------------------------------------------------------

test("getProfilePaths(default).storageStatePath uses NOTEBOOKLM_STORAGE_STATE_PATH when set", async () => {
  await withTempHome((homeDir) => {
    const customPath = join(homeDir, "custom", "my-storage-state.json");
    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = customPath;
    try {
      const paths = getProfilePaths("default");
      assert.equal(paths.storageStatePath, customPath);
      // Other paths must remain under the profile base dir
      assert.equal(paths.browserUserDataDir, join(homeDir, ".notebooklm", "profiles", "default", "browser-user-data"));
      assert.equal(paths.authMetaPath, join(homeDir, ".notebooklm", "profiles", "default", "auth-meta.json"));
    } finally {
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
    }
  });
});

test("getProfilePaths(non-default).storageStatePath is NOT affected by NOTEBOOKLM_STORAGE_STATE_PATH", async () => {
  await withTempHome((homeDir) => {
    const customPath = join(homeDir, "custom", "my-storage-state.json");
    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = customPath;
    try {
      const paths = getProfilePaths("other-account");
      assert.equal(
        paths.storageStatePath,
        join(homeDir, ".notebooklm", "profiles", "other-account", "storage-state.json")
      );
    } finally {
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
    }
  });
});

test("writeStorageState and readStorageState round-trip via custom NOTEBOOKLM_STORAGE_STATE_PATH", async () => {
  await withTempHome((homeDir) => {
    // Custom path whose parent directory does not yet exist
    const customPath = join(homeDir, "nested", "subdir", "storage-state.json");
    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = customPath;
    try {
      const storageState = { cookies: [{ name: "SAPISID", value: "custom-path-cookie", domain: ".google.com" }] };
      writeStorageState("default", storageState);
      assert.ok(existsSync(customPath), "file should be written to custom path");
      const result = readStorageState("default");
      assert.equal(result.ok, true);
      assert.deepEqual(result.value, storageState);
    } finally {
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
    }
  });
});
