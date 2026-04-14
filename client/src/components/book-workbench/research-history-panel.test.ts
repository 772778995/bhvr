import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ResearchHistoryPanel keeps user bubbles right-aligned and content-sized", () => {
  const source = readFileSync(new URL("./ResearchHistoryPanel.vue", import.meta.url), "utf8");

  assert.match(source, /message\.role === 'user' \? 'flex justify-end' : 'flex justify-start'/);
  assert.match(source, /inline-block shrink-0 max-w-\[75%\]/);
});
