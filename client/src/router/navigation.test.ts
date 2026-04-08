import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppRoutes,
} from "./navigation";

test("app routes register notebook list as home route and notebook workbench separately", () => {
  const notebookListView = { name: "NotebookListView" };
  const notebookWorkbenchView = { name: "NotebookWorkbenchView" };
  const routes = createAppRoutes({
    notebookListView,
    notebookWorkbenchView,
  });

  const homeRoute = routes.find((route) => route.name === "home");
  const notebookWorkbenchRoute = routes.find(
    (route) => route.name === "notebook-workbench",
  );

  assert.ok(homeRoute);
  assert.equal(homeRoute.path, "/");
  assert.equal(homeRoute.component, notebookListView);

  assert.ok(notebookWorkbenchRoute);
  assert.equal(notebookWorkbenchRoute.path, "/notebook/:id");
  assert.equal(notebookWorkbenchRoute.component, notebookWorkbenchView);
});
