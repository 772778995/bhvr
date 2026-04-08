import { createRouter, createWebHistory } from "vue-router";
import NotebookListView from "@/views/NotebookListView.vue";
import NotebookWorkbenchView from "@/views/NotebookWorkbenchView.vue";
import { createAppRoutes } from "./navigation";

const router = createRouter({
  history: createWebHistory(),
  routes: createAppRoutes({
    notebookListView: NotebookListView,
    notebookWorkbenchView: NotebookWorkbenchView,
  }),
});

export default router;
