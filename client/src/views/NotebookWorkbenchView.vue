<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  notebooksApi,
  type ChatMessage,
  type Notebook,
  type ResearchEntry,
  type Source,
  type StudioTool,
} from "@/api/notebooks";
import { getNotImplementedMessage } from "@/utils/not-implemented";
import NotebookTopBar from "@/components/notebook-workbench/NotebookTopBar.vue";
import SourcesPanel from "@/components/notebook-workbench/SourcesPanel.vue";
import ChatPanel from "@/components/notebook-workbench/ChatPanel.vue";
import StudioPanel from "@/components/notebook-workbench/StudioPanel.vue";

const route = useRoute();

const loading = ref(true);
const error = ref("");
const notice = ref("");
const activeRequestId = ref(0);

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

function resetPanelData() {
  sources.value = [];
  messages.value = [];
  studioTools.value = [];
  researchEntry.value = null;
}

function pushNotice(message: string) {
  notice.value = message;
}

function onTopAction() {
  pushNotice(getNotImplementedMessage());
}

function onAddSource() {
  pushNotice(getNotImplementedMessage("添加来源"));
}

function onSendMessage() {
  pushNotice(getNotImplementedMessage("发送消息"));
}

function onOpenTool(tool: StudioTool) {
  const label = tool.name || tool.id;
  pushNotice(getNotImplementedMessage(label));
}

function onOpenResearch() {
  pushNotice(getNotImplementedMessage("自动课题研究"));
}

async function loadWorkbenchData() {
  const requestId = ++activeRequestId.value;
  const isStale = () => requestId !== activeRequestId.value;

  notice.value = "";

  if (!notebookId.value) {
    notebook.value = null;
    resetPanelData();
    loading.value = false;
    error.value = "Notebook ID 缺失，请检查路由参数。";
    return;
  }

  loading.value = true;
  error.value = "";

  const [
    notebookResult,
    sourcesResult,
    messagesResult,
    toolsResult,
    researchResult,
  ] = await Promise.allSettled([
    notebooksApi.getNotebook(notebookId.value),
    notebooksApi.getSources(notebookId.value),
    notebooksApi.getMessages(notebookId.value),
    notebooksApi.getStudioTools(notebookId.value),
    notebooksApi.getResearchEntry(notebookId.value),
  ]);

  if (isStale()) {
    return;
  }

  if (notebookResult.status === "rejected") {
    notebook.value = null;
    resetPanelData();
    error.value = notebookResult.reason instanceof Error
      ? notebookResult.reason.message
      : "Notebook 信息加载失败，请稍后重试。";
    loading.value = false;
    return;
  }

  notebook.value = notebookResult.value;
  sources.value = sourcesResult.status === "fulfilled" ? sourcesResult.value : [];
  messages.value = messagesResult.status === "fulfilled" ? messagesResult.value : [];
  studioTools.value = toolsResult.status === "fulfilled" ? toolsResult.value : [];
  researchEntry.value = researchResult.status === "fulfilled" ? researchResult.value : null;

  const partialFailure =
    sourcesResult.status === "rejected"
    || messagesResult.status === "rejected"
    || toolsResult.status === "rejected"
    || researchResult.status === "rejected";

  if (partialFailure) {
    pushNotice("部分区域加载失败，已展示可用内容。");
  }

  loading.value = false;
}

watch(
  notebookId,
  () => {
    void loadWorkbenchData();
  },
  { immediate: true },
);
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <div
      v-if="loading"
      class="min-h-screen flex items-center justify-center text-sm text-gray-600"
    >
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

      <div v-if="notice" class="px-3 sm:px-4 pt-3">
        <div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {{ notice }}
        </div>
      </div>

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
