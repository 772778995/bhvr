/**
 * Tests for POST /api/auth/reauth route.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { authManager } from "../../notebooklm/auth-manager.js";
import auth from "./index.js";

function withTempHome<T>(fn: (homeDir: string) => T | Promise<T>) {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalAdminSecret = process.env.ADMIN_SECRET;
  const homeDir = mkdtempSync(join(tmpdir(), "notebooklm-auth-reauth-"));

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  return Promise.resolve()
    .then(() => fn(homeDir))
    .finally(() => {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
      if (originalAdminSecret !== undefined) {
        process.env.ADMIN_SECRET = originalAdminSecret;
      } else {
        delete process.env.ADMIN_SECRET;
      }
      rmSync(homeDir, { recursive: true, force: true });
    });
}

const validStorageState = { cookies: [{ name: "SAPISID", value: "test", domain: ".google.com" }] };
const validStorageStateB64 = Buffer.from(JSON.stringify(validStorageState)).toString("base64");

// ── existing passing tests ──────────────────────────────────────────────────

test("POST /reauth returns 503 when ADMIN_SECRET not configured", async () => {
  await withTempHome(async () => {
    delete process.env.ADMIN_SECRET;

    const response = await auth.request("http://localhost/reauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageState: validStorageStateB64 }),
    });

    assert.equal(response.status, 503);
  });
});

test("POST /reauth returns 401 when Authorization header missing", async () => {
  await withTempHome(async () => {
    process.env.ADMIN_SECRET = "test-secret";

    const response = await auth.request("http://localhost/reauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageState: validStorageStateB64 }),
    });

    assert.equal(response.status, 401);
  });
});

test("POST /reauth returns 401 when Authorization token is wrong", async () => {
  await withTempHome(async () => {
    process.env.ADMIN_SECRET = "test-secret";

    const response = await auth.request("http://localhost/reauth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer wrong-secret",
      },
      body: JSON.stringify({ storageState: validStorageStateB64 }),
    });

    assert.equal(response.status, 401);
  });
});

test("POST /reauth returns 400 when storageState is missing", async () => {
  await withTempHome(async () => {
    process.env.ADMIN_SECRET = "test-secret";

    const response = await auth.request("http://localhost/reauth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-secret",
      },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 400);
  });
});

// ── NEW tests (initially failing) ──────────────────────────────────────────

test("POST /reauth returns 400 for strictly invalid base64 input", async () => {
  await withTempHome(async () => {
    process.env.ADMIN_SECRET = "test-secret";

    const response = await auth.request("http://localhost/reauth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-secret",
      },
      body: JSON.stringify({ storageState: "!!!not-valid-base64!!!" }),
    });

    assert.equal(response.status, 400);
    const body = await response.json() as { error: string };
    assert.match(body.error, /base64/i);
  });
});

test("POST /reauth returns 422 when refreshAuthProfile resolves to non-ready status", async () => {
  await withTempHome(async (homeDir) => {
    process.env.ADMIN_SECRET = "test-secret";
    mkdirSync(join(homeDir, ".notebooklm", "profiles", "default"), { recursive: true });

    // Stub refreshAuthProfile to return expired
    const originalRefresh = authManager.refreshAuthProfile.bind(authManager);
    authManager.refreshAuthProfile = async () => ({
      accountId: "default",
      status: "expired",
      lastCheckedAt: new Date().toISOString(),
    });

    try {
      const response = await auth.request("http://localhost/reauth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-secret",
        },
        body: JSON.stringify({ storageState: validStorageStateB64 }),
      });

      assert.equal(response.status, 422);
      const body = await response.json() as { authStatus: string };
      assert.equal(body.authStatus, "expired");
    } finally {
      authManager.refreshAuthProfile = originalRefresh;
    }
  });
});

test("POST /reauth does NOT call taskQueue.resume() when refreshAuthProfile returns non-ready", async () => {
  await withTempHome(async (homeDir) => {
    process.env.ADMIN_SECRET = "test-secret";
    mkdirSync(join(homeDir, ".notebooklm", "profiles", "default"), { recursive: true });

    const { taskQueue } = await import("../../worker/queue.js");
    let resumeCalled = false;
    const originalResume = taskQueue.resume.bind(taskQueue);
    taskQueue.resume = () => {
      resumeCalled = true;
      originalResume();
    };

    const originalRefresh = authManager.refreshAuthProfile.bind(authManager);
    authManager.refreshAuthProfile = async () => ({
      accountId: "default",
      status: "reauth_required",
      lastCheckedAt: new Date().toISOString(),
    });

    try {
      await auth.request("http://localhost/reauth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-secret",
        },
        body: JSON.stringify({ storageState: validStorageStateB64 }),
      });

      assert.equal(resumeCalled, false, "taskQueue.resume() must NOT be called when auth is not ready");
    } finally {
      authManager.refreshAuthProfile = originalRefresh;
      taskQueue.resume = originalResume;
    }
  });
});

test("POST /reauth returns 502 when refreshAuthProfile throws", async () => {
  await withTempHome(async (homeDir) => {
    process.env.ADMIN_SECRET = "test-secret";
    mkdirSync(join(homeDir, ".notebooklm", "profiles", "default"), { recursive: true });

    const originalRefresh = authManager.refreshAuthProfile.bind(authManager);
    authManager.refreshAuthProfile = async () => {
      throw new Error("upstream notebooklm error");
    };

    try {
      const response = await auth.request("http://localhost/reauth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-secret",
        },
        body: JSON.stringify({ storageState: validStorageStateB64 }),
      });

      assert.equal(response.status, 502);
    } finally {
      authManager.refreshAuthProfile = originalRefresh;
    }
  });
});
