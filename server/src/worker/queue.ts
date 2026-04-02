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

class TaskQueue {
  private queue: QueueItem[] = [];
  private running = false;

  enqueue(id: string, fn: TaskFn): void {
    this.queue.push({ id, fn });
    this.process();
  }

  get length(): number {
    return this.queue.length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async process(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.queue.length > 0) {
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

export const taskQueue = new TaskQueue();
