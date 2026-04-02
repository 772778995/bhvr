import { Hono } from "hono";
import { getAuthStatus, setupAuth } from "../../browser/auth";

const auth = new Hono();

// GET /api/auth/status — check if Google auth is valid
auth.get("/status", (c) => {
  const status = getAuthStatus();
  return c.json(status);
});

// POST /api/auth/setup — launch headful browser for manual Google login
auth.post("/setup", async (c) => {
  const status = getAuthStatus();
  if (status.authenticated) {
    return c.json({
      message: "Already authenticated. Use force=true to re-authenticate.",
      ...status,
    });
  }

  // This blocks until user completes login (up to 10 minutes)
  const success = await setupAuth();

  if (success) {
    return c.json({ message: "Authentication successful", authenticated: true });
  } else {
    return c.json(
      { message: "Authentication timed out or failed", authenticated: false },
      408
    );
  }
});

export default auth;
