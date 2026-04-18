/**
 * TDD tests for:
 * 1. createApp() factory – no real port binding
 * 2. Static file serving
 * 3. SPA fallback
 * 4. API priority over static
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "./app.js";

function makeTempDist() {
  const dir = mkdtempSync(join(tmpdir(), "bhvr-static-test-"));
  // index.html
  writeFileSync(join(dir, "index.html"), "<!doctype html><html><body>SPA</body></html>");
  // a real asset
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "main.js"), "console.log('hi')");
  return dir;
}

test("createApp() returns a Hono app without binding a port", async () => {
  const app = createApp();
  // If createApp() immediately calls serve(), this process would bind a port and likely throw
  // or interfere. The fact that we can call app.request() proves no binding happened.
  const res = await app.request("/api/health");
  assert.equal(res.status, 200, "health endpoint should return 200");
});

test("static file serving: / returns index.html", async () => {
  const distDir = makeTempDist();
  try {
    const app = createApp({ staticDir: distDir });
    const res = await app.request("/");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("SPA"), "should serve index.html content");
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("static file serving: /assets/main.js returns file content", async () => {
  const distDir = makeTempDist();
  try {
    const app = createApp({ staticDir: distDir });
    const res = await app.request("/assets/main.js");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("console.log"), "should serve asset content");
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("SPA fallback: unknown route returns index.html", async () => {
  const distDir = makeTempDist();
  try {
    const app = createApp({ staticDir: distDir });
    const res = await app.request("/workspace/some-deep-path");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("SPA"), "unknown route should fallback to index.html");
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("API priority: /api/health returns JSON not static fallback", async () => {
  const distDir = makeTempDist();
  try {
    const app = createApp({ staticDir: distDir });
    const res = await app.request("/api/health");
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.ok("status" in body, "should return API JSON with status field");
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("no staticDir: /api/health still works", async () => {
  const app = createApp();
  const res = await app.request("/api/health");
  assert.equal(res.status, 200, "API should return 200 without static dir");
});

test("no staticDir: non-API path returns 404 not API JSON", async () => {
  const app = createApp();
  const res = await app.request("/workspace/abc");
  // Should be 404, not 200 with API JSON
  assert.equal(res.status, 404);
});

test("SPA fallback uses cached index.html (not re-read per request)", async () => {
  const distDir = makeTempDist();
  try {
    const app = createApp({ staticDir: distDir });
    // Delete index.html AFTER app is created – cached content should still be served
    const { unlinkSync } = await import("node:fs");
    unlinkSync(join(distDir, "index.html"));
    const res = await app.request("/workspace/deleted-after-init");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("SPA"), "should serve cached index.html even after file deleted");
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});
