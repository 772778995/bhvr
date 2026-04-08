import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import { authManager, DEFAULT_ACCOUNT_ID } from "../../notebooklm/auth-manager.js";
import auth from "./index.js";

function withTempHome<T>(fn: (homeDir: string) => T | Promise<T>) {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const homeDir = mkdtempSync(join(tmpdir(), "notebooklm-auth-route-"));

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

test("POST /accounts/:accountId/login invalidates cached auth client after login completes", async () => {
  await withTempHome(async () => {
    const originalInvalidateAuthClient = authManager.invalidateAuthClient;
    const originalLaunchPersistentContext = chromium.launchPersistentContext;
    const invalidatedAccountIds: string[] = [];

    authManager.invalidateAuthClient = async (accountId: string) => {
      invalidatedAccountIds.push(accountId);
    };

    chromium.launchPersistentContext = (async () => ({
      pages: () => [],
      newPage: async () => ({
        goto: async () => {},
        waitForURL: async () => {},
      }),
      storageState: async () => ({
        cookies: [{ name: "SAPISID", value: "test-sapisid", domain: ".google.com" }],
      }),
      close: async () => {},
    })) as unknown as typeof chromium.launchPersistentContext;

    try {
      const response = await auth.request(`http://localhost/accounts/${DEFAULT_ACCOUNT_ID}/login`, {
        method: "POST",
      });

      assert.equal(response.status, 202);

      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(invalidatedAccountIds, [DEFAULT_ACCOUNT_ID]);
    } finally {
      authManager.invalidateAuthClient = originalInvalidateAuthClient;
      chromium.launchPersistentContext = originalLaunchPersistentContext;
    }
  });
});

test("DELETE /accounts/:accountId invalidates cached auth client after clearing credentials", async () => {
  await withTempHome(async (homeDir) => {
    const originalInvalidateAuthClient = authManager.invalidateAuthClient;
    const invalidatedAccountIds: string[] = [];

    authManager.invalidateAuthClient = async (accountId: string) => {
      invalidatedAccountIds.push(accountId);
    };

    const profileDir = join(homeDir, ".notebooklm", "profiles", DEFAULT_ACCOUNT_ID);
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "storage-state.json"), JSON.stringify({ cookies: [] }));

    try {
      const response = await auth.request(`http://localhost/accounts/${DEFAULT_ACCOUNT_ID}`, {
        method: "DELETE",
      });

      assert.equal(response.status, 200);
      assert.deepEqual(invalidatedAccountIds, [DEFAULT_ACCOUNT_ID]);
    } finally {
      authManager.invalidateAuthClient = originalInvalidateAuthClient;
    }
  });
});
