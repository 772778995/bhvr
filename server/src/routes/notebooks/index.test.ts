import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NotebookLMClient, SourceStatus, SourceType } from "notebooklm-kit";
import * as registry from "../../research-runtime/registry.js";

const MINIMAL_PDF_BASE64 = "JVBERi0xLjEKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMTQ0XSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NCA+PgpzdHJlYW0KQlQKL0YxIDI0IFRmCjcyIDcyIFRkCihIZWxsbyBQREYpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxMCAwMDAwMCBuIAowMDAwMDAwMDYzIDAwMDAwIG4gCjAwMDAwMDAxMjIgMDAwMDAgbiAKMDAwMDAwMDI0OCAwMDAwMCBuIAowMDAwMDAwMzQyIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1Jvb3QgMSAwIFIgL1NpemUgNiA+PgpzdGFydHhyZWYKNDEyCiUlRU9G";

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

test("GET /api/notebooks falls back to browser home data when notebooklm-kit list is denied", async (t) => {
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
          throw new Error("Permission denied");
        },
      };
    },
  });

  const clientModule = await import("../../notebooklm/client.js");
  const originalImport = clientModule.__testOnly.importPlaywright;
  const payload = JSON.stringify([
    ["测试", null, "notebook-1", "", null, [1, false, true, null, null, [1776072754, 759105000], 1, false, [1776068683, 221409000], null, null, null, false, true, 1, false, null, true, 3]],
    ["快速读书", null, "notebook-2", "", null, [1, false, true, null, null, [1776071196, 30988000], 1, false, [1775803015, 435052000], null, null, null, false, true, 1, false, null, true, 3]],
  ]);
  const rpcResponse = `${JSON.stringify([["wrb.fr", "wXbhsf", payload, null, null, null, "generic"]])}`;

  const mockedImportPlaywright = async () => ({
    chromium: {
      launchPersistentContext: async () => {
        let onResponse: ((resp: { url(): string; text(): Promise<string> }) => Promise<void> | void) | null = null;
        const page = {
          on: (_event: string, handler: (resp: { url(): string; text(): Promise<string> }) => Promise<void> | void) => {
            onResponse = handler;
          },
          goto: async () => {
            await onResponse?.({
              url: () => "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute?rpcids=wXbhsf",
              text: async () => `)]}'\n\n${rpcResponse.length}\n${rpcResponse}\n25\n[["e",4,null,null,1010]]\n`,
            });
          },
          url: () => "https://notebooklm.google.com/",
        };

        return {
          pages: () => [],
          newPage: async () => page,
          storageState: async () => ({
            cookies: [{ name: "SAPISID", value: "browser-cookie", domain: ".google.com" }],
          }),
          close: async () => {},
        };
      },
    },
  });

  clientModule.__testOnly.importPlaywright = mockedImportPlaywright as unknown as typeof originalImport;

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const notebooks = routeModule.default;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    if (originalNotebooks) {
      Object.defineProperty(NotebookLMClient.prototype, "notebooks", originalNotebooks);
    }
    clientModule.__testOnly.importPlaywright = originalImport;
    await disposeClient();
  });

  const response = await notebooks.request("http://localhost/");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    data: [
      {
        id: "notebook-1",
        title: "测试",
        updatedAt: "2026-04-13T09:32:34.759Z",
        description: "",
      },
      {
        id: "notebook-2",
        title: "快速读书",
        updatedAt: "2026-04-13T09:06:36.030Z",
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

test("GET /api/notebooks/:id returns 403 with explicit errorCode on notebook permission failure", async () => {
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
          throw new Error("Permission denied");
        },
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const notebooks = routeModule.default;

  try {
    const response = await notebooks.request("http://localhost/b6bc3be7-56ee-4cfc-8cd4-cb2f9d25ebc4");

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      success: false,
      message: "Permission denied",
      errorCode: "FORBIDDEN",
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
    data: Array<{ id: string; entryType: string; title: string; content: string | null; state: string }>;
  };
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data));
  const found = body.data.find((e) => e.id === entry.id);
  assert.ok(found, "inserted entry should appear in entries list");
  assert.equal(found!.content, null);
  assert.equal(found!.title, "cached report");
  assert.equal(found!.entryType, "research_report");
  assert.equal(found!.state, "ready");
});

