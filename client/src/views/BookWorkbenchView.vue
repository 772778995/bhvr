<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { ChatMessage, ReportEntry, ResearchState, Source } from "@/api/notebooks";
import { notebooksApi } from "@/api/notebooks";
import { uploadBookSourcePdf } from "@/api/book-source";
import { generateBookSummary } from "@/api/book-summary";
import { payloadToState, subscribeResearchStream, type ResearchRuntimeEvent } from "@/api/sse";
import NotebookWorkbenchShell from "@/components/notebook-workbench/NotebookWorkbenchShell.vue";
import BookSourcePanel from "@/components/book-workbench/BookSourcePanel.vue";
import BookActionsPanel from "@/components/book-workbench/BookActionsPanel.vue";
import ResearchHistoryPanel from "@/components/book-workbench/ResearchHistoryPanel.vue";
import BookSummaryPanel from "@/components/book-workbench/BookSummaryPanel.vue";
import { getBookCenterTabs, getBookSummaryEntry } from "@/components/book-workbench/book-center";
import { canGenerateBookSummary, hasBookResearchHistory } from "@/components/book-workbench/book-view-state";
import UploadBookDialog from "@/components/book-workbench/UploadBookDialog.vue";
import ConfirmDialog from "@/components/ui/ConfirmDialog.vue";
import AppToast from "@/components/ui/AppToast.vue";
import FullscreenLoader from "@/components/ui/FullscreenLoader.vue";
import { useToast } from "@/composables/useToast";
import { useGlobalLoader } from "@/composables/useGlobalLoader";
import { getCurrentBookSource } from "@/utils/book-source";

const route = useRoute();
const { showToast } = useToast();
const { visible: loaderVisible, loaderTitle, entries: loaderEntries, startLoading, addEntry, stopLoading } = useGlobalLoader();

const loading = ref(true);
const error = ref("");
const sources = ref<Source[]>([]);
const uploadDialogOpen = ref(false);
const deletingSourceId = ref<string | null>(null);
const progressMessage = ref("");
const activeCenterTab = ref<"history" | "summary">("history");
const reportEntries = ref<ReportEntry[]>([]);
const generatingBookSummary = ref(false);
const messages = ref<ChatMessage[]>([]);
const researchState = ref<ResearchState>({
  status: "idle",
  step: "idle",
  completedCount: 0,
  targetCount: 0,
});

let sseCleanup: (() => void) | null = null;

const notebookId = computed(() => {
  const value = route.params.id;
  return typeof value === "string" ? value.trim() : "";
});

const currentBook = computed(() => getCurrentBookSource(sources.value));
const currentBookSummary = computed(() => getBookSummaryEntry(reportEntries.value));
const centerTabs = computed(() => getBookCenterTabs(Boolean(currentBookSummary.value)));
const hasData = computed(() => true);
const hasBook = computed(() => currentBook.value !== null);
const hasResearchHistory = computed(() => hasBookResearchHistory({
  messages: messages.value,
  researchState: researchState.value,
}));
const canGenerateSummary = computed(() => canGenerateBookSummary({
  generating: generatingBookSummary.value,
  messages: messages.value,
  researchState: researchState.value,
}));
const busy = computed(() => loaderVisible.value);

function resetWorkbenchState() {
  sources.value = [];
  reportEntries.value = [];
  messages.value = [];
  progressMessage.value = "";
  deletingSourceId.value = null;
  generatingBookSummary.value = false;
  activeCenterTab.value = "history";
  researchState.value = {
    status: "idle",
    step: "idle",
    completedCount: 0,
    targetCount: 0,
  };
}

async function refreshSources() {
  if (!notebookId.value) {
    sources.value = [];
    return;
  }
  sources.value = await notebooksApi.getSources(notebookId.value);
}

async function refreshReportEntries() {
  if (!notebookId.value) {
    reportEntries.value = [];
    return;
  }
  reportEntries.value = await notebooksApi.listEntries(notebookId.value);
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();

  for (const message of current) {
    byId.set(message.id, message);
  }

  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

async function refreshMessages() {
  if (!notebookId.value) {
    messages.value = [];
    return;
  }

  try {
    messages.value = mergeMessages(messages.value, await notebooksApi.getMessages(notebookId.value));
  } catch (err) {
    showToast(err instanceof Error ? err.message : "刷新研究历史失败", "error");
  }
}

async function loadWorkbench() {
  if (!notebookId.value) {
    error.value = "缺少书籍工作台 ID。";
    loading.value = false;
    resetWorkbenchState();
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    await refreshSources();
    await refreshReportEntries();
    await refreshMessages();
    connectSSE();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "读取书籍来源失败";
  } finally {
    loading.value = false;
  }
}

function handleResearchEvent(event: ResearchRuntimeEvent) {
  if (event.type === "heartbeat") {
    return;
  }

  if (event.payload) {
    researchState.value = payloadToState(event.payload);
  }

  if (event.type === "progress" || (event.payload?.step === "refreshing_messages")) {
    void refreshMessages();
  }

  if (event.type === "completed") {
    void refreshMessages();
    void refreshReportEntries();
  }

  if (event.type === "stopped") {
    void refreshMessages();
  }

  if (event.type === "error" && event.payload?.lastError) {
    showToast(event.payload.lastError, "error");
  }
}

function connectSSE() {
  if (sseCleanup) {
    sseCleanup();
    sseCleanup = null;
  }

  if (!notebookId.value) {
    return;
  }

  sseCleanup = subscribeResearchStream(notebookId.value, {
    onEvent: handleResearchEvent,
    onError: () => {
      // EventSource 会自动重连，右侧保持最后状态即可。
    },
  });
}

function openUploadDialog() {
  uploadDialogOpen.value = true;
}

function closeUploadDialog() {
  if (busy.value) {
    return;
  }
  uploadDialogOpen.value = false;
}

async function onUploadBook(file: File) {
  if (!notebookId.value) {
    return;
  }

  startLoading("正在上传书籍...");
  progressMessage.value = "";

  try {
    const result = await uploadBookSourcePdf(notebookId.value, file, (event) => {
      progressMessage.value = event.message;
      addEntry("info", event.message);
    });

    if (result.success) {
      uploadDialogOpen.value = false;
      await refreshSources();
      showToast("书籍已提交，左侧面板已刷新。", "info");
      return;
    }

    await refreshSources();
    showToast(result.error ?? "书籍上传失败", "error");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "书籍上传失败", "error");
  } finally {
    stopLoading();
  }
}

