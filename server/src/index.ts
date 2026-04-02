import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import auth from "./routes/auth/index.js";
import research from "./routes/research/index.js";
import health from "./routes/health/index.js";

// Ensure DB is initialized on import
import "./db/index.js";

const app = new Hono();

app.use(cors());

// Mount routes
app.route("/api/auth", auth);
app.route("/api/research", research);
app.route("/api/health", health);

// Root
app.get("/", (c) => {
  return c.json({
    name: "notebooklm-research-engine",
    version: "0.1.0",
    endpoints: {
      auth: "/api/auth/status",
      research: "/api/research (POST/GET), /api/research/:id",
      health: "/api/health",
    },
  });
});

const port = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;