test("POST /api/notebooks/:id/report/generate persists builtin quick-read preset metadata on the report entry", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalGeneration = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "generation");
  const originalNotebooks = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "notebooks");
  const originalSources = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "sources");

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function () {};
  Object.defineProperty(NotebookLMClient.prototype, "notebooks", {
    configurable: true,
    get() {
      return {
        get: async () => ({
          projectId: notebookId,
          title: "Notebook Under Test",
        }),
      };
    },
  });
  Object.defineProperty(NotebookLMClient.prototype, "sources", {
    configurable: true,
    get() {
      return {
        list: async () => [
          { sourceId: "source-a", title: "Source A", type: SourceType.TEXT, status: SourceStatus.READY },
        ],
      };
    },
  });
  Object.defineProperty(NotebookLMClient.prototype, "generation", {
    configurable: true,
    get() {
      return {
        chat: async () => ({
          text: "# 快速读书总结\n\n这是生成的内容。",
          citations: [],
        }),
      };
    },
  });

  const routeModule = await import("./index.js");
  const { insertChatMessage } = await import("../../db/chat-messages.js");
  const notebooks = routeModule.default;
  const notebookId = crypto.randomUUID();

  await insertChatMessage({
    id: crypto.randomUUID(),
    notebookId,
    role: "assistant",
    content: "已有研究历史",
    source: "research",
  });

  t.after(async () => {
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    if (originalNotebooks) {
      Object.defineProperty(NotebookLMClient.prototype, "notebooks", originalNotebooks);
    }
    if (originalSources) {
      Object.defineProperty(NotebookLMClient.prototype, "sources", originalSources);
    }
    if (originalGeneration) {
      Object.defineProperty(NotebookLMClient.prototype, "generation", originalGeneration);
    }
    const { disposeClient } = await import("../../notebooklm/index.js");
    await disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/report/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presetId: "builtin-quick-read" }),
  });

  assert.equal(response.status, 200);

  const entriesResponse = await notebooks.request(`http://localhost/${notebookId}/entries`);
  assert.equal(entriesResponse.status, 200);
  const entriesPayload = await entriesResponse.json() as {
    success: boolean;
    data: Array<{ id: string; presetId?: string | null; entryType: string; title: string | null }>;
  };
  assert.equal(entriesPayload.success, true);
  const summaryEntry = entriesPayload.data.find((entry) => entry.title === "快速读书总结");
  assert.ok(summaryEntry);
  assert.equal(summaryEntry?.entryType, "research_report");
  assert.equal(summaryEntry?.presetId, "builtin-quick-read");
});

test("POST /api/notebooks/:id/report/generate allows quick-read generation while auto research is running", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalGeneration = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "generation");
  const originalNotebooks = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "notebooks");
  const originalSources = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "sources");
  const notebookId = crypto.randomUUID();

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function () {};
  Object.defineProperty(NotebookLMClient.prototype, "notebooks", {
    configurable: true,
    get() {
      return {
        get: async () => ({
          projectId: notebookId,
          title: "Notebook Under Test",
        }),
      };
    },
  });
  Object.defineProperty(NotebookLMClient.prototype, "generation", {
    configurable: true,
    get() {
      return {
        chat: async () => ({
          text: "# 深度参与：一本书的结构与价值\n\n这是生成的内容。",
          citations: [],
        }),
      };
    },
  });

  registry.start(notebookId, 20);

  Object.defineProperty(NotebookLMClient.prototype, "sources", {
    configurable: true,
    get() {
      return {
        list: async () => [
          { sourceId: "source-a", title: "Source A", type: SourceType.TEXT, status: SourceStatus.READY },
        ],
      };
    },
  });

  const routeModule = await import("./index.js");
  const { insertChatMessage } = await import("../../db/chat-messages.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const notebooks = routeModule.default;

  await insertChatMessage({
    id: crypto.randomUUID(),
    notebookId,
    role: "assistant",
    content: "已有研究历史",
    source: "research",
  });

  t.after(async () => {
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    if (originalNotebooks) {
      Object.defineProperty(NotebookLMClient.prototype, "notebooks", originalNotebooks);
    }
    if (originalSources) {
      Object.defineProperty(NotebookLMClient.prototype, "sources", originalSources);
    }
    if (originalGeneration) {
      Object.defineProperty(NotebookLMClient.prototype, "generation", originalGeneration);
    }
    try {
      registry.requestStop(notebookId);
    } catch {}
    await disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/report/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presetId: "builtin-quick-read" }),
  });

  assert.equal(response.status, 200);
});

