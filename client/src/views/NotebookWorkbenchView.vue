<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  notebooksApi,
  type ChatMessage,
  type Notebook,
  type ResearchEntry,
  type Source,
  type StudioTool,
} from "@/api/notebooks";
import { showNotImplemented } from "@/utils/not-implemented";
import NotebookTopBar from "@/components/notebook-workbench/NotebookTopBar.vue";
import SourcesPanel from "@/components/notebook-workbench/SourcesPanel.vue";
import ChatPanel from "@/components/notebook-workbench/ChatPanel.vue";
import StudioPanel from "@/components/notebook-workbench/StudioPanel.vue";

const route = useRoute();

const loading = ref(true);
const error = ref("");
const notebook = ref<Notebook | null>(null);
const sources = ref<Source[]>([]);
const messages = ref<ChatMessage[]>([]);
const studioTools = ref<StudioTool[]>([]);
const researchEntry = ref<ResearchEntry | null>(null);

const notebookId = computed(() => {
  const idParam = route.params.id;
  if (typeof idParam !== "string") {
    return "";
  }
  return idParam.trim();
});

const hasData = computed(() => {
  return (
    notebook.value !== null
    || sources.value.length > 0
    || messages.value.length > 0
    || studioTools.value.length > 0
    || researchEntry.value !== null
  );
});

function onTopAction() {
  showNotImplemented();
}

function onAddSource() {
  showNotImplemented();
}

function onSendMessage() {
  showNotImplemented();
}

function onOpenTool() {
  showNotImplemented();
}

function onOpenResearch() {
  showNotImplemented();
}

async function loadWorkbenchData() {
  if (!notebookId.value) {
    loading.value = false;
    error.value = "Notebook ID 缺失，请检查路由参数。";
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    const [notebookData, sourcesData, messagesData, toolsData, researchData] = await Promise.all([
      notebooksApi.getNotebook(notebookId.value),
      notebooksApi.getSources(notebookId.value),
      notebooksApi.getMessages(notebookId.value),
      notebooksApi.getStudioTools(notebookId.value),
      notebooksApi.getResearchEntry(notebookId.value),
    ]);

    notebook.value = notebookData;
    sources.value = sourcesData;
    messages.value = messagesData;
    studioTools.value = toolsData;
    researchEntry.value = researchData;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败，请稍后重试。";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadWorkbenchData();
});
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <div v-if="loading" class="min-h-screen flex items-center justify-center text-sm text-gray-600">
      正在加载工作台...
    </div>

    <div
      v-else-if="error"
      class="min-h-screen flex items-center justify-center p-6"
    >
      <div class="w-full max-w-lg rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
        {{ error }}
      </div>
    </div>

    <div
      v-else-if="!hasData"
      class="min-h-screen flex items-center justify-center p-6"
    >
      <div class="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 text-center">
        当前 Notebook 暂无可展示数据。
      </div>
    </div>

    <div v-else class="min-h-screen flex flex-col">
      <NotebookTopBar
        :title="notebook?.title ?? 'Notebook Workbench'"
        :on-share="onTopAction"
        :on-more="onTopAction"
      />

      <div class="flex-1 p-3 sm:p-4">
        <div class="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_300px] gap-3 sm:gap-4 h-full min-h-[calc(100vh-88px)]">
          <SourcesPanel :sources="sources" :on-add-source="onAddSource" />
          <ChatPanel :messages="messages" :on-send="onSendMessage" />
          <StudioPanel
            :tools="studioTools"
            :research-entry="researchEntry"
            :on-open-tool="onOpenTool"
            :on-open-research="onOpenResearch"
          />
        </div>
      </div>
    </div>
  </div>
</template>
