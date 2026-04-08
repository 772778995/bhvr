import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEStreamingApi } from "hono/streaming";
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
  listArtifacts,
} from "../../notebooklm/index.js";
import {
  attachRegistrySubscription,
  startHeartbeat,
} from "./sse.js";
import { parseNotebookIdOrNull } from "./validate.js";
import {
  clearReportError,
  createReport,
  deleteReportById,
  getReportById,
  listReportsByNotebookId,
  setReportError,
} from "../../report/service.js";
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
import { insertChatMessage, listChatMessages } from "../../db/chat-messages.js";

const notebooks = new Hono();

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

notebooks.get("/:id/report", async (c) => {
  return await withNotebookId(c, async (id) => {
    const reports = await listReportsByNotebookId(id);
    // Return the latest report with content (backward-compatible)
    const row = reports.find((r) => r.content && r.generatedAt);
    if (!row) {
      return c.json(successResponse(null));
    }

    return c.json(
      successResponse({
        id: row.id,
        notebookId: row.notebookId,
        title: row.title,
        content: row.content,
        generatedAt: row.generatedAt!.toISOString(),
      })
    );
  });
});

notebooks.get("/:id/reports", async (c) => {
  return await withNotebookId(c, async (id) => {
    const reports = await listReportsByNotebookId(id);
    return c.json(
      successResponse(
        reports.map((r) => ({
          id: r.id,
          notebookId: r.notebookId,
          title: r.title,
          content: r.content,
          generatedAt: r.generatedAt?.toISOString() ?? null,
          errorMessage: r.errorMessage ?? null,
        }))
      )
    );
  });
});

notebooks.get("/:id/reports/:reportId", async (c) => {
  return await withNotebookId(c, async (id) => {
    const reportId = c.req.param("reportId");
    const row = await getReportById(reportId);
    if (!row || row.notebookId !== id) {
      return c.json({ success: false, message: "报告不存在", errorCode: "NOT_FOUND" }, 404);
    }

    return c.json(
      successResponse({
        id: row.id,
        notebookId: row.notebookId,
        title: row.title,
        content: row.content,
        generatedAt: row.generatedAt?.toISOString() ?? null,
        errorMessage: row.errorMessage ?? null,
      })
    );
  });
});

notebooks.delete("/:id/reports/:reportId", async (c) => {
  return await withNotebookId(c, async (id) => {
    const reportId = c.req.param("reportId");
    const row = await getReportById(reportId);
    if (!row || row.notebookId !== id) {
      return c.json({ success: false, message: "报告不存在", errorCode: "NOT_FOUND" }, 404);
    }

    await deleteReportById(reportId);
    return c.json(successResponse({ deleted: true }));
  });
});

notebooks.post("/:id/report/generate", async (c) => {
  return await withNotebookId(c, async (id) => {
    const runtime = getRuntimeState(id);
    if (!runtime || runtime.completedCount <= 0) {
      return c.json(
        {
          success: false,
          message: "暂无可用于报告生成的自动研究问答资产",
          errorCode: "INSUFFICIENT_RESEARCH_ASSETS",
        },
        400
      );
    }

    const summaryPrompt =
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

    return await withNotebookAuthHandling(async () => {
      const result = await askNotebookForResearch(id, summaryPrompt);
      if (!result.success || !result.answer) {
        await setReportError(id, result.error ?? "报告生成失败");
        return c.json(
          {
            success: false,
            message: result.error ?? "报告生成失败",
            errorCode: "REPORT_GENERATION_FAILED",
          },
          502
        );
      }

      await createReport(id, result.answer, new Date());
      await clearReportError(id);

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

notebooks.post("/:id/artifacts", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    const type = typeof body["type"] === "string" ? body["type"].trim() : "";

    if (!type) {
      return c.json({ success: false, message: "type is required", errorCode: "INVALID_TYPE" }, 400);
    }

    const options = (body["options"] ?? {}) as Record<string, unknown>;

    return await withNotebookAuthHandling(async () => {
      try {
        const result = await createArtifact(id, type, options);
        return c.json(successResponse(result));
      } catch (err) {
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

    return await withNotebookAuthHandling(async () => {
      try {
        const artifact = await getArtifact(id, artifactId);
        return c.json(successResponse(artifact));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ success: false, message, errorCode: "ARTIFACT_FETCH_FAILED" }, 502);
      }
    });
  });
});

notebooks.get("/:id/artifacts", async (c) => {
  return await withNotebookId(c, async (id) => {
    return await withNotebookAuthHandling(async () => {
      try {
        const artifacts = await listArtifacts(id);
        return c.json(successResponse(artifacts));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ success: false, message, errorCode: "ARTIFACTS_FETCH_FAILED" }, 502);
      }
    });
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
