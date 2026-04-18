/**
 * Tests for TaskQueue auth-gate and resume behavior.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { TaskQueue } from "./queue.js";
import type { AuthGate } from "./queue.js";

function readyGate(): AuthGate {
  return { isReauthRequired: () => false };
}

function blockedGate(): AuthGate {
  return { isReauthRequired: () => true };
}

/** Returns a promise that resolves once the queue has drained (length 0 and not running). */
function waitForIdle(queue: TaskQueue, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function check() {
      if (queue.length === 0 && !queue.isRunning) {
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error(`Queue did not become idle within ${timeoutMs}ms`));
      } else {
        setImmediate(check);
      }
    }
    setImmediate(check);
  });
}

/** Returns a promise that resolves once queue.isPaused becomes true. */
function waitForPaused(queue: TaskQueue, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function check() {
      if (queue.isPaused) {
        resolve();
      } else if (!queue.isRunning && queue.length > 0) {
        // running stopped but not marked paused — treat as paused
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error(`Queue did not become paused within ${timeoutMs}ms`));
      } else {
        setImmediate(check);
      }
    }
    setImmediate(check);
  });
}

test("queue processes tasks normally when auth is ready", async () => {
  const queue = new TaskQueue(readyGate());
  const executed: string[] = [];

  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });

  queue.enqueue("t1", async () => {
    executed.push("t1");
    resolve();
  });

  await done;
  assert.deepEqual(executed, ["t1"]);
});

test("queue does not dequeue when reauth_required", async () => {
  const queue = new TaskQueue(blockedGate());
  const executed: string[] = [];

  queue.enqueue("t1", async () => {
    executed.push("t1");
  });

  await waitForPaused(queue);

  // Task should NOT have been executed
  assert.deepEqual(executed, []);
  // But task should still be in queue
  assert.equal(queue.length, 1);
  assert.equal(queue.isPaused, true);
});

test("resume() after auth restored processes pending tasks", async () => {
  let reauthRequired = true;
  const gate: AuthGate = { isReauthRequired: () => reauthRequired };
  const queue = new TaskQueue(gate);
  const executed: string[] = [];

  queue.enqueue("t1", async () => {
    executed.push("t1");
  });

  await waitForPaused(queue);
  assert.deepEqual(executed, [], "task should not run while blocked");

  // Restore auth and resume
  reauthRequired = false;

  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });
  // Re-enqueue wraps fn to signal completion; but t1 is already in queue.
  // Instead, wait for idle after resume.
  queue.resume();

  await waitForIdle(queue);
  assert.deepEqual(executed, ["t1"]);
  assert.equal(queue.isPaused, false);
});

test("enqueueIfNotPresent respects auth gate", async () => {
  const queue = new TaskQueue(blockedGate());
  const executed: string[] = [];

  const added = queue.enqueueIfNotPresent("t1", async () => {
    executed.push("t1");
  });

  assert.equal(added, true);
  await waitForPaused(queue);
  assert.deepEqual(executed, []);
  assert.equal(queue.length, 1);
});
