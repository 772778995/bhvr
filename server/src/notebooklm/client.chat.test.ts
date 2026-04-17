import assert from "node:assert/strict";
import test from "node:test";
import { E_TIMEOUT } from "async-mutex";

import { __testOnly, sendNotebookChatMessage, getNotebookMessages } from "./client.js";
import { configureAuthManager } from "./auth-manager.js";
import { getQuotaStatus } from "../lib/quota.js";

test("extractChatResponseText falls back to rawData when text is empty", () => {
  const result = __testOnly.extractChatResponseText({
    text: "",
    rawData: [["Recovered answer from raw data"]],
    chunks: [],
  });

  assert.equal(result, "Recovered answer from raw data");
});

test("extractChatResponseText falls back to longest chunk text when text is empty", () => {
  const result = __testOnly.extractChatResponseText({
    text: "",
    rawData: undefined,
    chunks: [
      {
        text: "short",
        response: "short",
      },
      {
        text: "Recovered answer from chunks",
        response: "Recovered answer from chunks",
      },
    ],
  });

  assert.equal(result, "Recovered answer from chunks");
});

test("buildChatContextItems uses message ids for continued conversations", () => {
  const result = __testOnly.buildChatContextItems({
    sourceIds: ["source-a", "source-b"],
    conversationId: "conv-1",
    messageIds: ["conv-1", "msg-1"],
  });

  assert.deepEqual(result, [
    [["conv-1"]],
    [["msg-1"]],
  ]);
});

test("buildChatContextItems uses sources for a new conversation", () => {
  const result = __testOnly.buildChatContextItems({
    sourceIds: ["source-a", "source-b"],
  });

  assert.deepEqual(result, [
    [["source-a"]],
    [["source-b"]],
  ]);
});

test("formatEmptyChatResponseError includes structural response hints", () => {
  const result = __testOnly.formatEmptyChatResponseError({
    text: "",
    conversationId: "conv-1",
    messageIds: ["conv-1", "msg-1"],
    rawData: [[""], null, { some: "value" }],
    chunks: [
      {
        text: "",
        response: "",
      },
    ],
  });

  assert.match(result, /Empty response from NotebookLM/);
  assert.match(result, /conversationId=conv-1/);
  assert.match(result, /messageIds=conv-1,msg-1/);
  assert.match(result, /rawData=array\(3\)/);
  assert.match(result, /chunks=1/);
  assert.match(result, /firstChunk=text:0,response:0,error:false,code:none,rawData:undefined/);
});

test("extractNotebookChatError prefers chunk error code details over empty response", () => {
  const result = __testOnly.extractNotebookChatError({
    chunks: [
      {
        isError: true,
        errorCode: 8,
      },
    ],
  });

  assert.equal(result, "您已达到每日对话次数上限，改日再来吧！");
});

test("mergeHistoryMessages flattens threads and excludes internal threads", () => {
  const messages = __testOnly.mergeHistoryMessages(
    [
      [
        { id: "a1", role: "assistant", content: "planner", createdAt: "2026-04-08T00:00:01.000Z", status: "done" },
      ],
      [
        { id: "u1", role: "user", content: "real q1", createdAt: "2026-04-08T00:00:02.000Z", status: "done" },
        { id: "s1", role: "assistant", content: "real a1", createdAt: "2026-04-08T00:00:03.000Z", status: "done" },
      ],
      [
        { id: "u2", role: "user", content: "real q2", createdAt: "2026-04-08T00:00:04.000Z", status: "done" },
      ],
    ],
    ["planner-thread"],
    ["planner-thread", "visible-thread-1", "visible-thread-2"]
  );

  assert.deepEqual(
    messages.map((message) => message.id),
    ["u1", "s1", "u2"]
  );
});

// ---------------------------------------------------------------------------
// Keyed request gate tests
// ---------------------------------------------------------------------------

test("runKeyedRequest: same operationKey tasks execute sequentially, not overlapping", async () => {
  const log: string[] = [];

  const gate = __testOnly.createKeyedRequestGate();

  const task = (label: string, delayMs: number) =>
    gate.run("generation.chat", async () => {
      log.push(`start:${label}`);
      await new Promise((r) => setTimeout(r, delayMs));
      log.push(`end:${label}`);
    });

  // Start both concurrently
  await Promise.all([task("A", 30), task("B", 10)]);

  assert.deepEqual(log, ["start:A", "end:A", "start:B", "end:B"]);
});

test("runKeyedRequest: different operationKeys can run in parallel", async () => {
  const log: string[] = [];

  const gate = __testOnly.createKeyedRequestGate();

  const p1 = gate.run("generation.chat", async () => {
    log.push("chat:start");
    await new Promise((r) => setTimeout(r, 40));
    log.push("chat:end");
  });

  const p2 = gate.run("notebooks.read", async () => {
    log.push("notebooks:start");
    await new Promise((r) => setTimeout(r, 10));
    log.push("notebooks:end");
  });

  await Promise.all([p1, p2]);

  // notebooks.read should finish before generation.chat (it's faster and not blocked)
  assert.equal(log[0], "chat:start");
  assert.equal(log[1], "notebooks:start");
  assert.equal(log[2], "notebooks:end");
  assert.equal(log[3], "chat:end");
});

