/**
 * In-memory research runtime registry.
 *
 * Maintains one ResearchRuntimeState entry per notebook ID and broadcasts
 * state-change events to registered listeners (SSE connections).
 *
 * Design constraints:
 * - No persistence: all state is ephemeral and lives only in this process.
 * - One active run per notebook: calling start() while running is a no-op
 *   (callers should check get() first and return 409 if already running).
 * - Thread-safety: Node.js is single-threaded; no locking needed.
 */

import type {
  ResearchRuntimeState,
  ResearchRuntimeEvent,
  ResearchEventType,
  RuntimeStateListener,
} from "./types.js";

// ── Internal store ────────────────────────────────────────────────────────────

const stateMap = new Map<string, ResearchRuntimeState>();
const listenersMap = new Map<string, Set<RuntimeStateListener>>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function getOrCreateListeners(notebookId: string): Set<RuntimeStateListener> {
  let set = listenersMap.get(notebookId);
  if (!set) {
    set = new Set();
    listenersMap.set(notebookId, set);
  }
  return set;
}

function broadcast(notebookId: string, type: ResearchEventType): void {
  const listeners = listenersMap.get(notebookId);
  if (!listeners || listeners.size === 0) return;

  const state = stateMap.get(notebookId);
  const event: ResearchRuntimeEvent = {
    type,
    timestamp: now(),
    payload: state ? { ...state } : undefined,
  };

  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Individual listener failures must not crash the broadcast loop.
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the current state snapshot for a notebook, or undefined if none exists.
 * Callers receive a shallow copy so mutations do not affect the stored state.
 */
export function get(notebookId: string): ResearchRuntimeState | undefined {
  const state = stateMap.get(notebookId);
  return state ? { ...state } : undefined;
}

/**
 * Return the current state snapshot or a synthetic idle snapshot if none exists.
 * Useful for SSE connections that want to emit an initial event unconditionally.
 */
export function snapshot(notebookId: string): ResearchRuntimeState {
  const existing = get(notebookId);
  if (existing) return existing;

  return {
    notebookId,
    status: "idle",
    step: "idle",
    completedCount: 0,
    targetCount: 20,
    updatedAt: now(),
  };
}

/**
 * Mark a notebook's research run as started.
 * Initialises a fresh state entry with status "running" and step "starting".
 * Broadcasts a "step_changed" event to all current subscribers.
 *
 * @throws If a run is already in status "running" for this notebook.
 */
export function start(notebookId: string, targetCount = 20): ResearchRuntimeState {
  const existing = stateMap.get(notebookId);
  if (existing?.status === "running") {
    throw new Error(`Research run already in progress for notebook ${notebookId}`);
  }

  const state: ResearchRuntimeState = {
    notebookId,
    status: "running",
    step: "starting",
    completedCount: 0,
    targetCount,
    updatedAt: now(),
  };

  stateMap.set(notebookId, state);
  broadcast(notebookId, "step_changed");
  return { ...state };
}

/**
 * Apply a partial update to the stored state.
 * Automatically updates the `updatedAt` timestamp.
 * Broadcasts a "step_changed" or "progress" event depending on what changed.
 */
export function update(
  notebookId: string,
  patch: Partial<Omit<ResearchRuntimeState, "notebookId" | "updatedAt">>
): ResearchRuntimeState {
  const existing = stateMap.get(notebookId);
  if (!existing) {
    throw new Error(`No runtime state found for notebook ${notebookId}. Call start() first.`);
  }

  const prevCount = existing.completedCount;
  const updated: ResearchRuntimeState = {
    ...existing,
    ...patch,
    notebookId,
    updatedAt: now(),
  };

  stateMap.set(notebookId, updated);

  const eventType: ResearchEventType =
    patch.completedCount !== undefined && patch.completedCount !== prevCount
      ? "progress"
      : "step_changed";

  broadcast(notebookId, eventType);
  return { ...updated };
}

/**
 * Transition the run into a terminal "failed" state.
 * Broadcasts an "error" event.
 */
export function fail(notebookId: string, error: string): ResearchRuntimeState {
  const existing = stateMap.get(notebookId);

  const state: ResearchRuntimeState = {
    ...(existing ?? {
      notebookId,
      completedCount: 0,
      targetCount: 20,
    }),
    notebookId,
    status: "failed",
    step: "failed",
    lastError: error,
    updatedAt: now(),
  };

  stateMap.set(notebookId, state);
  broadcast(notebookId, "error");
  return { ...state };
}

/**
 * Transition the run into a terminal "completed" state.
 * Broadcasts a "completed" event.
 */
export function complete(notebookId: string): ResearchRuntimeState {
  const existing = stateMap.get(notebookId);

  const state: ResearchRuntimeState = {
    ...(existing ?? {
      notebookId,
      completedCount: 0,
      targetCount: 20,
    }),
    notebookId,
    status: "completed",
    step: "completed",
    updatedAt: now(),
  };

  stateMap.set(notebookId, state);
  broadcast(notebookId, "completed");
  return { ...state };
}

/**
 * Subscribe a listener to state-change events for a notebook.
 * The listener is called immediately with the current snapshot (type "snapshot"),
 * and subsequently whenever state changes.
 */
export function subscribe(notebookId: string, listener: RuntimeStateListener): void {
  const listeners = getOrCreateListeners(notebookId);
  listeners.add(listener);

  // Emit an initial snapshot so the subscriber is in sync immediately.
  const event: ResearchRuntimeEvent = {
    type: "snapshot",
    timestamp: now(),
    payload: snapshot(notebookId),
  };

  try {
    listener(event);
  } catch {
    // Don't let a bad listener prevent registration.
  }
}

/**
 * Unsubscribe a previously registered listener.
 * Safe to call even if the listener was never registered.
 */
export function unsubscribe(notebookId: string, listener: RuntimeStateListener): void {
  const listeners = listenersMap.get(notebookId);
  if (!listeners) return;
  listeners.delete(listener);
}
