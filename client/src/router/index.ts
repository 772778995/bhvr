import { createRouter, createWebHistory } from "vue-router";
import BookWorkbenchView from "@/views/BookWorkbenchView.vue";
import NotebookListView from "@/views/NotebookListView.vue";
import NotebookWorkbenchView from "@/views/NotebookWorkbenchView.vue";
import { createAppRoutes } from "./navigation";

const router = createRouter({
  history: createWebHistory(),
  routes: createAppRoutes({
    notebookListView: NotebookListView,
    bookWorkbenchView: BookWorkbenchView,
    notebookWorkbenchView: NotebookWorkbenchView,
  }),
});

export default router;
