import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEStreamingApi } from "hono/streaming";
import { NotebookLMClient } from "notebooklm-kit";
import logger from "../../lib/logger.js";
import {
  addDiscoveredSources,
  addSourceFromFile,
  addSourceFromText,
  addSourceFromUrl,
  askNotebookForResearch,
  createNotebook,
  deleteSource,
  ensureNotebookAccessible,
  getNotebookDetail,
  getNotebookSources,
  getSourceProcessingStatus,
  isNotebookAuthError,
  listNotebooks,
  sendNotebookChatMessage,
  searchWebSources,
  createArtifact,
  getArtifact,
  ArtifactType,
  ArtifactState,
  type Artifact,
} from "../../notebooklm/index.js";
import {
  attachRegistrySubscription,
  startHeartbeat,
} from "./sse.js";
import { parseNotebookIdOrNull } from "./validate.js";
import { countChatMessages } from "../../db/chat-messages.js";
import { eq } from "drizzle-orm";
import db from "../../db/index.js";
import { summaryPresets } from "../../db/schema.js";
import {
  insertArtifactEntry,
  markArtifactEntryReady,
  markArtifactEntryFailed,
  markArtifactEntryFailedWithData,
  listEntriesByNotebookId,
  getEntryByArtifactId,
  getCurrentAudioEntry,
  deleteEntryById,
  insertReportEntry,
  replaceAudioArtifactEntry,
  type ReportEntryRecord,
} from "../../db/report-entries.js";
import { writeFile, unlink } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { resolveFilesDir } from "../../lib/files-dir.js";
import { createNotebookConversationAsker, createNotebookResearchDriver } from "../../research-runtime/chat-asker.js";
import { isRunning, runAutoResearch } from "../../research-runtime/orchestrator.js";
import { get as getRuntimeState, requestStop } from "../../research-runtime/registry.js";
import {
  invalidNotebookIdResponse,
  successResponse,
} from "./response.js";
import {
  parseDiscoveredSourcesBody,
  parseSearchBody,
  parseTextBody,
  parseUrlBody,
} from "./source-add-validate.js";
import {
  listEnabledSourceIds,
  listSourceStateMap,
  mergeSourceStates,
  deleteSourceState,
} from "../../source-state/service.js";
import { authManager, DEFAULT_ACCOUNT_ID } from "../../notebooklm/auth-manager.js";
import { insertChatMessage, listChatMessages } from "../../db/chat-messages.js";

const notebooks = new Hono();

// ---------------------------------------------------------------------------
// File storage helpers
// ---------------------------------------------------------------------------

/** Write a base64 string to data/files/ and return the relative filename. */
async function writeBase64File(base64: string, filename: string): Promise<string> {
  const dir = resolveFilesDir();
  mkdirSync(dir, { recursive: true });
  const fullPath = resolve(dir, filename);
  const buffer = Buffer.from(base64, "base64");
  await writeFile(fullPath, buffer);
  return filename;
}

/** Write a UTF-8 text string to data/files/ and return the relative filename. */
async function writeTextFile(text: string, filename: string): Promise<string> {
  const dir = resolveFilesDir();
  mkdirSync(dir, { recursive: true });
  const fullPath = resolve(dir, filename);
  await writeFile(fullPath, text, "utf-8");
  return filename;
}

/** Write binary bytes to data/files/ and return the relative filename. */
async function writeBinaryFile(data: Uint8Array | ArrayBuffer, filename: string): Promise<string> {
  const dir = resolveFilesDir();
  mkdirSync(dir, { recursive: true });
  const fullPath = resolve(dir, filename);
  const buffer = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(data);
  await writeFile(fullPath, buffer);
  return filename;
}

function extractBase64AudioData(payload: unknown): string | null {
  const seen = new Set<unknown>();

  function walk(value: unknown, depth: number): string | null {
    if (depth > 10 || value == null) return null;
    if (typeof value === "string") {
      const normalized = value.replace(/\s/g, "");
      if (normalized.length > 100 && /^[A-Za-z0-9+/=]+$/.test(normalized)) {
        return normalized;
      }
      return null;
    }

    if (typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    for (const nested of Object.values(value)) {
      const found = walk(nested, depth + 1);
      if (found) return found;
    }
    return null;
  }

  return walk(payload, 0);
}

function extractArtifactAudioUrlFromListResponse(payload: unknown, artifactId: string): string | null {
  let data = payload;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }

  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(data[0])) {
    return null;
  }

  for (const item of data[0]) {
    if (!Array.isArray(item) || item[0] !== artifactId) continue;

    const mediaData = item[6];
    if (!Array.isArray(mediaData)) continue;

    for (const directUrl of [mediaData[3], mediaData[2]]) {
      if (typeof directUrl === "string" && directUrl.startsWith("http")) {
        return directUrl;
      }
    }

    const variants = mediaData[5];
    if (!Array.isArray(variants)) continue;

    for (const variant of variants) {
      if (
        Array.isArray(variant)
        && typeof variant[0] === "string"
        && variant[0].startsWith("http")
        && typeof variant[2] === "string"
        && variant[2].startsWith("audio/")
      ) {
        return variant[0];
      }
    }
  }

  return null;
}

