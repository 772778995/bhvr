import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import logger from "./lib/logger.js";
import { createApp } from "./app.js";
import { recoverInterruptedTasks } from "./worker/recovery.js";
import { authManager, DEFAULT_ACCOUNT_ID, readAuthMeta } from "./notebooklm/index.js";
import { setQueueAuthGate } from "./worker/queue.js";

// Ensure DB is initialized on import
import "./db/index.js";

// Wire auth gate into the task queue so it pauses when reauth is needed
setQueueAuthGate({
  isReauthRequired: () => {
    const result = readAuthMeta(DEFAULT_ACCOUNT_ID);
    return result.ok ? result.value.status === "reauth_required" : false;
  },
});

// Resolve client/dist relative to this file at runtime.
// In production (Docker): server/dist/index.js → /app/server/dist/index.js
// client/dist is copied to  /app/client/dist
const __dirname = dirname(fileURLToPath(import.meta.url));
const staticDir = join(__dirname, "../../client/dist");
const staticEnabled = existsSync(staticDir);

if (staticEnabled) {
  logger.info({ staticDir }, "Frontend static serving enabled");
} else {
  logger.warn({ staticDir }, "Frontend static dir not found – static serving disabled, API-only mode");
}

const app = createApp({ staticDir });

// Default port is 3450 (not 3000) because Windows excludes TCP ports 3000–3001
// via the reserved port range. Override with PORT env var if needed.
const port = parseInt(process.env.PORT || "3450", 10);

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, "Server running");
  const authMonitor = authManager.startAuthHealthMonitor(DEFAULT_ACCOUNT_ID);

  process.once("SIGINT", () => {
    authMonitor.stop();
  });

  process.once("SIGTERM", () => {
    authMonitor.stop();
  });

  recoverInterruptedTasks().catch((err) => {
    logger.error({ err }, "Failed to recover interrupted tasks");
  });
});

export default app;
