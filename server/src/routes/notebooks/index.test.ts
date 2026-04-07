import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NotebookLMClient, SourceStatus, SourceType } from "notebooklm-kit";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempHome = mkdtempSync(join(tmpdir(), "notebooklm-list-test-"));
const notebooklmDir = join(tempHome, ".notebooklm");

mkdirSync(notebooklmDir, { recursive: true });
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
