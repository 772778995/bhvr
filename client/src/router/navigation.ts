import type { RouteComponent, RouteRecordRaw } from "vue-router";

export const notebookListNavigationTarget = "/notebooks";
export const notebookListNavigationLabel = "查看 Notebook 列表";

export function createHomeNotebookListEntry() {
  return {
    label: notebookListNavigationLabel,
    to: notebookListNavigationTarget,
  };
}

interface AppRouteComponents {
  homeView: RouteComponent;
  notebookListView: RouteComponent;
  notebookWorkbenchView: RouteComponent;
}

export function createAppRoutes({
  homeView,
  notebookListView,
  notebookWorkbenchView,
}: AppRouteComponents): RouteRecordRaw[] {
  return [
    {
      path: "/",
      name: "home",
      component: homeView,
    },
    {
      path: "/task/:id",
      name: "task-detail",
      component: () => import("@/views/TaskDetailView.vue"),
    },
    {
      path: notebookListNavigationTarget,
      name: "notebook-list",
      component: notebookListView,
    },
    {
      path: "/notebook/:id",
      name: "notebook-workbench",
      component: notebookWorkbenchView,
    },
  ];
}
