import { Hono } from "hono";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, extname, basename } from "node:path";
import { Readable } from "node:stream";
import logger from "../../lib/logger.js";
import { resolveFilesDir } from "../../lib/files-dir.js";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".md": "text/markdown; charset=utf-8",
};

const files = new Hono();

/**
 * GET /api/files/:filename
 *
 * Serves files from data/files/. Supports Range header for audio streaming.
 * Only serves files that exist — no directory traversal (basename validation).
 */
files.get("/:filename", async (c) => {
  const rawFilename = c.req.param("filename");

  // Security: only allow the basename, no path components
  const safe = basename(rawFilename);
  if (!safe || safe !== rawFilename || safe.startsWith(".")) {
    return c.json({ success: false, message: "Invalid filename" }, 400);
  }

  const dir = resolveFilesDir();
  const filePath = resolve(dir, safe);

  // Guard: path must still be inside dir after resolution
  if (!filePath.startsWith(dir)) {
    return c.json({ success: false, message: "Forbidden" }, 403);
  }

  if (!existsSync(filePath)) {
    return c.json({ success: false, message: "File not found" }, 404);
  }

  const ext = extname(safe).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";

  const stat = statSync(filePath);
  const totalSize = stat.size;

  const rangeHeader = c.req.header("range");

  if (rangeHeader) {
    // Handle Range request (required for audio <audio> element seeking)
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (!match) {
      return c.json({ success: false, message: "Invalid Range header" }, 416);
    }
    const start = parseInt(match[1] ?? "0", 10);
    const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

    if (start > end || end >= totalSize) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${totalSize}` },
      });
    }

    const chunkSize = end - start + 1;
    const stream = createReadStream(filePath, { start, end });

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  // Full file
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(totalSize),
      "Accept-Ranges": "bytes",
    },
  });
});

export default files;
