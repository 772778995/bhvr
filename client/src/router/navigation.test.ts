import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppRoutes,
  isWorkbenchRouteName,
} from "./navigation";

test("app routes register notebook list as home route and notebook workbench separately", () => {
  const notebookListView = { name: "NotebookListView" };
  const bookWorkbenchView = { name: "BookWorkbenchView" };
  const notebookWorkbenchView = { name: "NotebookWorkbenchView" };
  const routes = createAppRoutes({
    notebookListView,
    bookWorkbenchView,
    notebookWorkbenchView,
  });

  const homeRoute = routes.find((route) => route.name === "home");
  const bookWorkbenchRoute = routes.find(
    (route) => route.name === "book-workbench",
  );
  const notebookWorkbenchRoute = routes.find(
    (route) => route.name === "notebook-workbench",
  );

  assert.ok(homeRoute);
  assert.equal(homeRoute.path, "/");
  assert.equal(homeRoute.component, notebookListView);

  assert.ok(bookWorkbenchRoute);
  assert.equal(bookWorkbenchRoute.path, "/book/:id");
  assert.equal(bookWorkbenchRoute.component, bookWorkbenchView);

  assert.ok(notebookWorkbenchRoute);
  assert.equal(notebookWorkbenchRoute.path, "/notebook/:id");
  assert.equal(notebookWorkbenchRoute.component, notebookWorkbenchView);
});

test("workbench route names include book and notebook workbenches", () => {
  assert.equal(isWorkbenchRouteName("book-workbench"), true);
  assert.equal(isWorkbenchRouteName("notebook-workbench"), true);
  assert.equal(isWorkbenchRouteName("home"), false);
});