async function downloadBinaryFromUrl(url: string, cookies: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: {
      Cookie: cookies,
      Accept: "*/*",
      "User-Agent": "Mozilla/5.0",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Failed to download audio URL: HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
    throw new Error(`Audio URL returned HTML instead of media (${contentType || "unknown content-type"})`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const prefix = Buffer.from(bytes.slice(0, 32)).toString("utf8").toLowerCase();
  if (prefix.startsWith("<!doctype html") || prefix.startsWith("<html")) {
    throw new Error("Audio URL returned an HTML document instead of audio bytes");
  }

  return bytes;
}

async function downloadArtifactAudioFile(client: NotebookLMClient, artifactId: string, notebookId: string): Promise<Uint8Array> {
  const rpc = await client.getRPCClient();
  const overviewRequestTypes = [1, 0, 2, 3];

  for (const requestType of overviewRequestTypes) {
    try {
      const overviewResponse = await rpc.call("VUsiyb", [notebookId, requestType], notebookId);
      const overviewBase64 = extractBase64AudioData(overviewResponse);
      if (overviewBase64) {
        return Uint8Array.from(Buffer.from(overviewBase64, "base64"));
      }
    } catch {
      // Fall through to the next request type, then to artifact-specific fallback.
    }
  }

  const response = await rpc.call("Fxmvse", [
    [null, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]],
    artifactId,
    [[[0, 1000]]],
  ], notebookId);

  const base64 = extractBase64AudioData(response);
  if (base64) {
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }

  const listResponse = await rpc.call("gArtLc", [[2], notebookId], notebookId);
  const audioUrl = extractArtifactAudioUrlFromListResponse(listResponse, artifactId);
  if (!audioUrl) {
    throw new Error(`Failed to locate audio URL for artifact ${artifactId}`);
  }

  return await downloadBinaryFromUrl(audioUrl, rpc.getCookies());
}

async function withNotebookId(
  c: Context,
  handler: (id: string) => Promise<Response> | Response
): Promise<Response> {
  const id = parseNotebookIdOrNull(c.req.param("id"));
  if (!id) {
    return c.json(invalidNotebookIdResponse(), 400);
  }
  return await handler(id);
}

async function withNotebookAuthHandling(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (isNotebookAuthError(error)) {
      const message = error instanceof Error ? error.message : "Notebook authentication unavailable";
      return new Response(
        JSON.stringify({
          success: false,
          message,
          errorCode: "UNAUTHORIZED",
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        }
      );
    }

    throw error;
  }
}

notebooks.get("/", async (c) => {
  return await withNotebookAuthHandling(async () => {
    const response = await listNotebooks();
    return c.json(successResponse(response));
  });
});

notebooks.post("/", async (c) => {
  return await withNotebookAuthHandling(async () => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    const rawTitle = body["title"];
    const title = typeof rawTitle === "string" && rawTitle.trim()
      ? rawTitle.trim()
      : "新笔记本";
    const notebook = await createNotebook({ title });
    return c.json(successResponse(notebook), 201);
  });
});

notebooks.get("/:id", async (c) => {
  return await withNotebookId(c, async (id) => {
    return await withNotebookAuthHandling(async () => {
      const response = await getNotebookDetail(id);
      return c.json(successResponse(response));
    });
  });
});

notebooks.get("/:id/sources", async (c) => {
  return await withNotebookId(c, async (id) => {
    return await withNotebookAuthHandling(async () => {
      const sources = await getNotebookSources(id);
      return c.json(successResponse(sources));
    });
  });
});

notebooks.post("/:id/sources/add/url", async (c) => {
  return await withNotebookId(c, async (id) => {
    const parsed = parseUrlBody(await c.req.json().catch(() => ({})));
    if (!parsed.ok) {
      return c.json({ success: false, message: parsed.message }, 400);
    }

    return await withNotebookAuthHandling(async () => {
      const result = await addSourceFromUrl(id, parsed.value);
      return c.json(successResponse(result));
    });
  });
});

notebooks.post("/:id/sources/add/text", async (c) => {
  return await withNotebookId(c, async (id) => {
    const parsed = parseTextBody(await c.req.json().catch(() => ({})));
    if (!parsed.ok) {
      return c.json({ success: false, message: parsed.message }, 400);
    }

    return await withNotebookAuthHandling(async () => {
      const result = await addSourceFromText(id, parsed.value);
      return c.json(successResponse(result));
    });
  });
});

notebooks.post("/:id/sources/add/search", async (c) => {
  return await withNotebookId(c, async (id) => {
    const parsed = parseSearchBody(await c.req.json().catch(() => ({})));
    if (!parsed.ok) {
      return c.json({ success: false, message: parsed.message }, 400);
    }

    return await withNotebookAuthHandling(async () => {
      const result = await searchWebSources(id, parsed.value);
      return c.json(successResponse(result));
    });
  });
});

