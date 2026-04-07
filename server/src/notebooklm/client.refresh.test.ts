import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getProfilePaths, readStorageState } from "./auth-profile.js";

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

    clientModule.__testOnly.importPlaywright = ((async () => ({
      chromium: {
        launchPersistentContext: async (userDataDir: string) => {
          launchUserDataDir = userDataDir;

          return {
            newPage: async () => ({
              goto: async () => {},
              url: () => "https://notebooklm.google.com/",
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

    globalThis.fetch = async () =>
      new Response('<html><script>var data = {"SNlM0e":"fresh-token:1712491200000"}</script></html>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    try {
      const result = await clientModule.__testOnly.silentRefreshForTests("default");

      assert.equal(launchUserDataDir, paths.browserUserDataDir);
      assert.equal(result.authToken, "fresh-token:1712491200000");

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
