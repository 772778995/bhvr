/**
 * Additional auth-manager tests: reauth_required webhook / log alert.
 * These tests focus specifically on alert behavior when state transitions
 * to reauth_required.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createAuthManager,
  type AuthManagerDependencies,
  type AlertSink,
} from "./auth-manager.js";

function withTempHome<T>(fn: (homeDir: string) => T | Promise<T>) {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const homeDir = mkdtempSync(join(tmpdir(), "notebooklm-auth-alert-"));

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
  return {
    now: () => new Date("2026-04-07T12:00:00.000Z"),
    createRuntimeClient: async () => ({ dispose() {} }),
    silentRefresh: async () => ({
      authToken: "token",
      storageState: { cookies: [{ name: "SAPISID", value: "s", domain: ".google.com" }] },
    }),
    validateProfile: async () => ({ status: "ready" }),
    disposeRuntimeClient: async (client) => { client.dispose(); },
    ...overrides,
  };
}

test("alert is fired once when state transitions to reauth_required", async () => {
  await withTempHome(async () => {
    const alerts: string[] = [];
    const sink: AlertSink = {
      onReauthRequired: (accountId) => {
        alerts.push(accountId);
        return Promise.resolve();
      },
    };

    const manager = createAuthManager(
      createDependencies({
        silentRefresh: async () => {
          throw new Error("Authentication requires manual re-login");
        },
      }),
      sink,
    );

    await manager.refreshAuthProfile("default", "test");
    assert.equal(alerts.length, 1, "alert should fire once on first reauth_required transition");
    assert.equal(alerts[0], "default");
  });
});

test("alert is NOT fired again if state is already reauth_required", async () => {
  await withTempHome(async () => {
    const alerts: string[] = [];
    const sink: AlertSink = {
      onReauthRequired: (accountId) => {
        alerts.push(accountId);
        return Promise.resolve();
      },
    };

    const manager = createAuthManager(
      createDependencies({
        silentRefresh: async () => {
          throw new Error("Authentication requires manual re-login");
        },
      }),
      sink,
    );

    // First call transitions to reauth_required → should fire
    await manager.refreshAuthProfile("default", "test");
    // Second call stays in reauth_required → should NOT fire again
    await manager.refreshAuthProfile("default", "test");

    assert.equal(alerts.length, 1, "alert should NOT fire again when state is already reauth_required");
  });
});

// ── NEW: degraded alert logging when webhook fails ──────────────────────────

/**
 * createAlertSink is tested as a unit via a controllable AlertSink seam.
 * The degraded-log requirement says: when webhook throws OR returns non-2xx,
 * a real structured alert log must still be emitted.
 *
 * We verify this via an exported helper `buildAlertSink` that accepts an
 * injectable fetch so tests can simulate webhook failure without real network.
 */
import { buildAlertSink } from "./alert-sink.js";

test("buildAlertSink emits structured alert log when REAUTH_WEBHOOK_URL not set", async () => {
  await withTempHome(async () => {
    const logs: Array<{ level: string; data: Record<string, unknown>; msg: string }> = [];
    const fakeLogger = {
      error: (data: Record<string, unknown>, msg: string) => logs.push({ level: "error", data, msg }),
      warn: (data: Record<string, unknown>, msg: string) => logs.push({ level: "warn", data, msg }),
    };

    const sink = buildAlertSink({ logger: fakeLogger as never, fetch: fetch });

    delete process.env.REAUTH_WEBHOOK_URL;
    await sink.onReauthRequired("default");

    assert.ok(
      logs.some((l) => l.data.event === "reauth_required"),
      "should emit structured alert log with event=reauth_required"
    );
  });
});

test("buildAlertSink emits structured alert log when webhook fetch throws", async () => {
  await withTempHome(async () => {
    process.env.REAUTH_WEBHOOK_URL = "https://fake-webhook.example.com/alert";

    const logs: Array<{ level: string; data: Record<string, unknown>; msg: string }> = [];
    const fakeLogger = {
      error: (data: Record<string, unknown>, msg: string) => logs.push({ level: "error", data, msg }),
      warn: (data: Record<string, unknown>, msg: string) => logs.push({ level: "warn", data, msg }),
    };
    const fakeFetch = async () => {
      throw new Error("network unreachable");
    };

    const sink = buildAlertSink({ logger: fakeLogger as never, fetch: fakeFetch as never });
    await sink.onReauthRequired("default");

    assert.ok(
      logs.some((l) => l.data.event === "reauth_required"),
      "should emit structured alert log even when webhook throws"
    );

    delete process.env.REAUTH_WEBHOOK_URL;
  });
});

test("buildAlertSink emits structured alert log when webhook returns non-2xx", async () => {
  await withTempHome(async () => {
    process.env.REAUTH_WEBHOOK_URL = "https://fake-webhook.example.com/alert";

    const logs: Array<{ level: string; data: Record<string, unknown>; msg: string }> = [];
    const fakeLogger = {
      error: (data: Record<string, unknown>, msg: string) => logs.push({ level: "error", data, msg }),
      warn: (data: Record<string, unknown>, msg: string) => logs.push({ level: "warn", data, msg }),
    };
    const fakeFetch = async () => ({ ok: false, status: 500 } as Response);

    const sink = buildAlertSink({ logger: fakeLogger as never, fetch: fakeFetch as never });
    await sink.onReauthRequired("default");

    assert.ok(
      logs.some((l) => l.data.event === "reauth_required"),
      "should emit structured alert log when webhook returns non-2xx"
    );

    delete process.env.REAUTH_WEBHOOK_URL;
  });
});
