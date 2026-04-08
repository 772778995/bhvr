import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  addDiscoveredSources,
  addSourceFromFile,
  addSourceFromText,
  addSourceFromUrl,
  askNotebookForResearch,
  createNotebook,
  ensureNotebookAccessible,
  getNotebookDetail,
  getNotebookMessages,
  getNotebookSources,
  getSourceProcessingStatus,
  isNotebookAuthError,
  listNotebooks,
  sendNotebookChatMessage,
  searchWebSources,
} from "../../notebooklm/index.js";
import {
  attachRegistrySubscription,
  startHeartbeat,
} from "./sse.js";
import { parseNotebookIdOrNull } from "./validate.js";
import {
  clearReportError,
  getReportByNotebookId,
  setReportError,
  upsertReport,
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
} from "../../source-state/service.js";

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

notebooks.get("/:id/messages", async (c) => {
  return await withNotebookId(c, async (id) => {
    return await withNotebookAuthHandling(async () => {
      try {
        const runtime = getRuntimeState(id);
        const messages = await getNotebookMessages(id, {
          hiddenThreadIds: runtime?.hiddenConversationIds,
          activeThreadId: runtime?.activeConversationId,
        });
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
});

// Backward-compatible alias for old client path.
notebooks.get("/:id/chat/messages", async (c) => {
  return await withNotebookId(c, async (id) => {
    return await withNotebookAuthHandling(async () => {
      try {
        const runtime = getRuntimeState(id);
        const messages = await getNotebookMessages(id, {
          hiddenThreadIds: runtime?.hiddenConversationIds,
          activeThreadId: runtime?.activeConversationId,
        });
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
        const response = await sendNotebookChatMessage(id, {
          prompt: content,
          ...(sourceIds.length > 0 ? { sourceIds } : {}),
          ...(body.conversationId ? { conversationId: body.conversationId } : {}),
          ...(body.conversationHistory?.length
            ? { conversationHistory: body.conversationHistory }
            : {}),
        });

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
      const stopHeartbeat = startHeartbeat(stream);
      const unsubscribe = attachRegistrySubscription(stream, id);

      try {
        while (!stream.aborted) {
          await stream.sleep(15000);
        }
      } finally {
        stopHeartbeat();
        unsubscribe();
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
    const row = await getReportByNotebookId(id);
    if (!row || !row.content || !row.generatedAt) {
      return c.json(successResponse(null));
    }

    return c.json(
      successResponse({
        id: row.notebookId,
        notebookId: row.notebookId,
        content: row.content,
        generatedAt: row.generatedAt.toISOString(),
      })
    );
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
      "请基于该笔记当前可用内容，生成一份结构化中文研究报告，包含：执行摘要、关键发现、分析过程、结论与建议。";

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

      await upsertReport(id, result.answer, new Date());
      await clearReportError(id);

      return c.json(
        successResponse({
          message: "研究报告已生成",
        })
      );
    });
  });
});

export default notebooks;
