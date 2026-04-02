import { createRouter, createWebHistory } from "vue-router";
import HomeView from "@/views/HomeView.vue";
import NotebookWorkbenchView from "@/views/NotebookWorkbenchView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: HomeView,
    },
    {
      path: "/task/:id",
      name: "task-detail",
      component: () => import("@/views/TaskDetailView.vue"),
    },
    {
      path: "/notebook/:id",
      name: "notebook-workbench",
      component: NotebookWorkbenchView,
    },
  ],
});

export default router;