test("POST /api/notebooks/:id/report/generate sends enabled source ids for builtin quick-read isolation", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalNotebooks = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "notebooks");
  const originalSources = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "sources");
  const originalGeneration = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "generation");
  const notebookId = crypto.randomUUID();
  const captured: Array<{ prompt: string; sourceIds?: string[] }> = [];

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function () {};
  Object.defineProperty(NotebookLMClient.prototype, "notebooks", {
    configurable: true,
    get() {
      return {
        get: async () => ({ projectId: notebookId, title: "Notebook Under Test" }),
      };
    },
  });
  Object.defineProperty(NotebookLMClient.prototype, "sources", {
    configurable: true,
    get() {
      return {
        list: async () => [
          { sourceId: "source-a", title: "Source A", type: SourceType.TEXT, status: SourceStatus.READY },
          { sourceId: "source-b", title: "Source B", type: SourceType.TEXT, status: SourceStatus.READY },
        ],
      };
    },
  });
  Object.defineProperty(NotebookLMClient.prototype, "generation", {
    configurable: true,
    get() {
      return {
        chat: async (_id: string, prompt: string, options?: { sourceIds?: string[] }) => {
          captured.push({ prompt, sourceIds: options?.sourceIds });
          return { text: "# 深度参与\n\n内容", citations: [] };
        },
      };
    },
  });

  const routeModule = await import("./index.js");
  const { insertChatMessage } = await import("../../db/chat-messages.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const notebooks = routeModule.default;

  await insertChatMessage({
    id: crypto.randomUUID(),
    notebookId,
    role: "assistant",
    content: "已有研究历史",
    source: "research",
  });

  t.after(async () => {
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    if (originalNotebooks) {
      Object.defineProperty(NotebookLMClient.prototype, "notebooks", originalNotebooks);
    }
    if (originalSources) {
      Object.defineProperty(NotebookLMClient.prototype, "sources", originalSources);
    }
    if (originalGeneration) {
      Object.defineProperty(NotebookLMClient.prototype, "generation", originalGeneration);
    }
    await disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/report/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presetId: "builtin-quick-read" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(captured[0]?.sourceIds, ["source-a", "source-b"]);
  assert.match(captured[0]?.prompt ?? "", /文档内容/);
  assert.match(captured[0]?.prompt ?? "", /不得凭空捏造/);
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

  assert.equal(response.status, 200);
  const body = await response.json() as {
    success: boolean;
    data: Array<unknown>;
  };
  assert.equal(body.success, true);
  assert.deepEqual(body.data, []);
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

test("POST /api/notebooks/:id/research/start stores the requested target count in runtime state", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalNotebooks = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "notebooks");
  const originalSources = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "sources");
  const notebookId = crypto.randomUUID();

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function () {};
  Object.defineProperty(NotebookLMClient.prototype, "notebooks", {
    configurable: true,
    get() {
      return {
        get: async () => ({
          projectId: notebookId,
          title: "Notebook Under Test",
        }),
      };
    },
  });
  Object.defineProperty(NotebookLMClient.prototype, "sources", {
    configurable: true,
    get() {
      return {
        list: async () => [
          {
            sourceId: "source-1",
            title: "Book Source",
            type: SourceType.TEXT,
            status: SourceStatus.READY,
          },
        ],
      };
    },
  });

  const routeModule = await import("./index.js");
  const { disposeClient } = await import("../../notebooklm/index.js");
  const notebooks = routeModule.default;

  t.after(async () => {
    try {
      registry.requestStop(notebookId);
    } catch {}
    globalThis.fetch = originalFetch;
    NotebookLMClient.prototype.connect = originalConnect;
    if (originalNotebooks) {
      Object.defineProperty(NotebookLMClient.prototype, "notebooks", originalNotebooks);
    }
    if (originalSources) {
      Object.defineProperty(NotebookLMClient.prototype, "sources", originalSources);
    }
    await disposeClient();
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/research/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ numQuestions: 20 }),
  });

  assert.equal(response.status, 202);
  const runtime = registry.get(notebookId);
  assert.equal(runtime?.targetCount, 20);
});

test("POST /api/notebooks/:id/book-source/stream/upload-pdf rejects non-PDF uploads", async () => {
  const routeModule = await import("./index.js");
  const notebooks = routeModule.default;
  const notebookId = crypto.randomUUID();

  const formData = new FormData();
  formData.set("file", new File(["plain text"], "notes.txt", { type: "text/plain" }));

  const response = await notebooks.request(`http://localhost/${notebookId}/book-source/stream/upload-pdf`, {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    message: "仅支持 PDF 文件上传",
  });
});

