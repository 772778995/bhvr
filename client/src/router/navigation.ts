import type { RouteComponent, RouteRecordRaw } from "vue-router";

interface AppRouteComponents {
  notebookListView: RouteComponent;
  notebookWorkbenchView: RouteComponent;
}

export function createAppRoutes({
  notebookListView,
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
