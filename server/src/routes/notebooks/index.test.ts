import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NotebookLMClient, SourceStatus, SourceType } from "notebooklm-kit";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempHome = mkdtempSync(join(tmpdir(), "notebooklm-list-test-"));
const notebooklmDir = join(tempHome, ".notebooklm");
const defaultProfileDir = join(notebooklmDir, "profiles", "default");

mkdirSync(notebooklmDir, { recursive: true });
mkdirSync(defaultProfileDir, { recursive: true });
writeFileSync(
  join(notebooklmDir, "storage-state.json"),
  JSON.stringify({
    cookies: [
      {
        name: "SID",
        value: "test-cookie",
        domain: ".google.com",
      },
    ],
  })
);

function writeAuthMeta(meta: Record<string, unknown>) {
  mkdirSync(defaultProfileDir, { recursive: true });
  writeFileSync(join(defaultProfileDir, "auth-meta.json"), JSON.stringify(meta, null, 2));
}

process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

process.on("exit", () => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  rmSync(tempHome, { recursive: true, force: true });
});

test("listNotebooks normalizes SDK output and GET /api/notebooks returns successResponse", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalNotebooks = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "notebooks");

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function connect() {};
  Object.defineProperty(NotebookLMClient.prototype, "notebooks", {
    configurable: true,
    get() {
      return {
        list: async () => [
          {
            projectId: "nb-1",
            title: "Notebook One",
            updatedAt: "2026-04-07T10:00:00.000Z",
            description: "raw sdk description should not leak",
            lastAccessed: "2026-04-06T10:00:00.000Z",
            extraField: "should-not-leak",
          },
          {
            projectId: "nb-2",
            lastAccessed: "2026-04-05T10:00:00.000Z",
          },
          {
            projectId: "nb-3",
          },
        ],
      };
    },
  });

  const { listNotebooks, disposeClient } = await import("../../notebooklm/index.js");
  const routeModule = await import("./index.js");
  const notebooks = routeModule.default;

  t.after(() => {
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    if (originalNotebooks) {
      Object.defineProperty(NotebookLMClient.prototype, "notebooks", originalNotebooks);
    }
    disposeClient();
  });

  const listed = await listNotebooks();
  assert.deepEqual(listed, [
    {
      id: "nb-1",
      title: "Notebook One",
      updatedAt: "2026-04-07T10:00:00.000Z",
      description: "",
    },
    {
      id: "nb-2",
      title: "nb-2",
      updatedAt: "2026-04-05T10:00:00.000Z",
      description: "",
    },
    {
      id: "nb-3",
      title: "nb-3",
      updatedAt: "",
      description: "",
    },
  ]);

  const response = await notebooks.request("http://localhost/");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    data: [
      {
        id: "nb-1",
        title: "Notebook One",
        updatedAt: "2026-04-07T10:00:00.000Z",
        description: "",
      },
      {
        id: "nb-2",
        title: "nb-2",
        updatedAt: "2026-04-05T10:00:00.000Z",
        description: "",
      },
      {
        id: "nb-3",
        title: "nb-3",
        updatedAt: "",
        description: "",
      },
    ],
  });
});
test("GET /api/notebooks returns 401 with explicit errorCode on unrecoverable auth failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalNotebooks = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "notebooks");

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function connect() {};
  Object.defineProperty(NotebookLMClient.prototype, "notebooks", {
    configurable: true,
    get() {
      return {
        list: async () => {
          throw new Error("authentication revoked");
        },
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const notebooks = routeModule.default;

  try {
    const response = await notebooks.request("http://localhost/");

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      message: "authentication revoked",
      errorCode: "UNAUTHORIZED",
    });
  } finally {
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    if (originalNotebooks) {
      Object.defineProperty(NotebookLMClient.prototype, "notebooks", originalNotebooks);
    }
    await disposeClient();
  }
});

test("GET /api/notebooks/:id returns 401 with explicit errorCode on unrecoverable auth failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalNotebooks = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "notebooks");

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function connect() {};
  Object.defineProperty(NotebookLMClient.prototype, "notebooks", {
    configurable: true,
    get() {
      return {
        get: async () => {
          throw new Error("authentication revoked");
        },
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const notebooks = routeModule.default;

  try {
    const response = await notebooks.request("http://localhost/b6bc3be7-56ee-4cfc-8cd4-cb2f9d25ebc4");

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      message: "authentication revoked",
      errorCode: "UNAUTHORIZED",
    });
  } finally {
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    if (originalNotebooks) {
      Object.defineProperty(NotebookLMClient.prototype, "notebooks", originalNotebooks);
    }
    await disposeClient();
  }
});

test("GET /api/notebooks/:id/entries remains available when auth requires re-login", async () => {
  writeAuthMeta({
    accountId: "default",
    status: "reauth_required",
    error: "Authentication refresh failed repeatedly",
  });

  const notebookId = crypto.randomUUID();
  const { insertReportEntry } = await import("../../db/report-entries.js");
  const routeModule = await import("./index.js");
  const notebooks = routeModule.default;

  const entry = await insertReportEntry({
    notebookId,
    title: "cached report",
    content: "cached report content",
    state: "ready",
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/entries`);

  assert.equal(response.status, 200);
  const body = await response.json() as {
    success: boolean;
    data: Array<{ id: string; entryType: string; title: string; content: string; state: string }>;
  };
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data));
  const found = body.data.find((e) => e.id === entry.id);
  assert.ok(found, "inserted entry should appear in entries list");
  assert.equal(found!.content, "cached report content");
  assert.equal(found!.title, "cached report");
  assert.equal(found!.entryType, "research_report");
  assert.equal(found!.state, "ready");
});

test("GET /api/notebooks/:id/messages remains available when auth requires re-login", async () => {
  writeAuthMeta({
    accountId: "default",
    status: "reauth_required",
    error: "Authentication refresh failed repeatedly",
  });

  const notebookId = "b6bc3be7-56ee-4cfc-8cd4-cb2f9d25ebc4";
  const routeModule = await import("./index.js");
  const notebooks = routeModule.default;

  const response = await notebooks.request(`http://localhost/${notebookId}/messages`);

  assert.equal(response.status, 502);
  const body = await response.json() as {
    success: boolean;
    errorCode: string;
    message: string;
  };
  assert.equal(body.success, false);
  assert.equal(body.errorCode, "MESSAGES_FETCH_FAILED");
  assert.match(body.message, /^获取对话记录失败:/);
});

test("GET /api/notebooks/:id/research/stream remains available when auth requires re-login", async () => {
  writeAuthMeta({
    accountId: "default",
    status: "reauth_required",
    error: "Authentication refresh failed repeatedly",
  });

  const notebookId = "b6bc3be7-56ee-4cfc-8cd4-cb2f9d25ebc4";
  const routeModule = await import("./index.js");
  const notebooks = routeModule.default;

  const response = await notebooks.request(`http://localhost/${notebookId}/research/stream`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  await response.body?.cancel();
});

test("GET /api/notebooks/:id/artifacts/:artifactId for a READY report writes markdown file to disk and stores filePath", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "report-artifact-test-"));
  const prevDataFilesDir = process.env.DATA_FILES_DIR;
  process.env.DATA_FILES_DIR = tempDir;

  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalArtifacts = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "artifacts");

  const REPORT_MARKDOWN = "# Test Report\n\nContent from NotebookLM.";
  const TEST_ARTIFACT_ID = `report-art-${crypto.randomUUID()}`;

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function () {};
  Object.defineProperty(NotebookLMClient.prototype, "artifacts", {
    configurable: true,
    get() {
      return {
        get: async () => ({
          artifactId: TEST_ARTIFACT_ID,
          type: 1, // ArtifactType.REPORT
          state: 2, // ArtifactState.READY
          title: "Test Report",
          content: REPORT_MARKDOWN,
        }),
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const { getEntryByArtifactId } = await import("../../db/report-entries.js");
  const notebooks = routeModule.default;
  const notebookId = crypto.randomUUID();

  t.after(() => {
    process.env.DATA_FILES_DIR = prevDataFilesDir;
    rmSync(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    if (originalArtifacts) {
      Object.defineProperty(NotebookLMClient.prototype, "artifacts", originalArtifacts);
    }
    disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/artifacts/${TEST_ARTIFACT_ID}`);
  assert.equal(response.status, 200);

  // The DB entry must have filePath set to an artifact-report-*.md file
  const entry = await getEntryByArtifactId(TEST_ARTIFACT_ID);
  assert.ok(entry, "DB entry should exist after processing READY report artifact");
  assert.equal(entry!.state, "ready");
  assert.ok(entry!.filePath, "filePath must be set for a report artifact");
  assert.match(entry!.filePath!, /artifact-report-.+\.md$/);

  // The markdown file must exist on disk with the correct content
  const fullPath = join(tempDir, entry!.filePath!);
  const content = readFileSync(fullPath, "utf8");
  assert.equal(content, REPORT_MARKDOWN);
});

test("POST /api/notebooks/:id/artifacts forwards audio customization options to SDK", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalArtifacts = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "artifacts");

  const captured: { notebookId?: string; options?: unknown } = {};

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function () {};
  Object.defineProperty(NotebookLMClient.prototype, "artifacts", {
    configurable: true,
    get() {
      return {
        list: async () => [],
        audio: {
          create: async (notebookId: string, options?: unknown) => {
            captured.notebookId = notebookId;
            captured.options = options;
            return {
              audioId: "audio-artifact-1",
              state: 1,
              title: "Audio Overview",
            };
          },
        },
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const notebooks = routeModule.default;
  const notebookId = crypto.randomUUID();

  t.after(() => {
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    if (originalArtifacts) {
      Object.defineProperty(NotebookLMClient.prototype, "artifacts", originalArtifacts);
    }
    disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/artifacts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "audio",
      options: {
        customization: {
          format: 1,
          language: "zh",
          length: 2,
        },
        instructions: "请只做简要概述",
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(captured.notebookId, notebookId);
  assert.deepEqual(captured.options, {
    customization: {
      format: 1,
      language: "zh",
      length: 2,
    },
    instructions: "请只做简要概述",
  });
});

test("POST /api/notebooks/:id/artifacts deletes existing remote audio artifacts before creating a new one", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalArtifacts = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "artifacts");

  const deleted: string[] = [];
  const notebookId = crypto.randomUUID();

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function () {};
  Object.defineProperty(NotebookLMClient.prototype, "artifacts", {
    configurable: true,
    get() {
      return {
        list: async () => [
          { artifactId: "audio-old-1", type: 10, state: 2, title: "old audio 1" },
          { artifactId: "quiz-1", type: 5, state: 2, title: "quiz" },
          { artifactId: "audio-old-2", type: 10, state: 1, title: "old audio 2" },
        ],
        delete: async (artifactId: string) => {
          deleted.push(artifactId);
        },
        audio: {
          create: async () => ({
            audioId: "audio-new-1",
            state: 1,
            title: "Audio Overview",
          }),
        },
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const notebooks = routeModule.default;

  t.after(() => {
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    if (originalArtifacts) {
      Object.defineProperty(NotebookLMClient.prototype, "artifacts", originalArtifacts);
    }
    disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/artifacts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "audio" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(deleted, ["audio-old-1", "audio-old-2"]);
});

test("POST /api/notebooks/:id/artifacts rejects a new audio create while the current audio slot is still creating", async () => {
  const notebookId = crypto.randomUUID();
  const { insertArtifactEntry } = await import("../../db/report-entries.js");
  const inflightArtifactId = crypto.randomUUID();

  await insertArtifactEntry({
    notebookId,
    artifactId: inflightArtifactId,
    artifactType: "audio",
    state: "creating",
    title: null,
  });

  const routeModule = await import("./index.js");
  const notebooks = routeModule.default;

  const response = await notebooks.request(`http://localhost/${notebookId}/artifacts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "audio" }),
  });

  assert.equal(response.status, 409);
  const payload = await response.json() as { success: boolean; errorCode?: string };
  assert.equal(payload.success, false);
  assert.equal(payload.errorCode, "AUDIO_ALREADY_CREATING");
});

test("GET /api/notebooks/:id/artifacts/:artifactId uses notebook-level overview audio bytes when both overview and artifact-specific data exist", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "audio-artifact-test-"));
  const prevDataFilesDir = process.env.DATA_FILES_DIR;
  process.env.DATA_FILES_DIR = tempDir;

  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalGetRPCClient = NotebookLMClient.prototype.getRPCClient;
  const originalArtifacts = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "artifacts");

  const artifactId = `audio-art-${crypto.randomUUID()}`;
  const notebookId = crypto.randomUUID();
  const artifactSpecificAudio = Buffer.alloc(256, 0x61);
  const notebookLevelAudio = Buffer.alloc(256, 0x62);

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function () {};
  NotebookLMClient.prototype.getRPCClient = async function () {
    return {
      call: async (rpcId: string, args: unknown[]) => {
        if (rpcId === "Fxmvse") {
          assert.equal(args[1], artifactId);
          return [null, [null, Buffer.from(artifactSpecificAudio).toString("base64")]];
        }

        if (rpcId === "VUsiyb") {
          return [["READY", Buffer.from(notebookLevelAudio).toString("base64"), "Notebook-level audio"]];
        }

        throw new Error(`Unexpected rpcId: ${rpcId}`);
      },
      getCookies: () => "SID=test-cookie",
    } as unknown as Awaited<ReturnType<NotebookLMClient["getRPCClient"]>>;
  };

  Object.defineProperty(NotebookLMClient.prototype, "artifacts", {
    configurable: true,
    get() {
      return {
        get: async () => ({
          artifactId,
          type: 10,
          state: 2,
          title: "Audio Variant B",
          audioData: undefined,
        }),
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const { getEntryByArtifactId } = await import("../../db/report-entries.js");
  const notebooks = routeModule.default;

  t.after(() => {
    process.env.DATA_FILES_DIR = prevDataFilesDir;
    rmSync(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    NotebookLMClient.prototype.getRPCClient = originalGetRPCClient;
    if (originalArtifacts) {
      Object.defineProperty(NotebookLMClient.prototype, "artifacts", originalArtifacts);
    }
    disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/artifacts/${artifactId}`);
  assert.equal(response.status, 200);

  const payload = await response.json() as { success: boolean; data: { artifactId: string } };
  assert.equal(payload.success, true);
  assert.equal(payload.data.artifactId, artifactId);

  const entry = await getEntryByArtifactId(artifactId);
  assert.ok(entry?.filePath, "audio artifact should persist an mp3 file");

  const stored = readFileSync(join(tempDir, entry!.filePath!));
  assert.deepEqual(stored, notebookLevelAudio);
  assert.notDeepEqual(stored, artifactSpecificAudio);
});

test("GET /api/notebooks/:id/artifacts/:artifactId prefers notebook-level overview audio bytes when remote audio is unique", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "audio-overview-preferred-test-"));
  const prevDataFilesDir = process.env.DATA_FILES_DIR;
  process.env.DATA_FILES_DIR = tempDir;

  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalGetRPCClient = NotebookLMClient.prototype.getRPCClient;
  const originalArtifacts = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "artifacts");

  const artifactId = `audio-art-${crypto.randomUUID()}`;
  const notebookId = crypto.randomUUID();
  const overviewAudio = Buffer.alloc(256, 0x63);

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function () {};
  NotebookLMClient.prototype.getRPCClient = async function () {
    return {
      call: async (rpcId: string) => {
        if (rpcId === "VUsiyb") {
          return [["READY", Buffer.from(overviewAudio).toString("base64"), "Notebook-only audio"]];
        }

        if (rpcId === "Fxmvse") {
          return [[[[null, 1000]]]];
        }

        throw new Error(`Unexpected rpcId: ${rpcId}`);
      },
      getCookies: () => "SID=test-cookie",
    } as unknown as Awaited<ReturnType<NotebookLMClient["getRPCClient"]>>;
  };

  Object.defineProperty(NotebookLMClient.prototype, "artifacts", {
    configurable: true,
    get() {
      return {
        get: async () => ({
          artifactId,
          type: 10,
          state: 2,
          title: "Notebook-only audio",
          audioData: undefined,
        }),
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const { getEntryByArtifactId } = await import("../../db/report-entries.js");
  const notebooks = routeModule.default;

  t.after(() => {
    process.env.DATA_FILES_DIR = prevDataFilesDir;
    rmSync(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    NotebookLMClient.prototype.getRPCClient = originalGetRPCClient;
    if (originalArtifacts) {
      Object.defineProperty(NotebookLMClient.prototype, "artifacts", originalArtifacts);
    }
    disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/artifacts/${artifactId}`);
  assert.equal(response.status, 200);

  const entry = await getEntryByArtifactId(artifactId);
  assert.ok(entry?.filePath, "audio artifact should persist overview audio file");

  const stored = readFileSync(join(tempDir, entry!.filePath!));
  assert.deepEqual(stored, overviewAudio);
});

test("GET /api/notebooks/:id/artifacts/:artifactId stores ready audio using artifact-specific URL from raw list response", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "audio-url-artifact-test-"));
  const prevDataFilesDir = process.env.DATA_FILES_DIR;
  process.env.DATA_FILES_DIR = tempDir;

  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalGetRPCClient = NotebookLMClient.prototype.getRPCClient;
  const originalArtifacts = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "artifacts");

  const artifactId = `audio-art-${crypto.randomUUID()}`;
  const notebookId = crypto.randomUUID();
  const audioUrl = "https://lh3.googleusercontent.com/notebooklm/example-audio=m140-dv";
  const artifactSpecificAudio = Buffer.from("artifact-specific-url-audio");

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith("https://lh3.googleusercontent.com/notebooklm/")) {
      return new Response(artifactSpecificAudio, {
        status: 200,
        headers: { "content-type": "audio/mp4" },
      });
    }

    return new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };

  NotebookLMClient.prototype.connect = async function () {};
  NotebookLMClient.prototype.getRPCClient = async function () {
    return {
      call: async (rpcId: string) => {
        if (rpcId === "gArtLc") {
          return JSON.stringify([[[
            artifactId,
            "Audio Variant URL",
            1,
            [[["source-1"]]],
            3,
            null,
            [null, [null, 1, null, [["source-1"]], "zh-Hans-CN", true, 1], audioUrl, `${audioUrl}-alt`, false, [[audioUrl, 4, "audio/mp4"]], [12, 0]],
          ]]]);
        }

        if (rpcId === "Fxmvse") {
          return [[[[null, 1000]]]];
        }

        throw new Error(`Unexpected rpcId: ${rpcId}`);
      },
      getCookies: () => "SID=test-cookie",
    } as unknown as Awaited<ReturnType<NotebookLMClient["getRPCClient"]>>;
  };

  Object.defineProperty(NotebookLMClient.prototype, "artifacts", {
    configurable: true,
    get() {
      return {
        get: async () => ({
          artifactId,
          type: 10,
          state: 2,
          title: "Audio Variant URL",
          audioData: undefined,
        }),
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const { getEntryByArtifactId } = await import("../../db/report-entries.js");
  const notebooks = routeModule.default;

  t.after(() => {
    process.env.DATA_FILES_DIR = prevDataFilesDir;
    rmSync(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    NotebookLMClient.prototype.getRPCClient = originalGetRPCClient;
    if (originalArtifacts) {
      Object.defineProperty(NotebookLMClient.prototype, "artifacts", originalArtifacts);
    }
    disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/artifacts/${artifactId}`);
  assert.equal(response.status, 200);

  const payload = await response.json() as { success: boolean; data: { fileUrl?: string } };
  assert.equal(payload.success, true);

  const entry = await getEntryByArtifactId(artifactId);
  assert.ok(entry?.filePath, "audio artifact should persist a downloaded file");
  assert.equal(payload.data.fileUrl, `/api/files/${entry!.filePath!}`);

  const stored = readFileSync(join(tempDir, entry!.filePath!));
  assert.deepEqual(stored, artifactSpecificAudio);
});

test("GET /api/notebooks/:id/artifacts/:artifactId marks audio entry failed when file download is unavailable", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalGetRPCClient = NotebookLMClient.prototype.getRPCClient;
  const originalArtifacts = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "artifacts");

  const artifactId = `audio-art-${crypto.randomUUID()}`;
  const notebookId = crypto.randomUUID();

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function () {};
  NotebookLMClient.prototype.getRPCClient = async function () {
    return {
      call: async (rpcId: string) => {
        if (rpcId === "Fxmvse") {
          return [[[[null, 1000]]]];
        }
        if (rpcId === "gArtLc") {
          return [[[]]];
        }
        throw new Error(`Unexpected rpcId: ${rpcId}`);
      },
      getCookies: () => "SID=test-cookie",
    } as unknown as Awaited<ReturnType<NotebookLMClient["getRPCClient"]>>;
  };

  Object.defineProperty(NotebookLMClient.prototype, "artifacts", {
    configurable: true,
    get() {
      return {
        get: async () => ({
          artifactId,
          type: 10,
          state: 2,
          title: "Audio Ready Without File",
          audioData: undefined,
        }),
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const { getEntryByArtifactId, replaceAudioArtifactEntry } = await import("../../db/report-entries.js");
  const notebooks = routeModule.default;

  await replaceAudioArtifactEntry({ notebookId, artifactId });

  t.after(() => {
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    NotebookLMClient.prototype.getRPCClient = originalGetRPCClient;
    if (originalArtifacts) {
      Object.defineProperty(NotebookLMClient.prototype, "artifacts", originalArtifacts);
    }
    disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/artifacts/${artifactId}`);
  assert.equal(response.status, 200);

  const entry = await getEntryByArtifactId(artifactId);
  assert.equal(entry?.state, "failed");
  assert.equal(entry?.title, "Audio Ready Without File");
  assert.equal(entry?.filePath ?? null, null);
});

test("GET /api/notebooks/:id/artifacts/:artifactId does not persist HTML login page as audio file", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "audio-html-guard-test-"));
  const prevDataFilesDir = process.env.DATA_FILES_DIR;
  process.env.DATA_FILES_DIR = tempDir;

  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalGetRPCClient = NotebookLMClient.prototype.getRPCClient;
  const originalArtifacts = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "artifacts");

  const artifactId = `audio-art-${crypto.randomUUID()}`;
  const notebookId = crypto.randomUUID();
  const audioUrl = "https://lh3.googleusercontent.com/notebooklm/example-audio=m140-dv";

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith("https://lh3.googleusercontent.com/notebooklm/")) {
      return new Response("<!doctype html><html><body>signin</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };

  NotebookLMClient.prototype.connect = async function () {};
  NotebookLMClient.prototype.getRPCClient = async function () {
    return {
      call: async (rpcId: string) => {
        if (rpcId === "gArtLc") {
          return JSON.stringify([[[
            artifactId,
            "Audio HTML Guard",
            1,
            [[["source-1"]]],
            3,
            null,
            [null, [null, 1, null, [["source-1"]], "zh-Hans-CN", true, 1], audioUrl, `${audioUrl}-alt`, false, [[audioUrl, 4, "audio/mp4"]], [12, 0]],
          ]]]);
        }

        if (rpcId === "Fxmvse") {
          return [[[[null, 1000]]]];
        }

        throw new Error(`Unexpected rpcId: ${rpcId}`);
      },
      getCookies: () => "SID=test-cookie",
    } as unknown as Awaited<ReturnType<NotebookLMClient["getRPCClient"]>>;
  };

  Object.defineProperty(NotebookLMClient.prototype, "artifacts", {
    configurable: true,
    get() {
      return {
        get: async () => ({
          artifactId,
          type: 10,
          state: 2,
          title: "Audio HTML Guard",
          audioData: undefined,
        }),
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const { getEntryByArtifactId, replaceAudioArtifactEntry } = await import("../../db/report-entries.js");
  const notebooks = routeModule.default;

  await replaceAudioArtifactEntry({ notebookId, artifactId });

  t.after(() => {
    process.env.DATA_FILES_DIR = prevDataFilesDir;
    rmSync(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    NotebookLMClient.prototype.getRPCClient = originalGetRPCClient;
    if (originalArtifacts) {
      Object.defineProperty(NotebookLMClient.prototype, "artifacts", originalArtifacts);
    }
    disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/artifacts/${artifactId}`);
  assert.equal(response.status, 200);

  const entry = await getEntryByArtifactId(artifactId);
  assert.equal(entry?.state, "failed");
  assert.equal(entry?.filePath ?? null, null);
});
