import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import logger from "./lib/logger.js";
import auth from "./routes/auth/index.js";
import research from "./routes/research/index.js";
import health from "./routes/health/index.js";
import notebooks from "./routes/notebooks/index.js";
import { recoverInterruptedTasks } from "./worker/recovery.js";

// Ensure DB is initialized on import
import "./db/index.js";

const app = new Hono();

app.use(cors());

// Mount routes
app.route("/api/auth", auth);
app.route("/api/research", research);
app.route("/api/health", health);
app.route("/api/notebooks", notebooks);

// Root
app.get("/", (c) => {
  return c.json({
    name: "notebooklm-research-engine",
    version: "0.1.0",
    endpoints: {
      auth: "/api/auth/status",
      research: "/api/research (POST/GET), /api/research/:id",
      health: "/api/health",
      notebooks:
        "/api/notebooks/:id, /api/notebooks/:id/sources, /api/notebooks/:id/chat/messages, /api/notebooks/:id/studio/tools, /api/notebooks/:id/research",
    },
  });
});

const port = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, "Server running");
  recoverInterruptedTasks().catch((err) => {
    logger.error({ err }, "Failed to recover interrupted tasks");
  });
});

export default app;
