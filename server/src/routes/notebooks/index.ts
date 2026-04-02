import { Hono } from "hono";
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

function requireNotebookId(rawId: string | undefined): string | null {
  return getNotebookId(rawId);
}

notebooks.get("/:id", (c) => {
  const id = requireNotebookId(c.req.param("id"));
  if (!id) {
    return c.json(invalidNotebookIdResponse(), 400);
  }

  return c.json(successResponse(buildNotebookStub(id)));
});

notebooks.get("/:id/sources", (c) => {
  const id = requireNotebookId(c.req.param("id"));
  if (!id) {
    return c.json(invalidNotebookIdResponse(), 400);
  }

  return c.json(successResponse(buildNotebookSourcesStub(id)));
});

notebooks.get("/:id/chat/messages", (c) => {
  const id = requireNotebookId(c.req.param("id"));
  if (!id) {
    return c.json(invalidNotebookIdResponse(), 400);
  }

  return c.json(successResponse(buildChatMessagesStub(id)));
});

notebooks.get("/:id/studio/tools", (c) => {
  const id = requireNotebookId(c.req.param("id"));
  if (!id) {
    return c.json(invalidNotebookIdResponse(), 400);
  }

  return c.json(successResponse(buildStudioToolsStub(id)));
});

notebooks.get("/:id/research", (c) => {
  const id = requireNotebookId(c.req.param("id"));
  if (!id) {
    return c.json(invalidNotebookIdResponse(), 400);
  }

  return c.json(successResponse(buildResearchStub(id)));
});

notebooks.post("/:id/sources", (c) => {
  const id = requireNotebookId(c.req.param("id"));
  if (!id) {
    return c.json(invalidNotebookIdResponse(), 400);
  }

  return c.json(notImplementedResponse(), 501);
});

notebooks.post("/:id/chat/messages", (c) => {
  const id = requireNotebookId(c.req.param("id"));
  if (!id) {
    return c.json(invalidNotebookIdResponse(), 400);
  }

  return c.json(notImplementedResponse(), 501);
});

notebooks.post("/:id/studio/:tool", (c) => {
  const id = requireNotebookId(c.req.param("id"));
  if (!id) {
    return c.json(invalidNotebookIdResponse(), 400);
  }

  return c.json(notImplementedResponse(), 501);
});

notebooks.post("/:id/research", (c) => {
  const id = requireNotebookId(c.req.param("id"));
  if (!id) {
    return c.json(invalidNotebookIdResponse(), 400);
  }

  return c.json(notImplementedResponse(), 501);
});

export default notebooks;
