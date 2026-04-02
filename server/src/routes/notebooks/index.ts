import { Hono, type Context } from "hono";
import { getAuthStatus } from "../../notebooklm/index.js";
import {
  buildChatMessagesStub,
  buildNotebookSourcesStub,
  buildNotebookStub,
  buildResearchStub,
  buildStudioToolsStub,
} from "./stub-data.js";
import {
  invalidNotebookIdResponse,
  notImplementedResponse,
  successResponse,
} from "./response.js";

const notebooks = new Hono();

function getNotebookId(rawId: string | undefined): string | null {
  const id = rawId?.trim();
  if (!id) {
    return null;
  }
  return id;
}

function withNotebookId(c: Context, handler: (id: string) => Response): Response {
  const id = getNotebookId(c.req.param("id"));
  if (!id) {
    return c.json(invalidNotebookIdResponse(), 400);
  }
  return handler(id);
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

notebooks.get("/:id", (c) => {
  return withNotebookId(c, (id) => c.json(successResponse(buildNotebookStub(id))));
});

notebooks.get("/:id/sources", (c) => {
  return withNotebookId(c, (id) => c.json(successResponse(buildNotebookSourcesStub(id))));
});

notebooks.get("/:id/chat/messages", (c) => {
  return withNotebookId(c, (id) => c.json(successResponse(buildChatMessagesStub(id))));
});

notebooks.get("/:id/studio/tools", (c) => {
  return withNotebookId(c, (id) => c.json(successResponse(buildStudioToolsStub(id))));
});

notebooks.get("/:id/research", (c) => {
  return withNotebookId(c, (id) => c.json(successResponse(buildResearchStub(id))));
});

notebooks.post("/:id/sources", (c) => {
  return withNotebookId(c, () => c.json(notImplementedResponse(), 501));
});

notebooks.post("/:id/chat/messages", (c) => {
  return withNotebookId(c, () => c.json(notImplementedResponse(), 501));
});

notebooks.post("/:id/studio/:tool", (c) => {
  return withNotebookId(c, () => c.json(notImplementedResponse(), 501));
});

notebooks.post("/:id/research", (c) => {
  return withNotebookId(c, () => c.json(notImplementedResponse(), 501));
});

export default notebooks;
