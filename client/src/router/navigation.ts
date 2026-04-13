import type { RouteComponent, RouteRecordRaw } from "vue-router";

const workbenchRouteNames = new Set(["book-workbench", "notebook-workbench"]);

interface AppRouteComponents {
  notebookListView: RouteComponent;
  bookWorkbenchView: RouteComponent;
  notebookWorkbenchView: RouteComponent;
}

export function isWorkbenchRouteName(name: unknown): boolean {
  return typeof name === "string" && workbenchRouteNames.has(name);
}

export function createAppRoutes({
  notebookListView,
  bookWorkbenchView,
  notebookWorkbenchView,
}: AppRouteComponents): RouteRecordRaw[] {
  return [
    {
      path: "/",
      name: "home",
      component: notebookListView,
    },
    {
      path: "/task/:id",
      name: "task-detail",
      component: () => import("@/views/TaskDetailView.vue"),
    },
    {
      path: "/book/:id",
      name: "book-workbench",
      component: bookWorkbenchView,
    },
    {
      path: "/notebook/:id",
      name: "notebook-workbench",
      component: notebookWorkbenchView,
    },
    {
      path: "/settings/accounts",
      name: "accounts-settings",
      component: () => import("@/views/AccountsView.vue"),
    },
  ];
}
