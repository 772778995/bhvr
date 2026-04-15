import test from "node:test";
import assert from "node:assert/strict";
import type { Notebook } from "../api/notebooks.js";
import {
  createNotebookListState,
  createNotebookListViewModel,
  createNotebookWorkbenchPath,
} from "./notebook-list-view.js";

test("load stores notebooks and clears error after a successful fetch", async () => {
  const expected: Notebook[] = [
    {
      id: "nb-1",
      title: "Weekly research",
      description: "Latest notes",
      updatedAt: "2026-04-07T10:00:00.000Z",
    },
  ];

  const state = createNotebookListState({
    fetchNotebooks: async () => expected,
  });

  await state.load();

  assert.equal(state.loading.value, false);
  assert.equal(state.error.value, "");
  assert.deepEqual(state.notebooks.value, expected);
});

test("load stores the error message when fetching notebooks fails", async () => {
  const state = createNotebookListState({
    fetchNotebooks: async () => {
      throw new Error("network down");
    },
  });

  await state.load();

  assert.equal(state.loading.value, false);
  assert.equal(state.error.value, "network down");
  assert.deepEqual(state.notebooks.value, []);
});

test("openNotebook forwards the notebook workbench path", () => {
  const pushes: string[] = [];
  const state = createNotebookListState({
    fetchNotebooks: async () => [],
    navigate: (path: string) => {
      pushes.push(path);
    },
  });

  state.openNotebook("nb-42");

  assert.deepEqual(pushes, ["/book/nb-42"]);
  assert.equal(createNotebookWorkbenchPath("abc"), "/book/abc");
});

test("view model registers load on mounted and navigates through router push", async () => {
  const calls: string[] = [];
  let mounted: (() => void | Promise<void>) | undefined;

  const viewModel = createNotebookListViewModel({
    fetchNotebooks: async () => {
      calls.push("load");
      return [];
    },
    navigate: async (path: string) => {
      calls.push(path);
    },
    onMounted: (callback: () => void | Promise<void>) => {
      mounted = callback;
    },
  });

  assert.ok(mounted, "expected the view model to register an onMounted callback");

  await mounted?.();
  viewModel.openNotebook("nb-7");

  assert.deepEqual(calls, ["load", "/book/nb-7"]);
});

test("requestDeleteNotebook and cancelDeleteNotebook track the pending notebook", async () => {
  const notebook: Notebook = {
    id: "nb-1",
    title: "Weekly research",
    description: "Latest notes",
    updatedAt: "2026-04-07T10:00:00.000Z",
  };

  const state = createNotebookListState({
    fetchNotebooks: async () => [notebook],
  });

  await state.load();
  state.requestDeleteNotebook(notebook);
  assert.equal(state.pendingDeleteNotebook.value?.id, "nb-1");

  state.cancelDeleteNotebook();
  assert.equal(state.pendingDeleteNotebook.value, null);
});

test("confirmDeleteNotebook removes the deleted notebook from the list", async () => {
  const notebooks: Notebook[] = [
    {
      id: "nb-1",
      title: "Weekly research",
      description: "Latest notes",
      updatedAt: "2026-04-07T10:00:00.000Z",
    },
    {
      id: "nb-2",
      title: "Archive",
      description: "",
      updatedAt: "2026-04-06T10:00:00.000Z",
    },
  ];
  const deleted: string[] = [];

  const state = createNotebookListState({
    fetchNotebooks: async () => notebooks,
    deleteNotebook: async (id: string) => {
      deleted.push(id);
    },
  });

  await state.load();
  state.requestDeleteNotebook(notebooks[0]);
  await state.confirmDeleteNotebook();

  assert.deepEqual(deleted, ["nb-1"]);
  assert.deepEqual(state.notebooks.value.map((notebook) => notebook.id), ["nb-2"]);
  assert.equal(state.pendingDeleteNotebook.value, null);
  assert.equal(state.actionError.value, "");
});

test("confirmDeleteNotebook keeps the list and stores an action error when deletion fails", async () => {
  const notebook: Notebook = {
    id: "nb-1",
    title: "Weekly research",
    description: "Latest notes",
    updatedAt: "2026-04-07T10:00:00.000Z",
  };

  const state = createNotebookListState({
    fetchNotebooks: async () => [notebook],
    deleteNotebook: async () => {
      throw new Error("delete failed");
    },
  });

  await state.load();
  state.requestDeleteNotebook(notebook);
  await state.confirmDeleteNotebook();

  assert.deepEqual(state.notebooks.value, [notebook]);
  assert.equal(state.pendingDeleteNotebook.value, null);
  assert.equal(state.actionError.value, "delete failed");
});
