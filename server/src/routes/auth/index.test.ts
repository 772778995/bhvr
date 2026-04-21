import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import { authManager, DEFAULT_ACCOUNT_ID } from "../../notebooklm/auth-manager.js";
import { readAuthMeta } from "../../notebooklm/auth-profile.js";
import auth from "./index.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal valid base64-encoded storageState payload for POST /reauth */
function makeReauthBody(cookies = [{ name: "SAPISID", value: "test", domain: ".google.com" }]) {
  const storageState = { cookies };
  const b64 = Buffer.from(JSON.stringify(storageState)).toString("base64");
  return JSON.stringify({ storageState: b64 });
}

/** Standard headers needed to pass ADMIN_SECRET gate */
function reauthHeaders(secret: string) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${secret}`,
  };
}

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

test("POST /accounts/:accountId/login calls resetFailureCount after login completes successfully", async () => {
  await withTempHome(async () => {
    const originalResetFailureCount = authManager.resetFailureCount;
    const originalLaunchPersistentContext = chromium.launchPersistentContext;
    const resetCalledFor: string[] = [];

    authManager.resetFailureCount = (accountId: string) => {
      resetCalledFor.push(accountId);
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

      assert.equal(resetCalledFor.length, 1);
      assert.equal(resetCalledFor[0], DEFAULT_ACCOUNT_ID);
    } finally {
      authManager.resetFailureCount = originalResetFailureCount;
      chromium.launchPersistentContext = originalLaunchPersistentContext;
    }
  });
});

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

test("POST /accounts/:accountId/login returns 503 in headless deployment environments", async () => {
  await withTempHome(async () => {
    const originalDisableInteractive = process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN;
    process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN = "1";

    try {
      const response = await auth.request(`http://localhost/accounts/${DEFAULT_ACCOUNT_ID}/login`, {
        method: "POST",
      });

      assert.equal(response.status, 503);
      const body = await response.json() as { error: string };
      assert.match(body.error, /reauth|storage-state|docker|server/i);
    } finally {
      if (originalDisableInteractive === undefined) {
        delete process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN;
      } else {
        process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN = originalDisableInteractive;
      }
    }
  });
});

test("POST /accounts/:accountId/login allows interactive login when display is available even with deployment env vars", async () => {
  await withTempHome(async () => {
    const originalPath = process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
    const originalAdminSecret = process.env.ADMIN_SECRET;
    const originalDisplay = process.env.DISPLAY;
    const originalDisableInteractive = process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN;
    const originalLaunchPersistentContext = chromium.launchPersistentContext;

    process.env.NOTEBOOKLM_STORAGE_STATE_PATH = "/app/data/storage-state.json";
    process.env.ADMIN_SECRET = "test-secret";
    process.env.DISPLAY = ":0";
    process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN = "0";

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
    } finally {
      chromium.launchPersistentContext = originalLaunchPersistentContext;
      if (originalPath === undefined) {
        delete process.env.NOTEBOOKLM_STORAGE_STATE_PATH;
      } else {
        process.env.NOTEBOOKLM_STORAGE_STATE_PATH = originalPath;
      }
      if (originalAdminSecret === undefined) {
        delete process.env.ADMIN_SECRET;
      } else {
        process.env.ADMIN_SECRET = originalAdminSecret;
      }
      if (originalDisplay === undefined) {
        delete process.env.DISPLAY;
      } else {
        process.env.DISPLAY = originalDisplay;
      }
      if (originalDisableInteractive === undefined) {
        delete process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN;
      } else {
        process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN = originalDisableInteractive;
      }
    }
  });
});

test("POST /accounts/:accountId/login allows interactive login on macOS without Linux display env vars", async () => {
  await withTempHome(async () => {
    const originalDisableInteractive = process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN;
    const originalPlatform = process.platform;
    const originalDisplay = process.env.DISPLAY;
    const originalWayland = process.env.WAYLAND_DISPLAY;
    const originalLaunchPersistentContext = chromium.launchPersistentContext;

    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN = "0";

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
      Object.defineProperty(process, "platform", { value: "darwin" });

      const response = await auth.request(`http://localhost/accounts/${DEFAULT_ACCOUNT_ID}/login`, {
        method: "POST",
      });

      assert.equal(response.status, 202);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      chromium.launchPersistentContext = originalLaunchPersistentContext;
      if (originalDisableInteractive === undefined) {
        delete process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN;
      } else {
        process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN = originalDisableInteractive;
      }
      if (originalDisplay === undefined) {
        delete process.env.DISPLAY;
      } else {
        process.env.DISPLAY = originalDisplay;
      }
      if (originalWayland === undefined) {
        delete process.env.WAYLAND_DISPLAY;
      } else {
        process.env.WAYLAND_DISPLAY = originalWayland;
      }
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
      assert.deepEqual(readAuthMeta(DEFAULT_ACCOUNT_ID), {
        ok: true,
        value: {
          accountId: DEFAULT_ACCOUNT_ID,
          status: "missing",
          reason: "credentials_cleared",
        },
      });
    } finally {
      authManager.invalidateAuthClient = originalInvalidateAuthClient;
    }
  });
});

test("GET /status returns reauth_required when custom storage-state path is missing", async () => {
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
      const response = await auth.request("http://localhost/status");

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        accountId: DEFAULT_ACCOUNT_ID,
        status: "reauth_required",
        error: 'No authentication found. Run "npx notebooklm login" first.',
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
