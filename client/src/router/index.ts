import { createRouter, createWebHistory } from "vue-router";
import HomeView from "@/views/HomeView.vue";
import NotebookListView from "@/views/NotebookListView.vue";
import NotebookWorkbenchView from "@/views/NotebookWorkbenchView.vue";
import { createAppRoutes } from "./navigation";

const router = createRouter({
  history: createWebHistory(),
  routes: createAppRoutes({
    homeView: HomeView,
    notebookListView: NotebookListView,
    notebookWorkbenchView: NotebookWorkbenchView,
  }),
});

export default router;
