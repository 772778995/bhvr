import { ref } from "vue";
import { notebooksApi, type Notebook } from "../api/notebooks.js";

interface NotebookListStateOptions {
  fetchNotebooks?: () => Promise<Notebook[]>;
  deleteNotebook?: (id: string) => Promise<unknown>;
  navigate?: (path: string) => void;
}

interface NotebookListViewModelOptions extends NotebookListStateOptions {
  onMounted: (callback: () => void | Promise<void>) => void;
}

export function createNotebookWorkbenchPath(id: string): string {
  return `/book/${id}`;
}

export function createNotebookListState(options: NotebookListStateOptions = {}) {
  const notebooks = ref<Notebook[]>([]);
  const loading = ref(true);
  const error = ref("");
  const actionError = ref("");
  const pendingDeleteNotebook = ref<Notebook | null>(null);
  const deletingNotebookId = ref<string | null>(null);

  const fetchNotebooks = options.fetchNotebooks ?? (() => notebooksApi.getNotebooks());
  const deleteNotebook = options.deleteNotebook ?? ((id: string) => notebooksApi.deleteNotebook(id));
  const navigate = options.navigate ?? (() => {});

  async function load() {
    loading.value = true;

    try {
      notebooks.value = await fetchNotebooks();
      error.value = "";
      actionError.value = "";
    } catch (cause) {
      notebooks.value = [];
      error.value = cause instanceof Error ? cause.message : "笔记本列表加载失败";
    } finally {
      loading.value = false;
    }
  }

  function openNotebook(id: string) {
    navigate(createNotebookWorkbenchPath(id));
  }

  function requestDeleteNotebook(notebook: Notebook) {
    if (deletingNotebookId.value) {
      return;
    }

    actionError.value = "";
    pendingDeleteNotebook.value = notebook;
  }

  function cancelDeleteNotebook() {
    if (deletingNotebookId.value) {
      return;
    }

    pendingDeleteNotebook.value = null;
  }

  async function confirmDeleteNotebook() {
    const notebook = pendingDeleteNotebook.value;
    if (!notebook || deletingNotebookId.value) {
      return;
    }

    pendingDeleteNotebook.value = null;
    deletingNotebookId.value = notebook.id;
    actionError.value = "";

    try {
      await deleteNotebook(notebook.id);
      notebooks.value = notebooks.value.filter((current) => current.id !== notebook.id);
    } catch (cause) {
      actionError.value = cause instanceof Error ? cause.message : "删除失败，请重试";
    } finally {
      deletingNotebookId.value = null;
    }
  }

  return {
    notebooks,
    loading,
    error,
    actionError,
    pendingDeleteNotebook,
    deletingNotebookId,
    load,
    openNotebook,
    requestDeleteNotebook,
    cancelDeleteNotebook,
    confirmDeleteNotebook,
  };
}

export function createNotebookListViewModel(options: NotebookListViewModelOptions) {
  const state = createNotebookListState(options);

  options.onMounted(() => state.load());

  return state;
}
