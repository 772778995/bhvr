import assert from "node:assert/strict";
import test from "node:test";
import {
  getAccountsPageMaxWidth,
  getNotebookListMaxWidth,
} from "./front-layout.js";

test("front-page widths use a wider editorial measure", () => {
  assert.equal(getNotebookListMaxWidth(), 960);
  assert.equal(getAccountsPageMaxWidth(), 980);
});
