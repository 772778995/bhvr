<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ChatMessage, Notebook, ReportEntry, ResearchState, Source } from "@/api/notebooks";
import { notebooksApi } from "@/api/notebooks";
import { uploadBookSourcePdf } from "@/api/book-source";
import { generateBookSummary } from "@/api/book-summary";
import { payloadToState, subscribeResearchStream, type ResearchRuntimeEvent } from "@/api/sse";
import NotebookWorkbenchShell from "@/components/notebook-workbench/NotebookWorkbenchShell.vue";
import BookSourcePanel from "@/components/book-workbench/BookSourcePanel.vue";
import BookActionsPanel from "@/components/book-workbench/BookActionsPanel.vue";
import ResearchHistoryPanel from "@/components/book-workbench/ResearchHistoryPanel.vue";
import BookFinderPanel from "@/components/book-workbench/BookFinderPanel.vue";
import BookSummaryPanel from "@/components/book-workbench/BookSummaryPanel.vue";
import {
  getBookCenterTabButtonClass,
  getBookCenterTabIndicatorClass,
  getBookCenterTabs,
  getBookSummaries,
  getBookSummaryEntry,
} from "@/components/book-workbench/book-center";
import { canGenerateBookSummary, hasBookResearchHistory } from "@/components/book-workbench/book-view-state";
import { countResearchAnsweredRounds, type ResearchActionPendingState } from "@/components/book-workbench/book-actions";
import UploadBookDialog from "@/components/book-workbench/UploadBookDialog.vue";
import ConfirmDialog from "@/components/ui/ConfirmDialog.vue";
import AppToast from "@/components/ui/AppToast.vue";
import FullscreenLoader from "@/components/ui/FullscreenLoader.vue";
import { useToast } from "@/composables/useToast";
import { useGlobalLoader } from "@/composables/useGlobalLoader";
import { getCurrentBookSource } from "@/utils/book-source";
import {
  createBookFinderDisplayMessages,
  createBookFinderDraftPlaceholder,
  createBookWorkbenchHeaderState,
  createOptimisticBookFinderUserMessage,
  createStartingResearchState,
} from "./book-workbench-view";
import { getBookCenterTransition } from "./book-motion";

const route = useRoute();
const router = useRouter();
const { showToast } = useToast();
const { visible: loaderVisible, loaderTitle, entries: loaderEntries, startLoading, addEntry, stopLoading } = useGlobalLoader();

const loading = ref(true);
const error = ref("");
const notebook = ref<Notebook | null>(null);
const sources = ref<Source[]>([]);
const uploadDialogOpen = ref(false);
const deletingSourceId = ref<string | null>(null);
const progressMessage = ref("");
const activeCenterTab = ref<"history" | "book-finder" | "summary">("history");
const reportEntries = ref<ReportEntry[]>([]);
const selectedSummaryEntryId = ref<string | null>(null);
const generatingBookSummary = ref(false);
const bookFinderSending = ref(false);
const bookFinderDraft = ref("");
const messages = ref<ChatMessage[]>([]);
const bookFinderPersistedMessages = ref<ChatMessage[]>([]);
const researchActionPending = ref<ResearchActionPendingState>(null);
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
const bookSummaries = computed(() => getBookSummaries(reportEntries.value));
const latestBookSummary = computed(() => getBookSummaryEntry(reportEntries.value));
const headerState = computed(() => createBookWorkbenchHeaderState({
  notebookTitle: notebook.value?.title,
  navigate: (path) => {
    void router.push(path);
  },
}));
const currentBookSummary = computed(() => {
  if (selectedSummaryEntryId.value) {
    return bookSummaries.value.find((entry) => entry.id === selectedSummaryEntryId.value) ?? latestBookSummary.value;
  }

  return latestBookSummary.value;
});
const centerTabs = computed(() => getBookCenterTabs(bookSummaries.value.length > 0));
const hasData = computed(() => true);
const hasBook = computed(() => currentBook.value !== null);
const hasResearchHistory = computed(() => hasBookResearchHistory({
  messages: messages.value,
  researchState: researchState.value,
}));
const answeredRounds = computed(() => countResearchAnsweredRounds(messages.value));
const bookFinderMessages = computed(() => createBookFinderDisplayMessages(bookFinderPersistedMessages.value));
const canGenerateSummary = computed(() => canGenerateBookSummary({
  generating: generatingBookSummary.value,
  messages: messages.value,
  researchState: researchState.value,
}));
const busy = computed(() => loaderVisible.value);
const centerTransition = getBookCenterTransition();
const bookFinderPlaceholder = createBookFinderDraftPlaceholder();

function resetWorkbenchState() {
  notebook.value = null;
  sources.value = [];
  reportEntries.value = [];
  messages.value = [];
  bookFinderPersistedMessages.value = [];
  progressMessage.value = "";
  deletingSourceId.value = null;
  generatingBookSummary.value = false;
  bookFinderSending.value = false;
  bookFinderDraft.value = "";
  researchActionPending.value = null;
  selectedSummaryEntryId.value = null;
  activeCenterTab.value = "history";
  researchState.value = {
    status: "idle",
    step: "idle",
    completedCount: 0,
    targetCount: 0,
  };
}