notebooks.post("/:id/sources/add/discovered", async (c) => {
  return await withNotebookId(c, async (id) => {
    const parsed = parseDiscoveredSourcesBody(await c.req.json().catch(() => null));
    if (!parsed.ok) {
      return c.json({ success: false, message: parsed.message }, 400);
    }

    return await withNotebookAuthHandling(async () => {
      const result = await addDiscoveredSources(id, parsed.value);
      return c.json(successResponse(result));
    });
  });
});

notebooks.post("/:id/sources/add/file", async (c) => {
  return await withNotebookId(c, async (id) => {
    const formData = await c.req.formData().catch(() => null);
    if (!formData) {
      return c.json({ success: false, message: "Invalid multipart form data" }, 400);
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return c.json({ success: false, message: "file is required" }, 400);
    }

    const content = Buffer.from(await file.arrayBuffer());
    return await withNotebookAuthHandling(async () => {
      const result = await addSourceFromFile(id, {
        fileName: file.name,
        mimeType: file.type || undefined,
        content,
      });

      return c.json(successResponse(result));
    });
  });
});

notebooks.get("/:id/sources/status", async (c) => {
  return await withNotebookId(c, async (id) => {
    return await withNotebookAuthHandling(async () => {
      const result = await getSourceProcessingStatus(id);
      return c.json(successResponse(result));
    });
  });
});

notebooks.delete("/:id/sources/:sourceId", async (c) => {
  return await withNotebookId(c, async (notebookId) => {
    const sourceId = c.req.param("sourceId");
    return await withNotebookAuthHandling(async () => {
      await deleteSource(notebookId, sourceId);
      // Clean up local source state (best-effort, non-fatal)
      try {
        await deleteSourceState(notebookId, sourceId);
      } catch (err) {
        logger.warn({ notebookId, sourceId, err }, "Failed to clean up source state");
      }
      return c.body(null, 204);
    });
  });
});

notebooks.get("/:id/messages", async (c) => {
  return await withNotebookId(c, async (id) => {
    try {
      const records = await listChatMessages(id);
      const messages = records.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt.toISOString(),
        status: "done",
      }));
      return c.json(successResponse(messages));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          success: false,
          message: `获取对话记录失败: ${message}`,
          errorCode: "MESSAGES_FETCH_FAILED",
        },
        502
      );
    }
  });
});

// Backward-compatible alias for old client path.
notebooks.get("/:id/chat/messages", async (c) => {
  return await withNotebookId(c, async (id) => {
    try {
      const records = await listChatMessages(id);
      const messages = records.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt.toISOString(),
        status: "done",
      }));
      return c.json(successResponse(messages));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          success: false,
          message: `获取对话记录失败: ${message}`,
          errorCode: "MESSAGES_FETCH_FAILED",
        },
        502
      );
    }
  });
});

notebooks.post("/:id/chat/messages", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body: {
      content?: string;
      conversationId?: string;
      conversationHistory?: Array<{ role: "user" | "assistant"; message: string }>;
    } = await c.req.json().catch(() => ({}));
    const content = body.content?.trim() ?? "";

    if (!content) {
      return c.json(
        {
          success: false,
          message: "content is required",
          errorCode: "INVALID_CONTENT",
        },
        400
      );
    }

    return await withNotebookAuthHandling(async () => {
      const sources = await getNotebookSources(id);
      const enabledMap = await listSourceStateMap(id);
      const mergedSources = mergeSourceStates(sources, enabledMap);
      const sourceIds = listEnabledSourceIds(mergedSources);

      if (sources.length === 0) {
        return c.json(
          {
            success: false,
            message: "该笔记本暂无来源，请先添加来源后再对话",
            errorCode: "NO_SOURCES",
          },
          400
        );
      }

      try {
        try {
          await insertChatMessage({
            id: crypto.randomUUID(),
            notebookId: id,
            role: "user",
            content: content,
            source: "manual",
          });
        } catch (dbErr) {
          logger.warn({ err: dbErr, notebookId: id }, "failed to persist user chat message to DB");
        }

        const response = await sendNotebookChatMessage(id, {
          prompt: content,
          ...(sourceIds.length > 0 ? { sourceIds } : {}),
          ...(body.conversationId ? { conversationId: body.conversationId } : {}),
          ...(body.conversationHistory?.length
            ? { conversationHistory: body.conversationHistory }
            : {}),
        });

        try {
          await insertChatMessage({
            id: response.messageIds?.[1] ?? crypto.randomUUID(),
            notebookId: id,
            role: "assistant",
            content: response.text,
            source: "manual",
          });
        } catch (dbErr) {
          logger.warn({ err: dbErr, notebookId: id }, "failed to persist assistant chat message to DB");
        }

        const messageId = response.messageIds?.[1];

        return c.json(
          successResponse({
            conversationId: response.conversationId ?? null,
            message: {
              id: messageId ?? crypto.randomUUID(),
              role: "assistant" as const,
              content: response.text,
              createdAt: new Date().toISOString(),
              status: "done" as const,
            },
            ...(response.messageIds ? { messageIds: response.messageIds } : {}),
          })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json(
          {
            success: false,
            message,
            errorCode: "CHAT_FAILED",
          },
          502
        );
      }
    });
  });
});

