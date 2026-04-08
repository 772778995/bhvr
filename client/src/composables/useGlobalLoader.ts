import { ref } from "vue";

export type LoaderEntryType = "info" | "success" | "warning" | "error";

export interface LoaderEntry {
  id: number;
  type: LoaderEntryType;
  message: string;
  timestamp: string; // ISO string
}

const visible = ref(false);
const loaderTitle = ref("");
const entries = ref<LoaderEntry[]>([]);
let entryIdCounter = 0;

function startLoading(title = "加载中...") {
  visible.value = true;
  loaderTitle.value = title;
  entries.value = [];
}

function addEntry(type: LoaderEntryType, message: string) {
  entries.value.push({
    id: ++entryIdCounter,
    type,
    message,
    timestamp: new Date().toISOString(),
  });
}

function stopLoading() {
  visible.value = false;
}

export function useGlobalLoader() {
  return {
    visible,
    loaderTitle,
    entries,
    startLoading,
    addEntry,
    stopLoading,
  };
}
