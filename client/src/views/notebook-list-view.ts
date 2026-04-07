import { ref } from "vue";
import { notebooksApi, type Notebook } from "../api/notebooks.js";

interface NotebookListStateOptions {
  fetchNotebooks?: () => Promise<Notebook[]>;
  navigate?: (path: string) => void;
}

interface NotebookListViewModelOptions extends NotebookListStateOptions {
  onMounted: (callback: () => void | Promise<void>) => void;
}

export function createNotebookWorkbenchPath(id: string): string {
  return `/notebook/${id}`;
}

export function createNotebookListState(options: NotebookListStateOptions = {}) {
  const notebooks = ref<Notebook[]>([]);
  const loading = ref(true);
  const error = ref("");

  const fetchNotebooks = options.fetchNotebooks ?? (() => notebooksApi.getNotebooks());
  const navigate = options.navigate ?? (() => {});

  async function load() {
    loading.value = true;

    try {
      notebooks.value = await fetchNotebooks();
      error.value = "";
    } catch (cause) {
      notebooks.value = [];
      error.value = cause instanceof Error ? cause.message : "Notebook 列表加载失败";
    } finally {
      loading.value = false;
    }
  }

  function openNotebook(id: string) {
    navigate(createNotebookWorkbenchPath(id));
  }

  return {
    notebooks,
    loading,
    error,
    load,
    openNotebook,
  };
}

export function createNotebookListViewModel(options: NotebookListViewModelOptions) {
  const state = createNotebookListState(options);

  options.onMounted(() => state.load());

  return state;
}