test("runKeyedRequest: idle operationKey is cleaned up after execution", async () => {
  const gate = __testOnly.createKeyedRequestGate();

  await gate.run("generation.chat", async () => {
    // do nothing
  });

  assert.equal(gate.activeKeyCount(), 0, "Map should be empty after idle key completes");
});

test("runKeyedRequest: successful caller clears its queue-timeout timer", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const fakeTimer = { fake: true } as unknown as ReturnType<typeof setTimeout>;

  let setTimeoutCalls = 0;
  let clearTimeoutCalls = 0;
  let clearedTimer: ReturnType<typeof setTimeout> | undefined;

  globalThis.setTimeout = ((callback: (...args: any[]) => void, _delay?: number) => {
    setTimeoutCalls += 1;
    return fakeTimer;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
    clearTimeoutCalls += 1;
    clearedTimer = timer;
  }) as typeof clearTimeout;

  try {
    const gate = __testOnly.createKeyedRequestGate(50);

    await gate.run("generation.chat", async () => {
      // immediately succeeds
    });

    assert.equal(setTimeoutCalls, 1, "Should create exactly one queue-timeout timer");
    assert.equal(clearTimeoutCalls, 1, "Successful caller must clear its queue-timeout timer");
    assert.equal(clearedTimer, fakeTimer, "clearTimeout should receive the created timer handle");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("runKeyedRequest: key stays in map while a second task is queued", async () => {
  const gate = __testOnly.createKeyedRequestGate();
  let secondStarted = false;

  const first = gate.run("generation.chat", async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

  // Give first task time to acquire the lock, then queue second
  await new Promise((r) => setTimeout(r, 5));

  const second = gate.run("generation.chat", async () => {
    secondStarted = true;
  });

  // While second is queued, key should still be present
  assert.ok(gate.activeKeyCount() >= 1, "Key should exist while tasks are queued");

  await Promise.all([first, second]);
  assert.ok(secondStarted);
  assert.equal(gate.activeKeyCount(), 0, "Map should be empty after all tasks complete");
});

test("runKeyedRequest: waiting caller times out if lock holder never releases (uses short timeout gate)", async () => {
  // Use a 50 ms timeout gate so the test completes quickly without relying on wall-clock delays.
  const gate = __testOnly.createKeyedRequestGate(50);

  let holderResolve!: () => void;
  const holderRelease = new Promise<void>((r) => { holderResolve = r; });

  // First task: holds the lock until we explicitly release it.
  const holder = gate.run("generation.chat", () => holderRelease);

  // Give the first task time to acquire the lock before we queue the waiter.
  await new Promise((r) => setTimeout(r, 10));

  // Second task: should time out waiting for the lock (50 ms gate, lock held indefinitely).
  await assert.rejects(
    () => gate.run("generation.chat", async () => { /* never runs */ }),
    (err: unknown) => err === E_TIMEOUT,
    "Expected E_TIMEOUT when lock is not acquired within the timeout window"
  );

  // Release the holder so the test does not leak.
  holderResolve();
  await holder;
});

test("runKeyedRequest: key is cleaned up after timeout waiter resolves (no ghost entry)", async () => {
  // Regression test for the pendingCount fix.
  // Before the fix, a timed-out waiter's ghost acquire/release happened after
  // the caller's finally block, leaving the key in the map indefinitely.
  // With pendingCount tracking, the key is removed once the last pending caller
  // (the holder) finishes — even though the waiter already threw E_TIMEOUT.
  const gate = __testOnly.createKeyedRequestGate(40);

  let holderResolve!: () => void;
  const holderRelease = new Promise<void>((r) => { holderResolve = r; });

  // Holder: acquires the key and holds it.
  const holder = gate.run("generation.chat", () => holderRelease);

  // Let holder acquire before waiter queues.
  await new Promise((r) => setTimeout(r, 10));

  // Waiter: will time out after 40 ms.
  const waiterRejection = gate.run("generation.chat", async () => {}).catch((e) => e);

  // Wait for waiter to time out.
  const waiterError = await waiterRejection;
  assert.equal(waiterError, E_TIMEOUT, "Waiter should have been rejected with E_TIMEOUT");

  // Key must still be in the map: holder is still running, pendingCount > 0.
  assert.equal(gate.activeKeyCount(), 1, "Key must stay while holder is still running");

  // Release the holder.
  holderResolve();
  await holder;

  // Now all pending callers are done — key must be gone.
  assert.equal(gate.activeKeyCount(), 0, "Key must be cleaned up after holder releases post-timeout");
});

// ---------------------------------------------------------------------------
// Quota once-guard — real production path test
// ---------------------------------------------------------------------------

test("sendNotebookChatMessage: quota consumed exactly once even when auth retry fires", async () => {
  // --- Setup fake SDK client -------------------------------------------
  // chatCallCount is shared across all fake client instances for this test.
  let chatCallCount = 0;
  const FAKE_NOTEBOOK_ID = "test-notebook-id";

  function makeFakeClient() {
    return {
      dispose() {},
      connect: async () => {},
      generation: {
        chat: async (_notebookId: string, _prompt: string, _opts?: unknown) => {
          chatCallCount += 1;
          if (chatCallCount === 1) {
            // First attempt: simulate a 401 auth failure that isRecognizedAuthFailure detects
            throw new Error("401 Unauthorized — simulated auth failure");
          }
          // Second attempt (after auth retry): return a valid response
          return {
            text: "Hello from fake NotebookLM",
            citations: [],
            conversationId: "conv-fake",
            messageIds: ["msg-1", "msg-2"] as [string, string],
          };
        },
      },
    };
  }

  // --- Reconfigure authManager with fully controllable fakes ---------------
  configureAuthManager({
    now: () => new Date(),
    createRuntimeClient: async () => makeFakeClient(),
    silentRefresh: async () => ({ authToken: "fake-token", storageState: { cookies: [] } }),
    validateProfile: async () => ({ status: "ready" as const }),
    disposeRuntimeClient: async () => {},
  });

  // Override canAttemptSilentRefresh so tests don't need a real storage-state file
  __testOnly.canAttemptSilentRefreshOverride = () => true;

  try {
    const usedBefore = getQuotaStatus().used;

    const response = await sendNotebookChatMessage(FAKE_NOTEBOOK_ID, {
      prompt: "What is this about?",
    });

    // --- Assertions ----------------------------------------------------------
    // 1. The call ultimately succeeded (retry path worked)
    assert.equal(response.text, "Hello from fake NotebookLM");

    // 2. The underlying SDK chat method was called exactly twice (first attempt + retry)
    assert.equal(chatCallCount, 2, "SDK generation.chat should be called twice: first attempt + auth retry");

    // 3. Quota was consumed exactly once despite the operation callback running twice
    assert.equal(
      getQuotaStatus().used,
      usedBefore + 1,
      "Quota must be consumed exactly once even when auth retry triggers a second operation callback invocation"
    );
  } finally {
    // Restore hooks so subsequent tests are not affected
    __testOnly.canAttemptSilentRefreshOverride = null;
  }
});

// ---------------------------------------------------------------------------
// getNotebookMessages: history.rpc calls must be sequential, not concurrent
// ---------------------------------------------------------------------------

test("getNotebookMessages: listNotebookHistoryMessages called sequentially (maxInFlightRpc === 1)", async () => {
  const FAKE_NOTEBOOK_ID = "nb-serial-test";
  const THREAD_IDS = ["thread-alpha", "thread-beta", "thread-gamma"];

  // Track concurrency of khqZz (listNotebookHistoryMessages) calls
  let inFlightRpc = 0;
  let maxInFlightRpc = 0;

  // Minimal fake message record: [id, [seconds, nanos], roleCode=1, content]
  function fakeUserMessage(id: string) {
    return [id, [1744000000, 0], 1, `message from ${id}`];
  }

  function makeFakeClientForSerial() {
    return {
      dispose() {},
      connect: async () => {},
      rpc: async (method: string, args: unknown[], _notebookId: string) => {
        if (method === "hPTbtc") {
          // Return three thread ids in the format listNotebookHistoryThreadIds expects:
          // parsed shape: [ [[threadId1]], [[threadId2]], [[threadId3]] ]
          return JSON.stringify(THREAD_IDS.map((id) => [[id]]));
        }
        if (method === "khqZz") {
          // Track in-flight concurrency
          inFlightRpc += 1;
          if (inFlightRpc > maxInFlightRpc) maxInFlightRpc = inFlightRpc;

          // Small async delay so concurrent calls would overlap if launched in parallel
          await new Promise((r) => setTimeout(r, 20));

          const threadId = (args as unknown[])[3] as string;
          const result = inFlightRpc; // capture before decrement
          inFlightRpc -= 1;

          // Return one message per thread: [[record]]
          return JSON.stringify([[fakeUserMessage(threadId)]]);
        }
        throw new Error(`Unexpected rpc method: ${method}`);
      },
    };
  }

  configureAuthManager({
    now: () => new Date(),
    createRuntimeClient: async () => makeFakeClientForSerial() as never,
    silentRefresh: async () => ({ authToken: "fake", storageState: { cookies: [] } }),
    validateProfile: async () => ({ status: "ready" as const }),
    disposeRuntimeClient: async () => {},
  });
  __testOnly.canAttemptSilentRefreshOverride = () => true;

  try {
    const messages = await getNotebookMessages(FAKE_NOTEBOOK_ID);

    // 1. All three threads' messages were returned
    assert.equal(messages.length, 3, "Should have one message per thread");

    // 2. RPC calls never overlapped — max concurrency was exactly 1
    assert.equal(
      maxInFlightRpc,
      1,
      `history.rpc calls must be serial: maxInFlightRpc should be 1, got ${maxInFlightRpc}`
    );
  } finally {
    __testOnly.canAttemptSilentRefreshOverride = null;
  }
});
