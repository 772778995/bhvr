import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getLegacyStorageStatePath, getProfilePaths, readAuthMeta, readStorageState } from "./auth-profile.js";

type TestPlaywrightImporter = typeof import("./client.js").__testOnly.importPlaywright;

function withTempHome<T>(fn: (homeDir: string) => T | Promise<T>) {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const homeDir = mkdtempSync(join(tmpdir(), "notebooklm-client-refresh-"));

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

test("silent refresh reuses browser-user-data and exports updated storage state", async () => {
  await withTempHome(async () => {
    const paths = getProfilePaths("default");
    mkdirSync(paths.browserUserDataDir, { recursive: true });
    writeFileSync(
      paths.storageStatePath,
      JSON.stringify({
        cookies: [{ name: "SID", value: "old-cookie", domain: ".google.com" }],
      })
    );

    const clientModule = await import("./client.js");

    const originalFetch = globalThis.fetch;
    const originalImport = clientModule.__testOnly.importPlaywright;
    let launchUserDataDir: string | null = null;
    let fetchCalls = 0;

    clientModule.__testOnly.importPlaywright = ((async () => ({
      chromium: {
        launchPersistentContext: async (userDataDir: string) => {
          launchUserDataDir = userDataDir;

          return {
            newPage: async () => ({
              goto: async () => {},
              url: () => "https://notebooklm.google.com/",
              content: async () => '<html><script>var data = {"SNlM0e":"fresh-token:1712491200000"}</script></html>',
              context: () => ({
                storageState: async () => ({
                  cookies: [
                    { name: "SAPISID", value: "new-cookie", domain: ".google.com" },
                  ],
                }),
              }),
            }),
            storageState: async () => ({
              cookies: [
                { name: "SAPISID", value: "new-cookie", domain: ".google.com" },
              ],
            }),
            close: async () => {},
          };
        },
      },
    })) as unknown) as TestPlaywrightImporter;

    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("silent refresh should not need raw token fetch when browser context is available");
    };

    try {
      const result = await clientModule.__testOnly.silentRefreshForTests("default");

      assert.equal(launchUserDataDir, paths.browserUserDataDir);
      assert.equal(result.authToken, "fresh-token:1712491200000");
      assert.equal(fetchCalls, 0);

      const stored = readStorageState("default");
      assert.equal(stored.ok, true);
      assert.deepEqual(stored.ok ? stored.value : null, {
        cookies: [
          { name: "SAPISID", value: "new-cookie", domain: ".google.com" },
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
      clientModule.__testOnly.importPlaywright = originalImport;
    }
  });
});

test("fresh legacy login replaces stale profile storage state on startup", async () => {
  await withTempHome(async () => {
    const paths = getProfilePaths("default");
    mkdirSync(paths.baseDir, { recursive: true });

    writeFileSync(
      paths.storageStatePath,
      JSON.stringify({
        cookies: [{ name: "SAPISID", value: "stale-cookie", domain: ".google.com" }],
      })
    );
    writeFileSync(
      paths.authMetaPath,
      JSON.stringify({
        accountId: "default",
        status: "reauth_required",
        error: "Authentication requires manual re-login",
      })
    );

    const legacyPath = getLegacyStorageStatePath();
    writeFileSync(
      legacyPath,
      JSON.stringify({
        cookies: [{ name: "SAPISID", value: "fresh-cookie", domain: ".google.com" }],
      })
    );

    const newer = new Date("2026-04-07T10:10:00.000Z");
    const older = new Date("2026-04-07T09:50:00.000Z");
    statSync(legacyPath);
    utimesSync(paths.storageStatePath, older, older);
    utimesSync(legacyPath, newer, newer);

    const clientModule = await import("./client.js");
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () =>
      new Response('<html><script>var data = {"SNlM0e":"fresh-token:1712491200000"}</script></html>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    try {
      const status = await clientModule.getAuthStatus();
      const stored = JSON.parse(readFileSync(paths.storageStatePath, "utf-8"));

      assert.equal(status.status, "expired");
      assert.deepEqual(stored, {
        cookies: [{ name: "SAPISID", value: "fresh-cookie", domain: ".google.com" }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("getAuthStatus prepares storage state from NOTEBOOKLM_STORAGE_STATE_JSON_B64 env var before checking auth", async () => {
  await withTempHome(async (homeDir) => {
    const storageState = {
      cookies: [{ name: "SAPISID", value: "env-secret-cookie", domain: ".google.com" }],
    };
    const b64 = Buffer.from(JSON.stringify(storageState)).toString("base64");

    const paths = getProfilePaths("default");
    const originalB64 = process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
    process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = b64;

    const clientModule = await import("./client.js");
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () =>
      new Response('<html><script>var data = {"SNlM0e":"token:123"}</script></html>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    try {
      await clientModule.getAuthStatus();

      // The env secret should have been written to the default profile path
      assert.ok(existsSync(paths.storageStatePath), "storage-state.json should be written from env var");
      const written = JSON.parse(readFileSync(paths.storageStatePath, "utf-8"));
      assert.deepEqual(written, storageState);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalB64 === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = originalB64;
      }
    }
  });
});

test("getAuthStatus with both PATH and B64 set writes to custom path and reads from same custom path", async () => {
  await withTempHome(async (homeDir) => {
    const storageState = {
      cookies: [{ name: "SAPISID", value: "custom-path-secret", domain: ".google.com" }],
    };
    const b64 = Buffer.from(JSON.stringify(storageState)).toString("base64");
    const customPath = join(homeDir, "secrets", "storage-state.json");

    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    const originalB64 = process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = customPath;
    process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = b64;

    const clientModule = await import("./client.js");
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () =>
      new Response('<html><script>var data = {"SNlM0e":"token:456"}</script></html>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    try {
      await clientModule.getAuthStatus();

      // File must be at custom path, NOT at default profile path
      assert.ok(existsSync(customPath), "file should be written to custom PATH");
      const written = JSON.parse(readFileSync(customPath, "utf-8"));
      assert.deepEqual(written, storageState);

      // Default profile path must NOT exist (read/write unified to custom path)
      const defaultProfileStoragePath = join(
        homeDir, ".notebooklm", "profiles", "default", "storage-state.json"
      );
      assert.equal(existsSync(defaultProfileStoragePath), false,
        "storage-state.json must NOT be written to default profile path when custom PATH is set");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
      if (originalB64 === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64 = originalB64;
      }
    }
  });
});

test("getAuthStatus treats a missing custom storage-state path as reauth_required instead of leaking ENOENT", async () => {
  await withTempHome(async (homeDir) => {
    const customPath = join(homeDir, "app", "data", "storage-state.json");
    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = customPath;

    const profile = getProfilePaths("default");
    mkdirSync(profile.baseDir, { recursive: true });
    writeFileSync(profile.authMetaPath, JSON.stringify({
      accountId: "default",
      status: "ready",
      lastCheckedAt: "2026-04-20T10:00:00.000Z",
    }));

    writeFileSync(
      getLegacyStorageStatePath(),
      JSON.stringify({
        cookies: [{ name: "SAPISID", value: "legacy-cookie", domain: ".google.com" }],
      })
    );

    const clientModule = await import("./client.js");

    try {
      const status = await clientModule.getAuthStatus();

      assert.equal(status.status, "reauth_required");
      assert.match(status.error ?? "", /No authentication found/i);
      assert.equal(existsSync(customPath), false);
    } finally {
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
    }
  });
});

test("getAuthStatus treats a fresh deploy missing custom storage-state path as reauth_required", async () => {
  await withTempHome(async (homeDir) => {
    const customPath = join(homeDir, "app", "data", "storage-state.json");
    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = customPath;

    const clientModule = await import("./client.js");

    try {
      const status = await clientModule.getAuthStatus();

      assert.equal(status.status, "reauth_required");
      assert.match(status.error ?? "", /No authentication found/i);
      assert.equal("reason" in status, false);
      assert.equal(existsSync(customPath), false);

      assert.deepEqual(readAuthMeta("default"), {
        ok: true,
        value: {
          accountId: "default",
          status: "reauth_required",
          error: 'No authentication found. Run "npx notebooklm login" first.',
          reason: "storage_state_missing",
        },
      });
    } finally {
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
    }
  });
});

test("getAuthStatus preserves explicit missing state after credentials are cleared on custom storage path", async () => {
  await withTempHome(async (homeDir) => {
    const customPath = join(homeDir, "app", "data", "storage-state.json");
    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = customPath;

    const profile = getProfilePaths("default");
    mkdirSync(profile.baseDir, { recursive: true });
    writeFileSync(profile.authMetaPath, JSON.stringify({
      accountId: "default",
      status: "missing",
      lastCheckedAt: "2026-04-20T10:00:00.000Z",
    }));

    const clientModule = await import("./client.js");

    try {
      const status = await clientModule.getAuthStatus();

      assert.equal(status.status, "missing");
      assert.equal(status.error, undefined);
      assert.equal("reason" in status, false);
    } finally {
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
    }
  });
});

test("getAuthStatus clears missing-file reauth_required once custom storage-state reappears", async () => {
  await withTempHome(async (homeDir) => {
    const customPath = join(homeDir, "app", "data", "storage-state.json");
    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = customPath;

    const profile = getProfilePaths("default");
    mkdirSync(profile.baseDir, { recursive: true });
    writeFileSync(profile.authMetaPath, JSON.stringify({
      accountId: "default",
      status: "ready",
      lastCheckedAt: "2026-04-20T10:00:00.000Z",
    }));

    const clientModule = await import("./client.js");

    try {
      const missingStatus = await clientModule.getAuthStatus();
      assert.equal(missingStatus.status, "reauth_required");
      assert.match(missingStatus.error ?? "", /No authentication found/i);

      mkdirSync(join(homeDir, "app", "data"), { recursive: true });
      writeFileSync(customPath, JSON.stringify({
        cookies: [{ name: "SAPISID", value: "restored-cookie", domain: ".google.com" }],
      }));

      const restoredStatus = await clientModule.getAuthStatus();
      assert.equal(restoredStatus.status, "expired");
      assert.equal(restoredStatus.error, "Stored credentials require validation");
    } finally {
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
    }
  });
});

test("getAuthStatus clears temporary missing-file reauth_required using internal reason, not error copy", async () => {
  await withTempHome(async (homeDir) => {
    const customPath = join(homeDir, "app", "data", "storage-state.json");
    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = customPath;

    const profile = getProfilePaths("default");
    mkdirSync(profile.baseDir, { recursive: true });
    writeFileSync(profile.authMetaPath, JSON.stringify({
      accountId: "default",
      status: "reauth_required",
      reason: "storage_state_missing",
      error: "custom text that should not control recovery",
      lastCheckedAt: "2026-04-20T10:00:00.000Z",
    }));

    mkdirSync(join(homeDir, "app", "data"), { recursive: true });
    writeFileSync(customPath, JSON.stringify({
      cookies: [{ name: "SAPISID", value: "restored-cookie", domain: ".google.com" }],
    }));

    const clientModule = await import("./client.js");

    try {
      const status = await clientModule.getAuthStatus();
      assert.equal(status.status, "expired");
      assert.equal(status.error, "Stored credentials require validation");
    } finally {
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
    }
  });
});

test("getAuthStatus does not collapse unrelated error state when custom storage-state path is missing", async () => {
  await withTempHome(async (homeDir) => {
    const customPath = join(homeDir, "app", "data", "storage-state.json");
    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = customPath;

    const profile = getProfilePaths("default");
    mkdirSync(profile.baseDir, { recursive: true });
    writeFileSync(profile.authMetaPath, JSON.stringify({
      accountId: "default",
      status: "error",
      error: "Invalid auth metadata",
      lastCheckedAt: "2026-04-20T10:00:00.000Z",
    }));

    const clientModule = await import("./client.js");

    try {
      const status = await clientModule.getAuthStatus();
      assert.equal(status.status, "error");
      assert.equal(status.error, "Invalid auth metadata");
    } finally {
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
    }
  });
});

test("createRuntimeClient falls back to browser token extraction when raw token fetch is unsupported", async () => {
  await withTempHome(async () => {
    const paths = getProfilePaths("default");
    mkdirSync(paths.baseDir, { recursive: true });
    writeFileSync(
      paths.storageStatePath,
      JSON.stringify({
        cookies: [{ name: "SAPISID", value: "fresh-cookie", domain: ".google.com" }],
      })
    );

    const clientModule = await import("./client.js");
    const originalFetch = globalThis.fetch;
    const notebooklmKit = await import("notebooklm-kit");
    const originalConnect = notebooklmKit.NotebookLMClient.prototype.connect;
    const originalImport = clientModule.__testOnly.importPlaywright;
    let userAgent = "";
    let fetchCalls = 0;
    let launched = false;

    clientModule.__testOnly.importPlaywright = ((async () => ({
      chromium: {
        launchPersistentContext: async () => {
          launched = true;

          return {
            newPage: async () => ({
              goto: async () => {},
              url: () => "https://notebooklm.google.com/",
              content: async () => '<html><script>var data = {"SNlM0e":"browser-token:1712491200000"}</script></html>',
            }),
            storageState: async () => ({
              cookies: [
                { name: "SAPISID", value: "browser-cookie", domain: ".google.com" },
              ],
            }),
            close: async () => {},
          };
        },
      },
    })) as unknown) as TestPlaywrightImporter;

    notebooklmKit.NotebookLMClient.prototype.connect = async function connect() {};

    globalThis.fetch = async (_input, init) => {
      fetchCalls += 1;
      userAgent = String((init?.headers as Record<string, string> | undefined)?.["User-Agent"] ?? "");
      return new Response("", {
        status: 302,
        headers: {
          location: "https://notebooklm.google?location=unsupported",
        },
      });
    };

    try {
      const client = await clientModule.__testOnly.createRuntimeClientForTests("default");

      assert.ok(client);
      assert.equal(fetchCalls, 1);
      assert.equal(launched, true);
      assert.match(userAgent, /Chrome\//);
      assert.match(userAgent, /Safari\//);
    } finally {
      globalThis.fetch = originalFetch;
      notebooklmKit.NotebookLMClient.prototype.connect = originalConnect;
      clientModule.__testOnly.importPlaywright = originalImport;
    }
  });
});
