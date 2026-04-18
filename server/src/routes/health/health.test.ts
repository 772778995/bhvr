/**
 * Tests for health route auth snapshot and queue paused fields.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import health from "./index.js";

function withTempHome<T>(fn: (homeDir: string) => T | Promise<T>) {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const homeDir = mkdtempSync(join(tmpdir(), "notebooklm-health-test-"));

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

test("GET /health includes auth snapshot field", async () => {
  await withTempHome(async () => {
    const response = await health.request("http://localhost/", { method: "GET" });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.ok("auth" in body, "response should include 'auth' field");
    const auth = body.auth as Record<string, unknown>;
    assert.ok("status" in auth, "auth field should have 'status'");
  });
});

test("GET /health auth snapshot reflects persisted auth-meta when present", async () => {
  await withTempHome(async (homeDir) => {
    // Write a reauth_required auth-meta
    const profileDir = join(homeDir, ".notebooklm", "profiles", "default");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "auth-meta.json"), JSON.stringify({
      accountId: "default",
      status: "reauth_required",
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
      error: "needs login",
    }));

    const response = await health.request("http://localhost/", { method: "GET" });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    const auth = body.auth as Record<string, unknown>;
    assert.equal(auth.status, "reauth_required");
  });
});

test("GET /health includes queue paused field", async () => {
  await withTempHome(async () => {
    const response = await health.request("http://localhost/", { method: "GET" });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    const queue = body.queue as Record<string, unknown>;
    assert.ok("paused" in queue, "queue field should have 'paused'");
  });
});
