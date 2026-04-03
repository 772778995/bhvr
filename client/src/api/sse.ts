/**
 * SSE wrapper for the research runtime stream.
 *
 * Connects to GET /api/notebooks/:id/research/stream and parses
 * Server-Sent Events into typed ResearchRuntimeEvent objects, using
 * the backend event vocabulary:
 *   snapshot | step_changed | progress | error | completed | heartbeat
 *
 * Each non-heartbeat event carries a ResearchRuntimeState payload.
 */

import type { ResearchState, ResearchStatus, ResearchStep } from "./notebooks.js";

/** SSE event types emitted by the server research runtime. */
export type ResearchEventType =
  | "snapshot"
  | "step_changed"
  | "progress"
  | "error"
  | "completed"
  | "heartbeat";

/**
 * Wire shape of the payload the server sends with each non-heartbeat event.
 * Matches server ResearchRuntimeState.
 */
export interface ResearchRuntimePayload {
  notebookId: string;
  status: ResearchStatus;
  step: ResearchStep;
  completedCount: number;
  targetCount: number;
  updatedAt: string;
  lastError?: string;
}

export interface ResearchRuntimeEvent {
  type: ResearchEventType;
  timestamp?: string;
  payload?: ResearchRuntimePayload;
}

export interface ResearchStreamCallbacks {
  onEvent: (event: ResearchRuntimeEvent) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

/** Map a ResearchRuntimePayload to the client-side ResearchState shape. */
export function payloadToState(payload: ResearchRuntimePayload): ResearchState {
  return {
    status: payload.status,
    step: payload.step,
    completedCount: payload.completedCount,
    targetCount: payload.targetCount,
    lastError: payload.lastError,
  };
}

/**
 * Open an SSE connection to the research stream for the given notebook.
 *
 * Returns a cleanup function that closes the connection.
 */
export function subscribeResearchStream(
  notebookId: string,
  callbacks: ResearchStreamCallbacks,
): () => void {
  const url = `/api/notebooks/${notebookId}/research/stream`;
  const es = new EventSource(url);

  /** Parse a raw MessageEvent into a ResearchRuntimeEvent and dispatch it. */
  function dispatch(rawType: string, rawData: string): void {
    const type = rawType as ResearchEventType;

    // heartbeat carries no payload
    if (type === "heartbeat") {
      callbacks.onEvent({ type });
      return;
    }

    let payload: ResearchRuntimePayload | undefined;
    try {
      payload = JSON.parse(rawData) as ResearchRuntimePayload;
    } catch {
      // Malformed frame — report error and do not emit an event with undefined payload
      callbacks.onError?.(new Error(`SSE 帧解析失败（event: ${type}）`));
      return;
    }
    callbacks.onEvent({ type, payload });
  }

  // Handle named event types emitted by the server (primary path).
  // The backend always sets the `event:` field, so these listeners are
  // the authoritative handlers.
  const namedTypes: ResearchEventType[] = [
    "snapshot",
    "step_changed",
    "progress",
    "error",
    "completed",
    "heartbeat",
  ];

  for (const eventType of namedTypes) {
    es.addEventListener(eventType, (ev: Event) => {
      const msgEvent = ev as MessageEvent<string>;
      dispatch(eventType, msgEvent.data);
    });
  }

  es.onerror = () => {
    const err = new Error("研究流连接中断");
    callbacks.onError?.(err);
    // EventSource auto-reconnects; we only notify, not close.
  };

  return () => {
    es.close();
    callbacks.onClose?.();
  };
}
