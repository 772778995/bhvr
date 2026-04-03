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
import {
  payloadToState,
  subscribeResearchStream,
  type ResearchRuntimeEvent,
} from "@/api/sse";
import { showNotImplemented } from "@/utils/not-implemented";
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

const researchState = ref<ResearchState>({
  status: "idle",
  step: "idle",
  completedCount: 0,
  targetCount: 0,
});

const report = ref<NotebookReport | null>(null);

let sseCleanup: (() => void) | null = null;

const notebookId = computed(() => {
  const idParam = route.params.id;
  if (typeof idParam !== "string") {
    return "";
  }
  return idParam.trim();
});

const hasData = computed(() => {
  return notebook.value !== null || sources.value.length > 0 || messages.value.length > 0;
});

const hasResearchAssets = computed(() => {
  return messages.value.length > 0 || researchState.value.completedCount > 0;
});

function resetPanelData() {
  sources.value = [];
  messages.value = [];
  researchState.value = {
    status: "idle",
    step: "idle",
    completedCount: 0,
    targetCount: 0,
  };
  report.value = null;
}

function pushNotice(message: string) {
  notice.value = message;
}

function onTopAction() {
  showNotImplemented();
}

function onAddSource() {
  showNotImplemented("添加来源");
}

function onSendMessage() {
  showNotImplemented("发送消息");
}

function handleResearchEvent(event: ResearchRuntimeEvent) {
  if (event.type === "heartbeat") {
    return;
  }

  if (event.payload) {
    researchState.value = payloadToState(event.payload);
  }

  if (event.type === "completed") {
    void notebooksApi
      .getReport(notebookId.value)
      .then((value) => {
        report.value = value;
      })
      .catch(() => {
        // Ignore report refresh failures here; the page remains usable.
      });
  }
}

function connectSSE(id: string) {
  if (sseCleanup) {
    sseCleanup();
    sseCleanup = null;
  }

  if (!id) {
    return;
  }

  sseCleanup = subscribeResearchStream(id, {
    onEvent: handleResearchEvent,
    onError: () => {
      // EventSource will auto-reconnect. Keep the last known state in the UI.
    },
  });
}

async function onStartResearch() {
  if (!notebookId.value) {
    return;
  }

  notice.value = "";

  try {
    await notebooksApi.startResearch(notebookId.value);
    researchState.value = {
      ...researchState.value,
      status: "running",
      step: "starting",
    };
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "启动研究失败");
  }
}

async function onGenerateReport() {
  if (!notebookId.value) {
    return;
  }

  notice.value = "";

  try {
    await notebooksApi.generateReport(notebookId.value);
    pushNotice("报告生成请求已提交，请稍候...");

    setTimeout(() => {
      void notebooksApi
        .getReport(notebookId.value)
        .then((value) => {
          report.value = value;
        })
        .catch(() => {
          // Ignore delayed refresh failure; user can retry manually.
        });
    }, 3000);
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "生成报告失败");
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

  connectSSE(notebookId.value);

  const [notebookResult, sourcesResult, messagesResult, reportResult] = await Promise.allSettled([
    notebooksApi.getNotebook(notebookId.value),
    notebooksApi.getSources(notebookId.value),
    notebooksApi.getMessages(notebookId.value),
    notebooksApi.getReport(notebookId.value),
  ]);

  if (isStale()) {
    return;
  }

  if (notebookResult.status === "rejected") {
    if (sseCleanup) {
      sseCleanup();
      sseCleanup = null;
    }

    notebook.value = null;
    resetPanelData();
    error.value =
      notebookResult.reason instanceof Error
        ? notebookResult.reason.message
        : "Notebook 信息加载失败，请稍后重试。";
    loading.value = false;
    return;
  }

  notebook.value = notebookResult.value;
  sources.value = sourcesResult.status === "fulfilled" ? sourcesResult.value : [];
  messages.value = messagesResult.status === "fulfilled" ? messagesResult.value : [];
  report.value = reportResult.status === "fulfilled" ? reportResult.value : null;

  const partialFailure = sourcesResult.status === "rejected" || messagesResult.status === "rejected";

  if (partialFailure) {
    pushNotice("部分区域加载失败，已展示可用内容。");
  }

  loading.value = false;
}

watch(
  notebookId,
  (newId, oldId) => {
    if (newId !== oldId && sseCleanup) {
      sseCleanup();
      sseCleanup = null;
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
  <div class="h-full bg-gray-100 overflow-hidden">
    <div v-if="loading" class="h-full flex items-center justify-center text-sm text-gray-600">
      正在加载工作台...
    </div>

    <div v-else-if="error" class="h-full flex items-center justify-center p-6">
      <div class="w-full max-w-lg rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
        {{ error }}
      </div>
    </div>

    <div v-else-if="!hasData" class="h-full flex items-center justify-center p-6">
      <div class="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 text-center">
        当前 Notebook 暂无可展示数据。
      </div>
    </div>

    <div v-else class="h-full flex flex-col overflow-hidden">
      <NotebookTopBar
        :title="notebook?.title ?? 'Notebook 工作台'"
        :on-share="onTopAction"
        :on-more="onTopAction"
      />

      <div v-if="notice" class="px-3 sm:px-4 pt-3">
        <div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {{ notice }}
        </div>
      </div>

      <div class="flex-1 p-3 sm:p-4 min-h-0 overflow-hidden">
        <div class="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_300px] gap-3 sm:gap-4 h-full min-h-0">
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
