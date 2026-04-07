import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AuthMeta } from "./auth-profile.js";
import {
  createAuthManager,
  type AuthManagerDependencies,
} from "./auth-manager.js";

function withTempHome<T>(fn: (homeDir: string) => T | Promise<T>) {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const homeDir = mkdtempSync(join(tmpdir(), "notebooklm-auth-manager-"));

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

function createDependencies(overrides: Partial<AuthManagerDependencies> = {}): AuthManagerDependencies {
  let currentClient: { id: string; dispose: () => void } | null = null;

  return {
    now: () => new Date("2026-04-07T12:00:00.000Z"),
    createRuntimeClient: async () => {
      currentClient = {
        id: crypto.randomUUID(),
        dispose() {},
      };

      return currentClient;
    },
    silentRefresh: async () => ({
      authToken: "token:1712491200000",
      storageState: {
        cookies: [
          { name: "SAPISID", value: "test-sapisid", domain: ".google.com" },
        ],
      },
    }),
    validateProfile: async () => ({ status: "ready" }),
    disposeRuntimeClient: async (client) => {
      client.dispose();
      if (currentClient === client) currentClient = null;
    },
    ...overrides,
  };
}

test("concurrent refresh calls share a single in-flight promise", async () => {
  await withTempHome(async () => {
    let refreshCalls = 0;

    const manager = createAuthManager(
      createDependencies({
        silentRefresh: async () => {
          refreshCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            authToken: "token:1712491200000",
            storageState: {
              cookies: [{ name: "SAPISID", value: "cookie", domain: ".google.com" }],
            },
          };
        },
      })
    );

    const [first, second] = await Promise.all([
      manager.refreshAuthProfile("default", "manual"),
      manager.refreshAuthProfile("default", "manual"),
    ]);

    assert.equal(refreshCalls, 1);
    assert.equal(first.status, "ready");
    assert.deepEqual(second, first);
  });
});

test("successful refresh moves state to ready", async () => {
  await withTempHome(async () => {
    const manager = createAuthManager(createDependencies());

    const status = await manager.refreshAuthProfile("default", "manual");

    assert.equal(status.status, "ready");
    assert.equal(status.accountId, "default");
    assert.equal(status.lastRefreshedAt, "2026-04-07T12:00:00.000Z");
  });
});

test("repeated failures eventually move state to reauth_required", async () => {
  await withTempHome(async () => {
    const manager = createAuthManager(
      createDependencies({
        silentRefresh: async () => {
          throw new Error("refresh failed");
        },
      })
    );

    const first = await manager.refreshAuthProfile("default", "manual");
    const second = await manager.refreshAuthProfile("default", "manual");
    const third = await manager.refreshAuthProfile("default", "manual");

    assert.equal(first.status, "expired");
    assert.equal(second.status, "expired");
    assert.equal(third.status, "reauth_required");
  });
});

test("explicit reauth failures move state directly to reauth_required", async () => {
  await withTempHome(async () => {
    const manager = createAuthManager(
      createDependencies({
        silentRefresh: async () => {
          throw new Error("Authentication requires manual re-login");
        },
      })
    );

    const status = await manager.refreshAuthProfile("default", "manual");

    assert.equal(status.status, "reauth_required");
    assert.equal(status.error, "Authentication requires manual re-login");
  });
});

test("invalidation clears runtime client cache", async () => {
  await withTempHome(async () => {
    let buildCalls = 0;

    const manager = createAuthManager(
      createDependencies({
        createRuntimeClient: async () => {
          buildCalls += 1;
          return {
            id: `client-${buildCalls}`,
            dispose() {},
          };
        },
      })
    );

    const first = await manager.getAuthenticatedSdkClient("default");
    await manager.invalidateAuthClient("default");
    const second = await manager.getAuthenticatedSdkClient("default");

    assert.notEqual(first, second);
    assert.equal(buildCalls, 2);
  });
});

test("getAuthProfileStatus returns persisted auth metadata", async () => {
  await withTempHome(async () => {
    const manager = createAuthManager(createDependencies());
    await manager.refreshAuthProfile("default", "manual");

    const status = await manager.getAuthProfileStatus("default");

    assert.deepEqual(status, {
      accountId: "default",
      status: "ready",
      lastCheckedAt: "2026-04-07T12:00:00.000Z",
      lastRefreshedAt: "2026-04-07T12:00:00.000Z",
    } satisfies AuthMeta);
  });
});
