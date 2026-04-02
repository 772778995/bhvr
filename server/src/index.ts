import { Hono } from "hono";
import { cors } from "hono/cors";
import auth from "./routes/auth";
import research from "./routes/research";
import health from "./routes/health";

// Ensure DB is initialized on import
import "./db";

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
      auth: "/api/auth/status, /api/auth/setup",
      research: "/api/research (POST/GET), /api/research/:id",
      health: "/api/health",
    },
  });
});

export default app;
