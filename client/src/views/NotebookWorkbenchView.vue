<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  notebooksApi,
  type ChatMessage,
  type Notebook,
  type NotebookReport,
  type ResearchState,
  type Source,
} from "@/api/notebooks";
import { subscribeResearchStream, payloadToState, type ResearchRuntimeEvent } from "@/api/sse";
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

// Research runtime state — populated via SSE events; initialised to idle
const researchState = ref<ResearchState>({
  status: "idle",
  step: "idle",
  completedCount: 0,
  targetCount: 0,
});

// Stored report
const report = ref<NotebookReport | null>(null);

// SSE cleanup handle
let sseCleanup: (() => void) | null = null;

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
  );
});

/** Whether there are Q&A assets that can be used to generate a report. */
const hasResearchAssets = computed(() => {
  return messages.value.length > 0 || researchState.value.completedCount > 0;
});

function resetPanelData() {
  sources.value = [];
  messages.value = [];
  researchState.value = { status: "idle", step: "idle", completedCount: 0, targetCount: 0 };
  report.value = null;
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

/** Handle incoming SSE event, update researchState / report reactively. */
function handleResearchEvent(ev: ResearchRuntimeEvent) {
  if (ev.type === "heartbeat") {
    return; // keep-alive; nothing to update
  }

  if (ev.payload) {
    researchState.value = payloadToState(ev.payload);
  }

  // When the run completes, also refresh the report
  if (ev.type === "completed") {
    void notebooksApi.getReport(notebookId.value)
      .then((r) => { report.value = r; })
      .catch(() => { /* silently ignore if report endpoint not available yet */ });
  }
}

/**
 * Establish SSE subscription for the given notebook id.
 * Tears down any existing connection first.
 * Called unconditionally whenever we have a valid id — independent of
 * whether the HTTP data load succeeded.
 */
function connectSSE(id: string) {
  if (sseCleanup) {
    sseCleanup();
    sseCleanup = null;
  }

  if (!id) return;

  sseCleanup = subscribeResearchStream(id, {
    onEvent: handleResearchEvent,
    onError: () => {
      // Connection dropped — keep last known state; EventSource auto-reconnects
    },
  });
}

async function onStartResearch() {
  if (!notebookId.value) return;
  notice.value = "";
  try {
    await notebooksApi.startResearch(notebookId.value);
    // Optimistically reflect that the run has been kicked off; SSE will
    // deliver authoritative state updates from the server shortly.
    researchState.value = { ...researchState.value, status: "running", step: "starting" };
  } catch (e) {
    pushNotice(e instanceof Error ? e.message : "启动研究失败");
  }
}

async function onGenerateReport() {
  if (!notebookId.value) return;
  notice.value = "";
  try {
    await notebooksApi.generateReport(notebookId.value);
    pushNotice("报告生成请求已提交，请稍候…");
    // Poll once after a short delay in case the server finishes quickly
    setTimeout(() => {
      void notebooksApi.getReport(notebookId.value)
        .then((r) => { report.value = r; })
        .catch(() => { /* ignore */ });
    }, 3000);
  } catch (e) {
    pushNotice(e instanceof Error ? e.message : "生成报告失败");
  }
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

  // Always establish SSE as soon as we know the id is valid, independent of
  // whether the HTTP fetches below succeed or fail.
  connectSSE(notebookId.value);

  const [
    notebookResult,
    sourcesResult,
    messagesResult,
    reportResult,
  ] = await Promise.allSettled([
    notebooksApi.getNotebook(notebookId.value),
    notebooksApi.getSources(notebookId.value),
    notebooksApi.getMessages(notebookId.value),
    notebooksApi.getReport(notebookId.value),
  ]);

  if (isStale()) {
    return;
  }

  if (notebookResult.status === "rejected") {
    // Close any SSE connection opened above — the notebook doesn't exist or
    // is inaccessible, so keeping the stream alive would be an orphan.
    if (sseCleanup) {
      sseCleanup();
      sseCleanup = null;
    }
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
  report.value = reportResult.status === "fulfilled" ? reportResult.value : null;

  const partialFailure =
    sourcesResult.status === "rejected"
    || messagesResult.status === "rejected";

  if (partialFailure) {
    pushNotice("部分区域加载失败，已展示可用内容。");
  }

  loading.value = false;
}

watch(
  notebookId,
  (newId, oldId) => {
    if (newId !== oldId) {
      // Disconnect SSE for the previous notebook immediately on id change
      if (sseCleanup) {
        sseCleanup();
        sseCleanup = null;
      }
    }
    void loadWorkbenchData();
  },
  { immediate: true },
);

onUnmounted(() => {
  if (sseCleanup) {
    sseCleanup();
    sseCleanup = null;
  }
});
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
            :research-state="researchState"
            :report="report"
            :has-research-assets="hasResearchAssets"
            :on-start-research="onStartResearch"
            :on-generate-report="onGenerateReport"
          />
        </div>
      </div>
    </div>
  </div>
</template>
