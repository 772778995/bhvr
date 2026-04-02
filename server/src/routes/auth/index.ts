import { Hono } from "hono";
import { getAuthStatus } from "../../notebooklm/index.js";

const auth = new Hono();

// GET /api/auth/status — check if Google auth is valid
auth.get("/status", (c) => {
  const status = getAuthStatus();
  return c.json(status);
});

export default auth;
