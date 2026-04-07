<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  notebooksApi,
  type ChatMessage,
  type Notebook,
  type NotebookReport,
  type ResearchState,
  type SendMessageHistoryItem,
  type Source,
} from "@/api/notebooks";
import {
  payloadToState,
  subscribeResearchStream,
  type ResearchRuntimeEvent,
} from "@/api/sse";
import NotebookTopBar from "@/components/notebook-workbench/NotebookTopBar.vue";
import SourcesPanel from "@/components/notebook-workbench/SourcesPanel.vue";
import ChatPanel from "@/components/notebook-workbench/ChatPanel.vue";
import StudioPanel from "@/components/notebook-workbench/StudioPanel.vue";
import AddSourceDialog from "@/components/notebook-workbench/AddSourceDialog.vue";
import ResizeDivider from "@/components/notebook-workbench/ResizeDivider.vue";
import AppToast from "@/components/ui/AppToast.vue";
import { useToast } from "@/composables/useToast";

const route = useRoute();
const { showToast } = useToast();

// ── Resizable panels ────────────────────────────────────────────────────────
const LEFT_MIN = 200;
const RIGHT_MIN = 280;
const LEFT_INIT = 280;
const RIGHT_INIT = 340;

const leftWidth = ref(LEFT_INIT);
const rightWidth = ref(RIGHT_INIT);

function onLeftDrag(delta: number) {
  leftWidth.value = Math.max(LEFT_MIN, leftWidth.value + delta);
}

function onRightDrag(delta: number) {
  // Right divider: dragging right shrinks right panel, dragging left grows it
  rightWidth.value = Math.max(RIGHT_MIN, rightWidth.value - delta);
}

const loading = ref(true);
const error = ref("");
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
const addSourceOpen = ref(false);
const addSourceBusy = ref(false);
const sending = ref(false);
const activeConversationId = ref<string | null>(null);
const conversationHistory = ref<SendMessageHistoryItem[]>([]);

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
  activeConversationId.value = null;
  conversationHistory.value = [];
  researchState.value = {
    status: "idle",
    step: "idle",
    completedCount: 0,
    targetCount: 0,
  };
  report.value = null;
}

function pushNotice(message: string, type: "info" | "error" = "info") {
  showToast(message, type);
}

function onTopAction() {
  pushNotice("该操作暂未开放。");
}

function onAddSource() {
  addSourceOpen.value = true;
}

function onCloseAddSourceDialog() {
  addSourceOpen.value = false;
}

async function refreshSources() {
  if (!notebookId.value) {
    return;
  }
  sources.value = await notebooksApi.getSources(notebookId.value);
}

async function waitForSourcesReady(timeoutMs = 60000): Promise<boolean> {
  if (!notebookId.value) {
    return false;
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await notebooksApi.getSourceProcessingStatus(notebookId.value);
    if (status.allReady) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return false;
}

async function handleSourceAdded(closeDialog = true) {
  const ready = await waitForSourcesReady();
  await refreshSources();
  if (closeDialog) {
    addSourceOpen.value = false;
  }
  if (!ready) {
    pushNotice("来源已提交，仍在处理中。列表已刷新。请稍后重试查看完整状态。");
  }
}

async function onAddSourceUrl(payload: { url: string; title?: string }) {
  if (!notebookId.value) {
    return;
  }

  addSourceBusy.value = true;
  try {
    await notebooksApi.addSourceFromUrl(notebookId.value, payload);
    await handleSourceAdded();
  } catch (e) {
    pushNotice(e instanceof Error ? e.message : "添加网站来源失败", "error");
  } finally {
    addSourceBusy.value = false;
  }
}

async function onAddSourceText(payload: { title: string; content: string }) {
  if (!notebookId.value) {
    return;
  }

  addSourceBusy.value = true;
  try {
    await notebooksApi.addSourceFromText(notebookId.value, payload);
    await handleSourceAdded();
  } catch (e) {
    pushNotice(e instanceof Error ? e.message : "添加文本来源失败", "error");
  } finally {
    addSourceBusy.value = false;
  }
}

async function onAddSourceFile(file: File) {
  if (!notebookId.value) {
    return;
  }

  addSourceBusy.value = true;
  try {
    await notebooksApi.addSourceFromFile(notebookId.value, file);
    await handleSourceAdded();
  } catch (e) {
    pushNotice(e instanceof Error ? e.message : "上传文件来源失败", "error");
  } finally {
    addSourceBusy.value = false;
  }
}

async function onSearchAndAddSources(payload: {
  query: string;
  sourceType: "web" | "drive";
  mode: "fast" | "deep";
}) {
  if (!notebookId.value) {
    return;
  }

  addSourceBusy.value = true;

  try {
    const searchResult = await notebooksApi.searchSources(notebookId.value, payload);

    const webSources = searchResult.web.map((item) => ({ title: item.title, url: item.url }));
    const driveSources = searchResult.drive.map((item) => ({
      fileId: item.fileId,
      title: item.title,
      mimeType: item.mimeType,
    }));

    if (webSources.length === 0 && driveSources.length === 0) {
      pushNotice("未找到可添加来源，请调整搜索词后重试。");
      return;
    }

    await notebooksApi.addDiscoveredSources(notebookId.value, {
      sessionId: searchResult.sessionId,
      ...(webSources.length ? { webSources } : {}),
      ...(driveSources.length ? { driveSources } : {}),
    });

    await handleSourceAdded();
  } catch (e) {
    pushNotice(e instanceof Error ? e.message : "搜索并添加来源失败", "error");
  } finally {
    addSourceBusy.value = false;
  }
}

async function onSendMessage(content: string) {
  const trimmedContent = content.trim();
  if (!notebookId.value || !trimmedContent || sending.value) {
    return;
  }

  const optimisticMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: trimmedContent,
    createdAt: new Date().toISOString(),
    status: "done",
  };

  sending.value = true;
  messages.value = [...messages.value, optimisticMessage];

  try {
    const result = await notebooksApi.sendMessage(notebookId.value, {
      content: trimmedContent,
      ...(activeConversationId.value ? { conversationId: activeConversationId.value } : {}),
      ...(conversationHistory.value.length > 0
        ? { conversationHistory: conversationHistory.value }
        : {}),
    });

    messages.value = [...messages.value, result.message];
    activeConversationId.value = result.conversationId;
    conversationHistory.value = messages.value.map((message) => ({
      role: message.role,
      message: message.content,
    }));
  } catch (err) {
    messages.value = messages.value.filter((message) => message.id !== optimisticMessage.id);
    pushNotice(err instanceof Error ? err.message : "发送消息失败", "error");
  } finally {
    sending.value = false;
  }
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

  try {
    await notebooksApi.startResearch(notebookId.value);
    researchState.value = {
      ...researchState.value,
      status: "running",
      step: "starting",
    };
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "启动研究失败", "error");
  }
}

