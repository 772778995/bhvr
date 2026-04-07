import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppRoutes,
  createHomeNotebookListEntry,
} from "./navigation";

test("app routes register the notebook list route without replacing notebook workbench", () => {
  const homeView = { name: "HomeView" };
  const notebookListView = { name: "NotebookListView" };
  const notebookWorkbenchView = { name: "NotebookWorkbenchView" };
  const routes = createAppRoutes({
    homeView,
    notebookListView,
    notebookWorkbenchView,
  });

  const notebookListRoute = routes.find((route) => route.name === "notebook-list");
  const notebookWorkbenchRoute = routes.find(
    (route) => route.name === "notebook-workbench",
  );

  assert.ok(notebookListRoute);
  assert.equal(notebookListRoute.path, "/notebooks");
  assert.equal(notebookListRoute.component, notebookListView);

  assert.ok(notebookWorkbenchRoute);
  assert.equal(notebookWorkbenchRoute.path, "/notebook/:id");
  assert.equal(notebookWorkbenchRoute.component, notebookWorkbenchView);
});

test("home navigation entry points to the notebook list page with the required label", () => {
  const entry = createHomeNotebookListEntry();

  assert.deepEqual(entry, {
    label: "查看 Notebook 列表",
    to: "/notebooks",
  });
});
