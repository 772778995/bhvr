import assert from "node:assert/strict";
import test from "node:test";

import { __testOnly } from "./client.js";

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