async function onGenerateReport() {
  if (!notebookId.value) {
    return;
  }

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
    pushNotice(err instanceof Error ? err.message : "生成报告失败", "error");
  }
}

async function loadWorkbenchData() {
  const requestId = ++activeRequestId.value;
  const isStale = () => requestId !== activeRequestId.value;

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
  <div class="h-full overflow-hidden bg-[#e9dfcf] text-[#2f271f]">
    <AppToast />
    <div class="h-full bg-[linear-gradient(180deg,_rgba(248,242,231,0.98),_rgba(237,228,212,0.98))]">
      <div v-if="loading" class="h-full flex items-center justify-center text-base text-[#6f6354]">
        正在加载工作台...
      </div>

      <div v-else-if="error" class="h-full flex items-center justify-center p-6">
        <div class="w-full max-w-lg border border-[#c98e7e] bg-[#f4ddd6] p-4 text-base leading-relaxed text-[#7b3328]">
          {{ error }}
        </div>
      </div>

      <div v-else-if="!hasData" class="h-full flex items-center justify-center p-6">
        <div class="w-full max-w-lg border border-[#d8cfbe] bg-[#f8f3ea] p-6 text-center text-base leading-relaxed text-[#716452]">
          当前 Notebook 暂无可展示数据。
        </div>
      </div>

      <div v-else class="h-full flex flex-col overflow-hidden">
        <NotebookTopBar
          :title="notebook?.title ?? 'Notebook 工作台'"
          :on-share="onTopAction"
          :on-more="onTopAction"
        />

        <div class="min-h-0 flex-1 overflow-hidden p-3 sm:p-4 lg:p-5">
          <div class="flex h-full min-h-0 gap-0">
            <!-- Left: Sources -->
            <div
              class="shrink-0 min-w-0"
              :style="{ width: leftWidth + 'px' }"
            >
              <SourcesPanel
                :sources="sources"
                :on-add-source="onAddSource"
              />
            </div>

            <ResizeDivider @drag="onLeftDrag" />

            <!-- Center: Chat (flex-1) -->
            <div class="flex-1 min-w-0">
              <ChatPanel :messages="messages" :sending="sending" :on-send="onSendMessage" />
            </div>

            <ResizeDivider @drag="onRightDrag" />

            <!-- Right: Studio -->
            <div
              class="shrink-0 min-w-0"
              :style="{ width: rightWidth + 'px' }"
            >
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

        <AddSourceDialog
          :open="addSourceOpen"
          :busy="addSourceBusy"
          :on-close="onCloseAddSourceDialog"
          :on-add-url="onAddSourceUrl"
          :on-add-text="onAddSourceText"
          :on-search="onSearchAndAddSources"
          :on-pick-file="onAddSourceFile"
        />
      </div>
    </div>
  </div>
</template>