function onRequestDeleteSource(sourceId: string) {
  deletingSourceId.value = sourceId;
}

function onCancelDeleteSource() {
  deletingSourceId.value = null;
}

async function onConfirmDeleteSource() {
  if (!notebookId.value || !deletingSourceId.value) {
    return;
  }

  const sourceId = deletingSourceId.value;
  deletingSourceId.value = null;

  try {
    await notebooksApi.deleteSource(notebookId.value, sourceId);
    await refreshSources();
    progressMessage.value = "";
    showToast("当前书籍已删除。", "info");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "删除书籍失败", "error");
  }
}

async function onToggleResearch() {
  if (!notebookId.value || !hasBook.value) {
    return;
  }

  try {
    if (researchState.value.status === "running") {
      await notebooksApi.stopResearch(notebookId.value);
      showToast("自动研究将在当前轮结束后停止。", "info");
      return;
    }

    await notebooksApi.startResearch(notebookId.value, { numQuestions: 20 });
    researchState.value = {
      ...researchState.value,
      status: "running",
      step: "starting",
      targetCount: 20,
    };
  } catch (err) {
    showToast(err instanceof Error ? err.message : "启动自动研究失败", "error");
  }
}

async function onGenerateBookSummary() {
  if (!notebookId.value || !canGenerateSummary.value) {
    return;
  }

  generatingBookSummary.value = true;
  try {
    await generateBookSummary(notebookId.value);
    await refreshReportEntries();
    if (currentBookSummary.value) {
      activeCenterTab.value = "summary";
    }
    showToast("书籍总结已生成。", "info");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "生成书籍总结失败", "error");
  } finally {
    generatingBookSummary.value = false;
  }
}

watch(
  currentBookSummary,
  (entry) => {
    if (!entry && activeCenterTab.value === "summary") {
      activeCenterTab.value = "history";
    }
  },
);

watch(
  notebookId,
  () => {
    if (sseCleanup) {
      sseCleanup();
      sseCleanup = null;
    }
    resetWorkbenchState();
    void loadWorkbench();
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
  <NotebookWorkbenchShell
    title="Book 工作台"
    :loading="loading"
    :error="error"
    :has-data="hasData"
    left-storage-key="book-workbench-left-width"
    right-storage-key="book-workbench-right-width"
    :on-share="undefined"
    :on-more="undefined"
  >
    <template #toast>
      <AppToast />
    </template>

    <template #loader>
      <FullscreenLoader :visible="loaderVisible" :title="loaderTitle" :entries="loaderEntries" />
    </template>

    <template #left>
      <BookSourcePanel
        :book="currentBook"
        :busy="busy"
        :progress-message="progressMessage"
        :on-upload="openUploadDialog"
        :on-replace="openUploadDialog"
        :on-delete="onRequestDeleteSource"
      />
    </template>

    <template #center>
      <div class="flex h-full min-h-0 flex-col">
        <div class="shrink-0 border-b border-[#d8cfbe] bg-[#f8f3ea]">
          <div class="flex">
            <button
              v-for="tab in centerTabs"
              :key="tab.key"
              type="button"
              class="flex-1 px-3 py-2.5 text-base transition-colors duration-100"
              :class="activeCenterTab === tab.key
                ? 'border-b-2 border-[#3a2e20] text-[#2f271f]'
                : 'text-[#8f7f6e] hover:text-[#665746]'"
              @click="activeCenterTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 pt-2">
          <ResearchHistoryPanel
            v-show="activeCenterTab === 'history'"
            :messages="messages"
          />
          <BookSummaryPanel
            v-show="activeCenterTab === 'summary'"
            :notebook-id="notebookId"
            :entry="currentBookSummary"
          />
        </div>
      </div>
    </template>

    <template #right>
      <BookActionsPanel
        :research-state="researchState"
        :has-book="hasBook"
        :can-quick-read="hasResearchHistory"
        :busy="busy"
        :quick-read-loading="generatingBookSummary"
        :on-toggle-research="onToggleResearch"
        :on-quick-read="onGenerateBookSummary"
      />
    </template>

    <template #dialogs>
      <UploadBookDialog
        :open="uploadDialogOpen"
        :busy="busy"
        :on-close="closeUploadDialog"
        :on-pick-file="onUploadBook"
      />

      <ConfirmDialog
        :visible="Boolean(deletingSourceId)"
        title="删除当前书籍"
        message="删除后，单书模式会回到空态。你可以重新上传另一本书。"
        confirm-text="删除"
        cancel-text="取消"
        :danger="true"
        @confirm="onConfirmDeleteSource"
        @cancel="onCancelDeleteSource"
      />
    </template>
  </NotebookWorkbenchShell>
</template>
