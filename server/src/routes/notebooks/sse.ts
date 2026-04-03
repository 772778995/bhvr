/**
 * SSE (Server-Sent Events) helpers for Hono stream responses.
 *
 * These utilities format and send SSE-compliant frames, manage heartbeats,
 * and provide a thin abstraction so route handlers stay clean.
 *
 * SSE wire format (per HTML spec):
 *   event: <eventName>\n
 *   data: <jsonPayload>\n
 *   \n
 *
 * Usage in a Hono route:
 *   import { streamSSE } from "hono/streaming";
 *   return streamSSE(c, async (stream) => {
 *     const stop = startHeartbeat(stream);
 *     const cleanup = await attachRegistrySubscription(stream, notebookId);
 *     await stream.pipe(...);   // keep alive until client disconnects
 *     stop();
 *     cleanup();
 *   });
 */

import type { SSEStreamingApi } from "hono/streaming";
import logger from "../../lib/logger.js";
import type { ResearchRuntimeEvent, ResearchEventType } from "../../research-runtime/types.js";
import * as registry from "../../research-runtime/registry.js";
import type { RuntimeStateListener } from "../../research-runtime/types.js";

// ── Low-level SSE frame helpers ───────────────────────────────────────────────

/**
 * Write a single SSE event frame to the stream.
 *
 * @param stream    - Hono SSE streaming API.
 * @param eventName - The SSE `event:` field (e.g. "step_changed").
 * @param data      - Any JSON-serialisable value used as the `data:` field.
 */
export async function sendEvent(
  stream: SSEStreamingApi,
  eventName: ResearchEventType,
  data: unknown
): Promise<void> {
  try {
    await stream.writeSSE({
      event: eventName,
      data: JSON.stringify(data),
    });
  } catch (err) {
    // Stream may already be closed — log but do not throw.
    logger.debug({ err, eventName }, "sse: failed to write event (stream likely closed)");
  }
}

/**
 * Write a heartbeat frame to keep the connection alive
 * and prevent proxies from closing idle connections.
 *
 * We use the SSE `event: heartbeat` frame with empty data since Hono's
 * SSEMessage type does not expose a comment field.
 */
export async function sendHeartbeat(stream: SSEStreamingApi): Promise<void> {
  try {
    await stream.writeSSE({ event: "heartbeat", data: "" });
  } catch (err) {
    logger.debug({ err }, "sse: heartbeat write failed (stream likely closed)");
  }
}

// ── Heartbeat interval ────────────────────────────────────────────────────────

/**
 * Start a periodic heartbeat on the given SSE stream.
 *
 * Returns a `stop()` function that the caller MUST invoke when the stream
 * ends to prevent the interval from running indefinitely.
 *
 * @param stream          - Hono SSE streaming API.
 * @param intervalMs      - Heartbeat interval in milliseconds. Defaults to 25 000.
 */
export function startHeartbeat(
  stream: SSEStreamingApi,
  intervalMs = 25_000
): () => void {
  const timer = setInterval(() => {
    sendHeartbeat(stream).catch(() => {/* already logged inside sendHeartbeat */});
  }, intervalMs);

  return () => clearInterval(timer);
}

// ── Registry subscription bridge ─────────────────────────────────────────────

/**
 * Subscribe to the runtime registry for a notebook and forward every event
 * to the SSE stream.
 *
 * The subscription is established immediately, and the first event emitted is
 * always the current state snapshot (via registry.subscribe semantics).
 *
 * Returns an `unsubscribe()` cleanup function the caller MUST invoke when the
 * client disconnects to prevent stale listener accumulation.
 *
 * @param stream     - Hono SSE streaming API.
 * @param notebookId - The notebook whose runtime state to observe.
 */
export function attachRegistrySubscription(
  stream: SSEStreamingApi,
  notebookId: string
): () => void {
  const listener: RuntimeStateListener = (event: ResearchRuntimeEvent) => {
    sendEvent(stream, event.type, event.payload ?? null).catch(() => {
      // Logged inside sendEvent.
    });
  };

  registry.subscribe(notebookId, listener);

  return () => {
    registry.unsubscribe(notebookId, listener);
  };
}