async function refreshNotebook() {
  if (!notebookId.value) {
    notebook.value = null;
    return;
  }

  notebook.value = await notebooksApi.getNotebook(notebookId.value);
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

async function refreshBookFinderMessages() {
  if (!notebookId.value) {
    bookFinderPersistedMessages.value = [];
    return;
  }

  try {
    bookFinderPersistedMessages.value = await notebooksApi.getBookFinderMessages(notebookId.value);
  } catch (err) {
    showToast(err instanceof Error ? err.message : "刷新快速找书历史失败", "error");
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
    await refreshNotebook();
    await refreshSources();
    await refreshReportEntries();
    await refreshMessages();
    await refreshBookFinderMessages();
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

    if (event.payload.status === "running" || event.payload.status === "completed" || event.payload.status === "failed" || event.payload.status === "stopped") {
      researchActionPending.value = null;
    }
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

  const previousState = { ...researchState.value };

  try {
    if (researchState.value.status === "running") {
      researchActionPending.value = "stopping";
      await notebooksApi.stopResearch(notebookId.value);
      researchActionPending.value = null;
      showToast("自动研究将在当前轮结束后停止。", "info");
      return;
    }

    researchActionPending.value = "starting";
    researchState.value = createStartingResearchState(researchState.value);
    await notebooksApi.startResearch(notebookId.value, { numQuestions: 20 });
    researchActionPending.value = null;
  } catch (err) {
    researchState.value = previousState;
    researchActionPending.value = null;
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
    if (latestBookSummary.value) {
      selectedSummaryEntryId.value = latestBookSummary.value.id;
      activeCenterTab.value = "summary";
    }
    showToast("书籍总结已生成。", "info");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "生成书籍总结失败", "error");
  } finally {
    generatingBookSummary.value = false;
  }
}

function onBookFinderDraftChange(value: string) {
  bookFinderDraft.value = value;
}

async function onSubmitBookFinder() {
  const query = bookFinderDraft.value.trim();
  if (!notebookId.value || !query || bookFinderSending.value || busy.value) {
    return;
  }

  const optimisticMessage = createOptimisticBookFinderUserMessage(query);
  bookFinderPersistedMessages.value = mergeMessages(bookFinderPersistedMessages.value, [optimisticMessage]);
  bookFinderSending.value = true;
  bookFinderDraft.value = "";

  try {
    const optimisticId = optimisticMessage.id;
    await notebooksApi.searchBooks(notebookId.value, { query });
    bookFinderPersistedMessages.value = bookFinderPersistedMessages.value.filter((message) => message.id !== optimisticId);
    await refreshBookFinderMessages();
  } catch (err) {
    bookFinderPersistedMessages.value = bookFinderPersistedMessages.value.filter((message) => message.id !== optimisticMessage.id);
    showToast(err instanceof Error ? err.message : "快速找书失败", "error");
  } finally {
    bookFinderSending.value = false;
  }
}

function onSelectSummaryEntry(entryId: string) {
  selectedSummaryEntryId.value = entryId;
}

watch(
  currentBookSummary,
  (entry) => {
    if (!entry && activeCenterTab.value === "summary") {
      activeCenterTab.value = "history";
      selectedSummaryEntryId.value = null;
      return;
    }

    if (entry && !selectedSummaryEntryId.value) {
      selectedSummaryEntryId.value = entry.id;
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
    :title="headerState.title"
    :loading="loading"
    :error="error"
    :has-data="hasData"
    left-storage-key="book-workbench-left-width"
    right-storage-key="book-workbench-right-width"
    back-label="返回笔记列表"
    :on-back="headerState.goBack"
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
              :class="getBookCenterTabButtonClass(activeCenterTab === tab.key)"
              @click="activeCenterTab = tab.key"
            >
              <span>{{ tab.label }}</span>
              <span :class="getBookCenterTabIndicatorClass(activeCenterTab === tab.key)" aria-hidden="true"></span>
            </button>
          </div>
        </div>

        <div class="relative min-h-0 flex-1 overflow-hidden pt-2">
          <Transition :name="centerTransition.name" mode="out-in">
            <ResearchHistoryPanel
              v-if="activeCenterTab === 'history'"
              key="history"
              :messages="messages"
            />
            <BookFinderPanel
              v-else-if="activeCenterTab === 'book-finder'"
              key="book-finder"
              :messages="bookFinderMessages"
              :draft="bookFinderDraft"
              :placeholder="bookFinderPlaceholder"
              :sending="bookFinderSending"
              :on-draft-change="onBookFinderDraftChange"
              :on-submit="onSubmitBookFinder"
            />
            <BookSummaryPanel
              v-else
              key="summary"
              :notebook-id="notebookId"
              :entries="bookSummaries"
              :entry="currentBookSummary"
              :on-select-entry="onSelectSummaryEntry"
            />
          </Transition>
        </div>
      </div>
    </template>

    <template #right>
      <BookActionsPanel
        :research-state="researchState"
        :answered-rounds="answeredRounds"
        :has-book="hasBook"
        :can-quick-read="hasResearchHistory"
        :busy="busy"
        :quick-read-loading="generatingBookSummary"
        :research-action-pending="researchActionPending"
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

<style scoped>
.folio-panel-enter-active {
  transition: opacity v-bind('`${centerTransition.durationEnterMs}ms`') ease-out,
    transform v-bind('`${centerTransition.durationEnterMs}ms`') ease-out;
}

.folio-panel-leave-active {
  transition: opacity v-bind('`${centerTransition.durationLeaveMs}ms`') ease-in,
    transform v-bind('`${centerTransition.durationLeaveMs}ms`') ease-in;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.folio-panel-enter-from {
  opacity: 0;
  transform: translate3d(v-bind('`${centerTransition.enterX}px`'), v-bind('`${centerTransition.enterY}px`'), 0);
}

.folio-panel-leave-to {
  opacity: 0;
  transform: translate3d(v-bind('`${centerTransition.leaveX}px`'), 0, 0);
}
</style>
