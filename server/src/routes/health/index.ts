import { Hono } from "hono";
import { taskQueue } from "../../worker/queue.js";

const health = new Hono();

health.get("/", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    queue: {
      length: taskQueue.length,
      running: taskQueue.isRunning,
    },
  });
});

export default health;
