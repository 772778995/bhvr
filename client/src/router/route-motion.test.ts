import assert from "node:assert/strict";
import test from "node:test";
import { getRouteTransition, getRouteTransitionName } from "./route-motion.js";

test("route motion uses paper transition for both editorial and workbench pages", () => {
  assert.equal(getRouteTransitionName({ to: "home", from: "home" }), "paper-route");
  assert.equal(getRouteTransitionName({ to: "book-workbench", from: "home" }), "paper-route");
  assert.equal(getRouteTransitionName({ to: "accounts-settings", from: "book-workbench" }), "paper-route");
});

test("route motion keeps whole-page transitions restrained to avoid drifting panels", () => {
  assert.deepEqual(getRouteTransition({ to: "book-workbench", from: "home" }), {
    name: "paper-route",
    enterY: 8,
    leaveY: -4,
    durationEnterMs: 180,
    durationLeaveMs: 120,
  });
});
