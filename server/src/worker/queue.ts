/**
 * Simple FIFO task queue. Single-worker, processes one task at a time.
 * State is persisted in SQLite; the in-memory queue drives execution.
 */

import logger from "../lib/logger.js";

type TaskFn = () => Promise<void>;

interface QueueItem {
  id: string;
  fn: TaskFn;
}

export interface AuthGate {
  isReauthRequired(): boolean;
}

export class TaskQueue {
  private queue: QueueItem[] = [];
  private running = false;
  private paused = false;
  private authGate: AuthGate;

  constructor(authGate?: AuthGate) {
    this.authGate = authGate ?? { isReauthRequired: () => false };
  }

  enqueue(id: string, fn: TaskFn): void {
    this.queue.push({ id, fn });
    this.process();
  }

  /**
   * Enqueue a task only if it is not already in the queue.
   * Returns true if the task was enqueued, false if it was already present.
   */
  enqueueIfNotPresent(id: string, fn: TaskFn): boolean {
    if (this.queue.some((item) => item.id === id)) {
      return false;
    }
    this.enqueue(id, fn);
    return true;
  }

  /**
   * Resume queue processing after auth has been restored.
   * Call this after a successful reauth to re-trigger the processing loop.
   */
  resume(): void {
    this.paused = false;
    this.process();
  }

  get length(): number {
    return this.queue.length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  private async process(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.queue.length > 0) {
      // Auth gate: check before dequeuing
      if (this.authGate.isReauthRequired()) {
        this.paused = true;
        this.running = false;
        return;
      }

      this.paused = false;
      const item = this.queue.shift()!;
      try {
        await item.fn();
      } catch (err) {
        logger.error({ taskId: item.id, err }, "Task failed");
      }
    }

    this.running = false;
  }
}

// Default auth gate reads from authManager — wired at startup
let defaultAuthGate: AuthGate = { isReauthRequired: () => false };

export function setQueueAuthGate(gate: AuthGate): void {
  defaultAuthGate = gate;
}

export const taskQueue = new TaskQueue({
  isReauthRequired: () => defaultAuthGate.isReauthRequired(),
});
