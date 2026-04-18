/**
 * app.ts – Pure app factory with no side effects.
 *
 * `createApp()` builds and returns the Hono app without binding any port.
 * The actual `serve()` call lives in `index.ts` (the real startup entrypoint).
 *
 * Options:
 *   staticDir – absolute path to the compiled client dist directory.
 *               When provided, server will serve static files and SPA fallback.
 *               When omitted (or absent), non-API routes return 404.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import logger from "./lib/logger.js";
import auth from "./routes/auth/index.js";
import research from "./routes/research/index.js";
import health from "./routes/health/index.js";
import notebooks from "./routes/notebooks/index.js";
import presetsRouter from "./routes/presets/index.js";
import filesRouter from "./routes/files/index.js";

export interface AppOptions {
  /** Absolute path to client/dist. If omitted, static serving is disabled. */
  staticDir?: string;
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  app.use(cors());

  app.onError((err, c) => {
    logger.error({ err, path: c.req.path, method: c.req.method }, "Unhandled request error");
    return c.json(
      {
        success: false,
        message: err instanceof Error ? err.message : "Internal Server Error",
        errorCode: "INTERNAL_SERVER_ERROR",
      },
      500
    );
  });

  // ── API routes (always registered, take priority) ──────────────────────────
  app.route("/api/auth", auth);
  app.route("/api/research", research);
  app.route("/api/health", health);
  app.route("/api/notebooks", notebooks);
  app.route("/api/presets", presetsRouter);
  app.route("/api/files", filesRouter);

  // ── Static file serving + SPA fallback ────────────────────────────────────
  const { staticDir } = options;

  if (staticDir && existsSync(staticDir)) {
    // Cache index.html once at startup to avoid repeated synchronous reads per request.
    const indexPath = join(staticDir, "index.html");
    const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : null;

    // Serve real static files (assets, favicon, etc.)
    app.use(
      "/*",
      serveStatic({
        root: staticDir,
        rewriteRequestPath: (path) => path,
      })
    );

    // SPA fallback – any unmatched non-API request returns the cached index.html
    if (indexHtml !== null) {
      app.get("/*", (c) => c.html(indexHtml, 200));
    }
  }

  return app;
}