notebooks.get("/:id/research/stream", async (c) => {
  return await withNotebookId(c, (id) =>
    streamSSE(c, async (stream) => {
      logger.info({ notebookId: id }, "sse: client connected to research stream");
      const stopHeartbeat = startHeartbeat(stream);
      const unsubscribe = attachRegistrySubscription(stream, id);

      try {
        while (!stream.aborted) {
          await stream.sleep(15000);
        }
      } finally {
        stopHeartbeat();
        unsubscribe();
        logger.info({ notebookId: id }, "sse: client disconnected from research stream");
      }
    })
  );
});

notebooks.post("/:id/research/start", async (c) => {
  return await withNotebookId(c, async (id) => {
    if (isRunning(id)) {
      return c.json(
        {
          success: false,
          message: "该笔记已有研究任务正在运行",
          errorCode: "RESEARCH_ALREADY_RUNNING",
        },
        409
      );
    }

    const access = await ensureNotebookAccessible(id);
    if (!access.accessible) {
      const statusCode = access.error?.includes("authentication") ? 401 : 404;
      const errorCode = statusCode === 401 ? "UNAUTHORIZED" : "NOTEBOOK_NOT_ACCESSIBLE";

      return c.json(
        {
          success: false,
          message: access.error ?? "目标笔记不可访问",
          errorCode,
        },
        statusCode
      );
    }

    if (isRunning(id)) {
      return c.json(
        {
          success: false,
          message: "该笔记已有研究任务正在运行",
          errorCode: "RESEARCH_ALREADY_RUNNING",
        },
        409
      );
    }
    
    return await withNotebookAuthHandling(async () => {
      const sources = await getNotebookSources(id);
      const enabledMap = await listSourceStateMap(id);
      const mergedSources = mergeSourceStates(sources, enabledMap);
      const sourceIds = listEnabledSourceIds(mergedSources);

      if (sources.length === 0) {
        return c.json(
          {
            success: false,
            message: "该笔记本暂无来源，请先添加来源后再开始自动研究",
            errorCode: "NO_SOURCES",
          },
          400
        );
      }

      void runAutoResearch(
        id,
        createNotebookResearchDriver(id, sourceIds, sendNotebookChatMessage)
      ).catch((err) => {
        void err;
      });

      return c.json(
        successResponse(
          {
            status: "accepted",
            message: "自动研究已启动",
          },
          "自动研究已启动"
        ),
        202
      );
    });
  });
});

notebooks.post("/:id/research/stop", async (c) => {
  return await withNotebookId(c, async (id) => {
    const runtime = getRuntimeState(id);
    if (!runtime || runtime.status !== "running") {
      return c.json(
        {
          success: false,
          message: "当前没有正在运行的自动研究任务",
          errorCode: "RESEARCH_NOT_RUNNING",
        },
        409
      );
    }

    requestStop(id);
    return c.json(successResponse({ status: "stopping", message: "自动研究将在当前轮结束后停止" }));
  });
});

