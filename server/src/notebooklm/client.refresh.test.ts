import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getLegacyStorageStatePath, getProfilePaths, readStorageState } from "./auth-profile.js";

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
