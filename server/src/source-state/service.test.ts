import test from "node:test";
import assert from "node:assert/strict";
import { listEnabledSourceIds, mergeSourceStates } from "./service.js";

test("mergeSourceStates defaults to enabled=true when no persisted state", () => {
  const merged = mergeSourceStates(
    [
      { id: "s1", title: "A", type: "web", status: "ready", url: "https://a.com" },
      { id: "s2", title: "B", type: "pdf", status: "ready" },
    ],
    new Map(),
  );

  assert.equal(merged[0]?.enabled, true);
  assert.equal(merged[1]?.enabled, true);
});

test("mergeSourceStates applies persisted enabled=false", () => {
  const merged = mergeSourceStates(
    [{ id: "s1", title: "A", type: "web", status: "ready" }],
    new Map([["s1", false]])
  );

  assert.equal(merged[0]?.enabled, false);
});

test("listEnabledSourceIds returns only enabled source ids", () => {
  const ids = listEnabledSourceIds([
    { id: "a", enabled: true },
    { id: "b", enabled: false },
  ]);

  assert.deepEqual(ids, ["a"]);
});