notebooks.post("/:id/report/generate", async (c) => {
  return await withNotebookId(c, async (id) => {
    const msgCount = await countChatMessages(id);
    if (msgCount <= 0) {
      return c.json(
        {
          success: false,
          message: "暂无可用于报告生成的自动研究问答资产",
          errorCode: "INSUFFICIENT_RESEARCH_ASSETS",
        },
        400
      );
    }

    // Resolve summaryPrompt: use preset if provided, else fall back to built-in default
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    const rawPresetId = typeof body["presetId"] === "string" ? body["presetId"].trim() : "";

    const DEFAULT_SUMMARY_PROMPT =
      `请基于该笔记本中的所有来源和此前对话内容，撰写一份系统性中文研究报告。

结构要求：
1. 执行摘要（200-300字）：概述研究背景、核心发现和关键结论
2. 研究方法与数据来源：简述所用来源类型及覆盖范围
3. 核心发现（按主题组织，每个主题需有：）
   - 主要发现陈述
   - 支撑证据与数据（引用具体来源内容）
   - 不同来源间的交叉验证或分歧
4. 深度分析
   - 因果关系与机制分析
   - 趋势与模式识别
   - 局限性与证据空白
5. 结论与建议
   - 核心结论（基于证据的确定性程度分级）
   - 具体可行的建议
   - 后续研究方向

格式要求：
- 使用 Markdown 格式
- 关键数据和引用使用引用块（>）标记来源
- 重要发现使用粗体标注
- 尽量详尽，不要省略细节`;

    let summaryPrompt = DEFAULT_SUMMARY_PROMPT;

    if (rawPresetId) {
      try {
        const preset = await db.query.summaryPresets.findFirst({
          where: eq(summaryPresets.id, rawPresetId),
        });
        if (preset?.prompt) {
          summaryPrompt = preset.prompt;
        } else {
          logger.warn({ presetId: rawPresetId, notebookId: id }, "preset not found, using default summary prompt");
        }
      } catch (dbErr) {
        logger.warn({ err: dbErr, presetId: rawPresetId }, "failed to load preset, using default prompt");
      }
    }

    return await withNotebookAuthHandling(async () => {
      const result = await askNotebookForResearch(id, summaryPrompt);
      if (!result.success || !result.answer) {
        return c.json(
          {
            success: false,
            message: result.error ?? "报告生成失败",
            errorCode: "REPORT_GENERATION_FAILED",
          },
          502
        );
      }

      // Extract title from the first heading line, or use a default
      const titleMatch = result.answer.match(/^#+\s+(.+)/m);
      const title = titleMatch?.[1]?.trim() ?? "研究报告";

      let reportFilename: string | undefined;
      try {
        reportFilename = `report-${crypto.randomUUID()}.md`;
        await writeTextFile(result.answer, reportFilename);
      } catch (fileErr) {
        logger.error({ err: fileErr, notebookId: id }, "Failed to write report markdown file");
        return c.json(
          { success: false, message: "报告文件写入失败", errorCode: "REPORT_GENERATION_FAILED" },
          500
        );
      }
      await insertReportEntry({
        notebookId: id,
        title,
        content: null,
        filePath: reportFilename,
        state: "ready",
      });

      return c.json(
        successResponse({
          message: "研究报告已生成",
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Artifact routes
// ---------------------------------------------------------------------------

// Maps ArtifactType numeric value → DB string key
const ARTIFACT_TYPE_TO_STRING: Partial<Record<number, string>> = {
  [ArtifactType.AUDIO]: "audio",
  [ArtifactType.VIDEO]: "video",
  [ArtifactType.SLIDE_DECK]: "slide_deck",
  [ArtifactType.MIND_MAP]: "mind_map",
  [ArtifactType.REPORT]: "report",
  [ArtifactType.FLASHCARDS]: "flashcards",
  [ArtifactType.QUIZ]: "quiz",
  [ArtifactType.INFOGRAPHIC]: "infographic",
};

// Maps DB string key → ArtifactType numeric value
const ARTIFACT_TYPE_TO_NUM: Record<string, number> = {
  audio: ArtifactType.AUDIO,
  video: ArtifactType.VIDEO,
  slide_deck: ArtifactType.SLIDE_DECK,
  mind_map: ArtifactType.MIND_MAP,
  report: ArtifactType.REPORT,
  flashcards: ArtifactType.FLASHCARDS,
  quiz: ArtifactType.QUIZ,
  infographic: ArtifactType.INFOGRAPHIC,
};

// Maps DB state string → ArtifactState numeric value
const ARTIFACT_STATE_TO_NUM: Record<string, number> = {
  creating: ArtifactState.CREATING,
  ready: ArtifactState.READY,
  failed: ArtifactState.FAILED,
};

/** Convert a ReportEntryRecord to the API response shape (matches SDK Artifact). */
function entryToApiArtifact(entry: ReportEntryRecord): Record<string, unknown> {
  let contentData: Record<string, unknown> = {};
  if (entry.contentJson) {
    try {
      contentData = JSON.parse(entry.contentJson) as Record<string, unknown>;
    } catch {
      logger.warn({ entryId: entry.id, artifactId: entry.artifactId }, "entryToApiArtifact: invalid JSON in contentJson, returning empty content");
    }
  }
  // Spread contentData FIRST so that our authoritative fields (type, state, title, etc.)
  // always win over anything that might be stored inside contentJson.
  return {
    ...contentData,
    artifactId: entry.artifactId,
    type: ARTIFACT_TYPE_TO_NUM[entry.artifactType ?? ''] ?? 0,
    state: ARTIFACT_STATE_TO_NUM[entry.state] ?? 0,
    title: entry.title ?? undefined,
    createdAt: entry.createdAt.toISOString(),
    fileUrl: entry.filePath ? `/api/files/${entry.filePath}` : null,
  };
}

/** Extract storable content fields from a READY SDK Artifact. */
function extractArtifactContent(artifact: Artifact): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const a = artifact as unknown as Record<string, unknown>;
  for (const key of ["audioData", "duration", "content", "questions", "totalQuestions", "flashcards", "csv"]) {
    if (a[key] !== undefined) data[key] = a[key];
  }
  return data;
}

async function persistReadyArtifact(notebookId: string, artifactId: string, artifact: Artifact): Promise<void> {
  const typeStr = ARTIFACT_TYPE_TO_STRING[artifact.type as number ?? -1] ?? "unknown";
  const rawContent = extractArtifactContent(artifact);
  let filePath: string | null = null;

  if (typeStr === "audio") {
    const filename = `audio-${crypto.randomUUID()}.mp3`;

    if (typeof rawContent["audioData"] === "string" && rawContent["audioData"].length > 0) {
      filePath = await writeBase64File(rawContent["audioData"] as string, filename);
      delete rawContent["audioData"];
    } else {
      const client = await authManager.getAuthenticatedSdkClient(DEFAULT_ACCOUNT_ID) as NotebookLMClient;
      try {
        const audioData = await downloadArtifactAudioFile(client, artifactId, notebookId);
        filePath = await writeBinaryFile(audioData, filename);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
    }
  } else if (typeStr === "report") {
    const markdownContent = rawContent["content"];
    if (typeof markdownContent === "string" && markdownContent.length > 0) {
      const filename = `artifact-report-${crypto.randomUUID()}.md`;
      filePath = await writeTextFile(markdownContent, filename);
      // Content is now persisted in the file; remove from JSON blob to avoid duplication
      delete rawContent["content"];
    }
  }

  const contentJsonStr = JSON.stringify(rawContent);
  const existingEntry = await getEntryByArtifactId(artifactId);
  if (!existingEntry) {
    await insertArtifactEntry({ notebookId, artifactId, artifactType: typeStr, title: artifact.title ?? null });
  }

  await markArtifactEntryReady(artifactId, {
    title: artifact.title ?? null,
    contentJson: contentJsonStr,
    filePath,
  });
}

notebooks.post("/:id/artifacts", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    const type = typeof body["type"] === "string" ? body["type"].trim() : "";

    if (!type) {
      return c.json({ success: false, message: "type is required", errorCode: "INVALID_TYPE" }, 400);
    }

    const options = (body["options"] ?? {}) as Record<string, unknown>;

    if (type === "audio") {
      const currentAudio = await getCurrentAudioEntry(id);
      if (currentAudio?.state === "creating") {
        return c.json({
          success: false,
          message: "当前已有音频任务生成中，请等待完成后再试",
          errorCode: "AUDIO_ALREADY_CREATING",
        }, 409);
      }
    }

    return await withNotebookAuthHandling(async () => {
      try {
        const result = await createArtifact(id, type, options);
        // Persist to report_entries before returning response
        if (result.artifactId) {
          const initState = result.state === "ready" ? "ready" : "creating";
          try {
            if (type === "audio") {
              await replaceAudioArtifactEntry({
                notebookId: id,
                artifactId: result.artifactId,
              });
            } else {
              await insertArtifactEntry({
                notebookId: id,
                artifactId: result.artifactId,
                artifactType: type,
                state: initState as "creating" | "ready" | "failed",
              });
            }
          } catch (dbErr) {
            logger.warn(
              { dbErr, notebookId: id, artifactId: result.artifactId },
              "report_entries insert failed (non-fatal)"
            );
          }
        }
        return c.json(successResponse(result));
      } catch (err) {
        logger.error({ err, notebookId: id, type }, "createArtifact failed");
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("Unknown artifact type")) {
          return c.json({ success: false, message, errorCode: "INVALID_TYPE" }, 400);
        }
        return c.json({ success: false, message, errorCode: "ARTIFACT_CREATE_FAILED" }, 502);
      }
    });
  });
});

notebooks.get("/:id/artifacts/:artifactId", async (c) => {
  return await withNotebookId(c, async (id) => {
    const artifactId = c.req.param("artifactId");

    // Cache only when the persisted entry is actually complete.
    // Audio rows with file_path = null were previously written in a broken READY state.
    const cachedEntry = await getEntryByArtifactId(artifactId).catch(() => null);
    const hasStructuredContent = Boolean(cachedEntry?.contentJson && cachedEntry.contentJson !== "{}");
    const hasFile = Boolean(cachedEntry?.filePath);
    const cacheComplete = (cachedEntry?.artifactType === "audio" || cachedEntry?.artifactType === "report")
      ? hasFile
      : hasStructuredContent || hasFile;
    if (cachedEntry && cachedEntry.state === "ready" && cacheComplete) {
      return c.json(successResponse(entryToApiArtifact(cachedEntry)));
    }

    return await withNotebookAuthHandling(async () => {
      try {
        const artifact = await getArtifact(id, artifactId);

        // Persist state transitions to report_entries.
        if (artifact.state === ArtifactState.READY) {
          try {
            await persistReadyArtifact(id, artifactId, artifact);
            const refreshedEntry = await getEntryByArtifactId(artifactId).catch(() => null);
            if (refreshedEntry) {
              return c.json(successResponse(entryToApiArtifact(refreshedEntry)));
            }
          } catch (dbErr) {
            if ((artifact.type as number) === ArtifactType.AUDIO) {
              logger.warn({
                dbErr,
                artifactId,
                notebookId: id,
                message: dbErr instanceof Error ? dbErr.message : String(dbErr),
              }, "audio ready artifact failed to persist playable file; marking failed");
              try {
                const client = await authManager.getAuthenticatedSdkClient(DEFAULT_ACCOUNT_ID) as NotebookLMClient;
                await client.artifacts.delete(artifactId, id);
              } catch (deleteErr) {
                logger.warn({ deleteErr, artifactId, notebookId: id }, "failed to delete remote audio artifact after persistence failure");
              }
              try {
                await markArtifactEntryFailedWithData(artifactId, {
                  title: artifact.title ?? null,
                });
              } catch (markErr) {
                logger.warn({ markErr, artifactId }, "failed to mark audio artifact as failed after persistence failure");
              }
              const failedEntry = await getEntryByArtifactId(artifactId).catch(() => null);
              if (failedEntry) {
                return c.json(successResponse(entryToApiArtifact(failedEntry)));
              }
            }
            logger.warn({
              dbErr,
              artifactId,
              message: dbErr instanceof Error ? dbErr.message : String(dbErr),
              stack: dbErr instanceof Error ? dbErr.stack : undefined,
            }, "artifact entry ready update failed (non-fatal)");
          }
        } else if (artifact.state === ArtifactState.FAILED) {
          markArtifactEntryFailed(artifactId).catch((dbErr) =>
            logger.warn({ dbErr, artifactId }, "artifact entry failed update failed (non-fatal)")
          );
        }

        return c.json(successResponse(artifact));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // If the SDK confirms the artifact is not in the notebook's artifact list at all,
        // it is permanently gone (e.g., NotebookLM expired it after a server restart).
        // Mark as failed in DB and return a FAILED state to the frontend so polling stops.
        if (message.includes("not found in list")) {
          logger.warn({ artifactId, notebookId: id }, "Artifact not found in NotebookLM list — marking as failed");
          try {
            await markArtifactEntryFailed(artifactId);
          } catch (dbErr) {
            logger.warn({ dbErr, artifactId }, "Failed to mark artifact as failed in DB");
          }
          const failedEntry = await getEntryByArtifactId(artifactId).catch(() => null);
          if (failedEntry) {
            return c.json(successResponse(entryToApiArtifact(failedEntry)));
          }
          // No DB entry — return a minimal failed response so frontend stops polling
          return c.json(successResponse({
            artifactId,
            type: 0,
            state: ArtifactState.FAILED,
          }));
        }

        return c.json({ success: false, message, errorCode: "ARTIFACT_FETCH_FAILED" }, 502);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Unified entries API
// ---------------------------------------------------------------------------

/**
 * GET /api/notebooks/:id/entries
 * Returns all report_entries for this notebook (research reports + artifacts), newest first.
 * Each entry includes a computed fileUrl when a file_path is present.
 */
notebooks.get("/:id/entries", async (c) => {
  return await withNotebookId(c, async (id) => {
    try {
      const rows = await listEntriesByNotebookId(id);
      const entries = rows.map((r) => {
        let contentJson: unknown = null;
        if (r.contentJson) {
          try {
            contentJson = JSON.parse(r.contentJson) as unknown;
          } catch {
            logger.warn({ entryId: r.id }, "GET entries: invalid JSON in contentJson, returning null");
          }
        }
        return {
          id: r.id,
          entryType: r.entryType,
          title: r.title,
          state: r.state,
          content: null,
          errorMessage: r.errorMessage,
          artifactId: r.artifactId,
          artifactType: r.artifactType,
          contentJson,
          fileUrl: r.filePath ? `/api/files/${r.filePath}` : null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        };
      });
      return c.json(successResponse(entries));
    } catch (err) {
      logger.error({ err, notebookId: id }, "listEntriesByNotebookId failed");
      return c.json({ success: false, message: "Failed to list entries", errorCode: "INTERNAL_SERVER_ERROR" }, 500);
    }
  });
});

/**
 * DELETE /api/notebooks/:id/entries/:entryId
 * Deletes a report_entry. If the entry has an associated file, deletes the file too.
 */
notebooks.delete("/:id/entries/:entryId", async (c) => {
  return await withNotebookId(c, async (id) => {
    const entryId = c.req.param("entryId");
    try {
      const deleted = await deleteEntryById(entryId, id);
      if (!deleted) {
        return c.json({ success: false, message: "Entry not found", errorCode: "NOT_FOUND" }, 404);
      }
      // Clean up associated file (non-fatal)
      if (deleted.filePath) {
        const dir = resolveFilesDir();
        const fullPath = resolve(dir, deleted.filePath);
        unlink(fullPath).catch((e) =>
          logger.warn({ e, filePath: deleted.filePath }, "Failed to delete artifact file (non-fatal)")
        );
      }
      return c.json(successResponse({ id: entryId }));
    } catch (err) {
      logger.error({ err, entryId }, "deleteEntryById failed");
      return c.json({ success: false, message: "Failed to delete entry", errorCode: "INTERNAL_SERVER_ERROR" }, 500);
    }
  });
});

// SSE streaming helper functions

async function emitProgress(stream: SSEStreamingApi, step: string, message: string): Promise<void> {
  try {
    await stream.writeSSE({ event: 'progress', data: JSON.stringify({ step, message }) });
  } catch { /* stream closed */ }
}

async function emitComplete(stream: SSEStreamingApi, result: object): Promise<void> {
  try {
    await stream.writeSSE({ event: 'complete', data: JSON.stringify(result) });
  } catch { /* stream closed */ }
}

async function pollUntilReady(
  notebookId: string,
  stream: SSEStreamingApi,
  timeoutMs = 90000,
  pollIntervalMs = 2000
): Promise<boolean> {
  const start = Date.now();
  let pollCount = 0;
  while (Date.now() - start < timeoutMs) {
    pollCount++;
    await new Promise<void>(resolve => setTimeout(resolve, pollIntervalMs));
    try {
      const status = await getSourceProcessingStatus(notebookId);
      if (status.allReady) return true;
      await emitProgress(stream, 'processing', `正在处理来源 (第${pollCount}次检查)...`);
    } catch {
      await emitProgress(stream, 'processing', `检查状态失败，继续等待... (${pollCount})`);
    }
  }
  return false;
}

// SSE streaming source endpoints

notebooks.post("/:id/sources/stream/add/url", async (c) => {
  const id = parseNotebookIdOrNull(c.req.param("id"));
  if (!id) return c.json(invalidNotebookIdResponse(), 400);

  const parsed = parseUrlBody(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ success: false, message: parsed.message }, 400);

  return streamSSE(c, async (stream) => {
    try {
      await emitProgress(stream, 'init', '正在准备连接...');
      await emitProgress(stream, 'submitting', '正在提交网页来源...');

      const result = await addSourceFromUrl(id, parsed.value);

      await emitProgress(stream, 'submitted', `来源已提交 (共${result.sourceIds.length}个)，等待处理...`);

      const ready = await pollUntilReady(id, stream);

      if (ready) {
        await emitComplete(stream, { success: true, result });
      } else {
        await emitComplete(stream, { success: false, timedOut: true, error: '来源处理超时，请稍后刷新查看状态' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emitComplete(stream, { success: false, error: message });
    }
  });
});

notebooks.post("/:id/sources/stream/add/text", async (c) => {
  const id = parseNotebookIdOrNull(c.req.param("id"));
  if (!id) return c.json(invalidNotebookIdResponse(), 400);

  const parsed = parseTextBody(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ success: false, message: parsed.message }, 400);

  return streamSSE(c, async (stream) => {
    try {
      await emitProgress(stream, 'init', '正在准备连接...');
      await emitProgress(stream, 'submitting', '正在提交文本来源...');

      const result = await addSourceFromText(id, parsed.value);

      await emitProgress(stream, 'submitted', `来源已提交，等待处理...`);

      const ready = await pollUntilReady(id, stream);

      if (ready) {
        await emitComplete(stream, { success: true, result });
      } else {
        await emitComplete(stream, { success: false, timedOut: true, error: '来源处理超时，请稍后刷新查看状态' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emitComplete(stream, { success: false, error: message });
    }
  });
});

notebooks.post("/:id/sources/stream/add/file", async (c) => {
  const id = parseNotebookIdOrNull(c.req.param("id"));
  if (!id) return c.json(invalidNotebookIdResponse(), 400);

  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ success: false, message: "Invalid multipart form data" }, 400);

  const file = formData.get("file");
  if (!(file instanceof File)) return c.json({ success: false, message: "file is required" }, 400);

  const content = Buffer.from(await file.arrayBuffer());
  const fileInfo = { fileName: file.name, mimeType: file.type || undefined, content };

  return streamSSE(c, async (stream) => {
    try {
      await emitProgress(stream, 'init', '正在准备连接...');
      await emitProgress(stream, 'submitting', `正在上传文件 "${file.name}"...`);

      const result = await addSourceFromFile(id, fileInfo);

      await emitProgress(stream, 'submitted', `文件已上传，等待处理...`);

      const ready = await pollUntilReady(id, stream);

      if (ready) {
        await emitComplete(stream, { success: true, result });
      } else {
        await emitComplete(stream, { success: false, timedOut: true, error: '来源处理超时，请稍后刷新查看状态' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emitComplete(stream, { success: false, error: message });
    }
  });
});

notebooks.post("/:id/sources/stream/search-and-add", async (c) => {
  const id = parseNotebookIdOrNull(c.req.param("id"));
  if (!id) return c.json(invalidNotebookIdResponse(), 400);

  const parsed = parseSearchBody(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ success: false, message: parsed.message }, 400);

  return streamSSE(c, async (stream) => {
    try {
      await emitProgress(stream, 'searching', '正在搜索网络来源...');

      const searchResult = await searchWebSources(id, parsed.value);

      const webSources = searchResult.web.map(item => ({ title: item.title, url: item.url }));
      const driveSources = searchResult.drive.map(item => ({
        fileId: item.fileId,
        title: item.title,
        mimeType: item.mimeType,
      }));

      const totalFound = webSources.length + driveSources.length;

      if (totalFound === 0) {
        await emitComplete(stream, { success: false, error: '未找到可添加来源，请调整搜索词后重试。' });
        return;
      }

      await emitProgress(stream, 'found', `找到 ${totalFound} 条来源，正在添加...`);

      const addResult = await addDiscoveredSources(id, {
        sessionId: searchResult.sessionId,
        ...(webSources.length ? { webSources } : {}),
        ...(driveSources.length ? { driveSources } : {}),
      });

      await emitProgress(stream, 'added', `已添加 ${addResult.sourceIds.length} 个来源，等待处理...`);

      const ready = await pollUntilReady(id, stream);

      if (ready) {
        await emitComplete(stream, { success: true, result: addResult });
      } else {
        await emitComplete(stream, { success: false, timedOut: true, error: '来源处理超时，请稍后刷新查看状态' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emitComplete(stream, { success: false, error: message });
    }
  });
});

export default notebooks;
