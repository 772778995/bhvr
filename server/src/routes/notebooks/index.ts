import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  addDiscoveredSources,
  addSourceFromFile,
  addSourceFromText,
  addSourceFromUrl,
  askNotebookForResearch,
  ensureNotebookAccessible,
  getAuthStatus,
  getNotebookDetail,
  getNotebookMessages,
  getNotebookSources,
  getSourceProcessingStatus,
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
import { isRunning, runAutoResearch } from "../../research-runtime/orchestrator.js";
import { get as getRuntimeState } from "../../research-runtime/registry.js";
import {
  invalidNotebookIdResponse,
  successResponse,
} from "./response.js";
import {
  listEnabledSourceIds,
  listSourceStateMap,
  mergeSourceStates,
  setSourceEnabled,
} from "../../source-state/service.js";
import {
  parseSearchBody,
  parseTextBody,
  parseUrlBody,
} from "./source-add-validate.js";

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

notebooks.use("*", async (c, next) => {
  const authStatus = getAuthStatus();
  if (!authStatus.authenticated) {
    return c.json(
      {
        success: false,
        message: 'Not authenticated. Run "npx notebooklm login" first.',
        errorCode: "UNAUTHORIZED",
      },
      401
    );
  }
  await next();
});

notebooks.get("/:id", async (c) => {
  return await withNotebookId(c, async (id) => {
    const response = await getNotebookDetail(id);
    return c.json(successResponse(response));
  });
});

notebooks.get("/:id/sources", async (c) => {
  return await withNotebookId(c, async (id) => {
    const [sources, stateMap] = await Promise.all([
      getNotebookSources(id),
      listSourceStateMap(id),
    ]);

    return c.json(successResponse(mergeSourceStates(sources, stateMap)));
  });
});

notebooks.post("/:id/sources/:sourceId/toggle", async (c) => {
  return await withNotebookId(c, async (id) => {
    const sourceId = c.req.param("sourceId")?.trim();
    if (!sourceId) {
      return c.json(
        {
          success: false,
          message: "Invalid source id",
          errorCode: "INVALID_SOURCE_ID",
        },
        400
      );
    }

    const body: { enabled?: boolean } = await c.req
      .json<{ enabled?: boolean }>()
      .catch(() => ({}));
    const { enabled } = body;

    if (typeof enabled !== "boolean") {
      return c.json(
        {
          success: false,
          message: "enabled must be boolean",
          errorCode: "INVALID_ENABLED",
        },
        400
      );
    }

    await setSourceEnabled(id, sourceId, enabled);
    return c.json(successResponse({ sourceId, enabled }));
  });
});

notebooks.post("/:id/sources/add/url", async (c) => {
  return await withNotebookId(c, async (id) => {
    const parsed = parseUrlBody(await c.req.json().catch(() => ({})));
    if (!parsed.ok) {
      return c.json({ success: false, message: parsed.message }, 400);
    }

    const result = await addSourceFromUrl(id, parsed.value);
    return c.json(successResponse(result));
  });
});

notebooks.post("/:id/sources/add/text", async (c) => {
  return await withNotebookId(c, async (id) => {
    const parsed = parseTextBody(await c.req.json().catch(() => ({})));
    if (!parsed.ok) {
      return c.json({ success: false, message: parsed.message }, 400);
    }

    const result = await addSourceFromText(id, parsed.value);
    return c.json(successResponse(result));
  });
});

notebooks.post("/:id/sources/add/search", async (c) => {
  return await withNotebookId(c, async (id) => {
    const parsed = parseSearchBody(await c.req.json().catch(() => ({})));
    if (!parsed.ok) {
      return c.json({ success: false, message: parsed.message }, 400);
    }

    const result = await searchWebSources(id, parsed.value);
    return c.json(successResponse(result));
  });
});

notebooks.post("/:id/sources/add/discovered", async (c) => {
  return await withNotebookId(c, async (id) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ success: false, message: "Invalid request body" }, 400);
    }

    const result = await addDiscoveredSources(id, body as any);
    return c.json(successResponse(result));
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
    const result = await addSourceFromFile(id, {
      fileName: file.name,
      mimeType: file.type || undefined,
      content,
    });

    return c.json(successResponse(result));
  });
});

notebooks.get("/:id/sources/status", async (c) => {
  return await withNotebookId(c, async (id) => {
    const result = await getSourceProcessingStatus(id);
    return c.json(successResponse(result));
  });
});

notebooks.get("/:id/messages", async (c) => {
  return await withNotebookId(c, async (id) => {
    const result = await getNotebookMessages(id);
    return c.json(
      successResponse(
        result.messages,
        result.degraded ? "NotebookLM 未提供历史会话接口，当前为降级空结果" : undefined
      )
    );
  });
});

// Backward-compatible alias for old client path.
notebooks.get("/:id/chat/messages", async (c) => {
  return await withNotebookId(c, async (id) => {
    const result = await getNotebookMessages(id);
    return c.json(
      successResponse(
        result.messages,
        result.degraded ? "NotebookLM 未提供历史会话接口，当前为降级空结果" : undefined
      )
    );
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
      return c.json(
        {
          success: false,
          message: access.error ?? "目标笔记不可访问",
          errorCode: "NOTEBOOK_NOT_ACCESSIBLE",
        },
        404
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

    const sources = await getNotebookSources(id);
    const stateMap = await listSourceStateMap(id);
    const merged = mergeSourceStates(sources, stateMap);
    const enabledSourceIds = listEnabledSourceIds(merged);

    void runAutoResearch(
      id,
      (notebookId, prompt) =>
        askNotebookForResearch(notebookId, prompt, enabledSourceIds)
    ).catch((err) => {
      // Error is tracked in runtime state by orchestrator.fail(); swallow here.
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

export default notebooks;