test("POST /api/notebooks/:id/book-source/stream/upload-pdf extracts PDF text and submits it as a text source", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConnect = NotebookLMClient.prototype.connect;
  const originalSources = Object.getOwnPropertyDescriptor(NotebookLMClient.prototype, "sources");

  const captured: {
    notebookId?: string;
    title?: string;
    content?: string;
    addFromFileCalled: boolean;
    statusCalls: number;
  } = {
    addFromFileCalled: false,
    statusCalls: 0,
  };

  globalThis.fetch = async () =>
    new Response('<html><script>var data = {"SNlM0e":"fake-token"}</script></html>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  NotebookLMClient.prototype.connect = async function () {};
  Object.defineProperty(NotebookLMClient.prototype, "sources", {
    configurable: true,
    get() {
      return {
        addFromText: async (notebookId: string, input: { title: string; content: string }) => {
          captured.notebookId = notebookId;
          captured.title = input.title;
          captured.content = input.content;
          return { sourceIds: ["source-1"] };
        },
        addFromFile: async () => {
          captured.addFromFileCalled = true;
          return { sourceIds: ["source-file"] };
        },
        status: async () => {
          captured.statusCalls += 1;
          return {
            allReady: true,
            statuses: [
              {
                sourceId: "source-1",
                status: SourceStatus.READY,
                sourceType: SourceType.TEXT,
              },
            ],
          };
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
    if (originalSources) {
      Object.defineProperty(NotebookLMClient.prototype, "sources", originalSources);
    }
    disposeClient();
  });

  const pdfBuffer = Buffer.from(MINIMAL_PDF_BASE64, "base64");
  const formData = new FormData();
  formData.set("file", new File([pdfBuffer], "hello-book.pdf", { type: "application/pdf" }));

  const response = await notebooks.request(`http://localhost/${notebookId}/book-source/stream/upload-pdf`, {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");

  const body = await response.text();
  assert.match(body, /event: progress/);
  assert.match(body, /"step":"extracting"/);
  assert.match(body, /"step":"submitting"/);
  assert.match(body, /event: complete/);
  assert.equal(captured.notebookId, notebookId);
  assert.equal(captured.title, "hello-book.pdf");
  assert.match(captured.content ?? "", /Hello PDF/);
  assert.equal(captured.addFromFileCalled, false);
  assert.ok(captured.statusCalls >= 1);
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

test("POST /api/notebooks/:id/book-finder/search returns explicit config error when OPENAI settings are missing", async () => {
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  const previousToken = process.env.OPENAI_TOKEN;
  const previousModel = process.env.OPENAI_MODEL;

  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_TOKEN;
  delete process.env.OPENAI_MODEL;

  const routeModule = await import("./index.js");
  const notebooks = routeModule.default;

  try {
    const response = await notebooks.request("http://localhost/b6bc3be7-56ee-4cfc-8cd4-cb2f9d25ebc4/book-finder/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "组织管理" }),
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      success: false,
      message: "快速找书缺少必要配置：OPENAI_BASE_URL, OPENAI_TOKEN, OPENAI_MODEL",
      errorCode: "BOOK_FINDER_CONFIG_MISSING",
    });
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = previousBaseUrl;
    }

    if (previousToken === undefined) {
      delete process.env.OPENAI_TOKEN;
    } else {
      process.env.OPENAI_TOKEN = previousToken;
    }

    if (previousModel === undefined) {
      delete process.env.OPENAI_MODEL;
    } else {
      process.env.OPENAI_MODEL = previousModel;
    }
  }
});

test("GET /api/notebooks/:id/messages excludes persisted book finder messages from normal history", async () => {
  const notebookId = crypto.randomUUID();
  const routeModule = await import("./index.js");
  const { insertChatMessage } = await import("../../db/chat-messages.js");
  const notebooks = routeModule.default;

  await insertChatMessage({
    id: crypto.randomUUID(),
    notebookId,
    role: "user",
    content: "普通手动提问",
    source: "manual",
  });

  await insertChatMessage({
    id: crypto.randomUUID(),
    notebookId,
    role: "assistant",
    content: "普通研究回答",
    source: "research",
  });

  await insertChatMessage({
    id: `book-finder-user:${crypto.randomUUID()}`,
    notebookId,
    role: "user",
    content: "组织管理",
    source: "book_finder",
  });

  await insertChatMessage({
    id: crypto.randomUUID(),
    notebookId,
    role: "assistant",
    content: "# 快速找书结果\n\n检索主题：组织管理",
    source: "book_finder",
  });

  const response = await notebooks.request(`http://localhost/${notebookId}/messages`);
  assert.equal(response.status, 200);

  const body = await response.json() as {
    success: boolean;
    data: Array<{ id: string; content: string }>;
  };

  assert.equal(body.success, true);
  assert.deepEqual(body.data.map((message) => message.content), [
    "普通手动提问",
    "普通研究回答",
  ]);
});
