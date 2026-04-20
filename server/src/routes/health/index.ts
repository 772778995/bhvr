import { Hono } from "hono";
import { taskQueue } from "../../worker/queue.js";
import { getQuotaStatus } from "../../lib/quota.js";
import { getAuthStatus } from "../../notebooklm/index.js";

const health = new Hono();

health.get("/", async (c) => {
  const authMeta = await getAuthStatus();
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    quota: getQuotaStatus(),
    queue: {
      length: taskQueue.length,
      running: taskQueue.isRunning,
      paused: taskQueue.isPaused,
    },
    auth: {
      status: authMeta.status,
      lastCheckedAt: authMeta.lastCheckedAt,
      lastRefreshedAt: authMeta.lastRefreshedAt,
      ...(authMeta.error ? { error: authMeta.error } : {}),
    },
  });
});

export default health;
