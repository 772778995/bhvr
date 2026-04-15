<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ChatMessage, Notebook, ReportEntry, SendMessageHistoryItem, Source } from "@/api/notebooks";
import { notebooksApi } from "@/api/notebooks";
import { uploadBookSourcePdf } from "@/api/book-source";
import { generateBookSummary, getBookSummaryPreset, updateBookSummaryPreset } from "@/api/book-summary";
import NotebookWorkbenchShell from "@/components/notebook-workbench/NotebookWorkbenchShell.vue";
import BookSourcePanel from "@/components/book-workbench/BookSourcePanel.vue";
import BookActionsPanel from "@/components/book-workbench/BookActionsPanel.vue";
import BookFinderPanel from "@/components/book-workbench/BookFinderPanel.vue";
import BookSummaryPanel from "@/components/book-workbench/BookSummaryPanel.vue";
import ChatPanel from "@/components/notebook-workbench/ChatPanel.vue";
import {
  getBookCenterTabButtonClass,
  getBookCenterTabIndicatorClass,
  getBookCenterTabs,
  getBookSummaries,
  getBookSummaryEntry,
} from "@/components/book-workbench/book-center";
import { canGenerateBookSummary } from "@/components/book-workbench/book-view-state";
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
const activeCenterTab = ref<"chat" | "summary" | "book-finder">("chat");
const reportEntries = ref<ReportEntry[]>([]);
const selectedSummaryEntryId = ref<string | null>(null);
const generatingBookSummary = ref(false);
const generatingDeepReading = ref(false);
const generatingMindmap = ref(false);
const sending = ref(false);
const bookFinderSending = ref(false);
const bookFinderDraft = ref("");
const promptDialogOpen = ref(false);
const promptDialogMode = ref<"quick-read" | "deep-reading" | null>(null);
const promptDialogPrompt = ref("");
const promptDialogLoading = ref(false);
const promptDialogSaving = ref(false);
const promptDialogError = ref("");
const messages = ref<ChatMessage[]>([]);
const bookFinderPersistedMessages = ref<ChatMessage[]>([]);
const activeConversationId = ref<string | null>(null);
const conversationHistory = ref<SendMessageHistoryItem[]>([]);

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
const bookFinderMessages = computed(() => createBookFinderDisplayMessages(bookFinderPersistedMessages.value));
const isGeneratingReadingOutput = computed(() => Boolean(generatingBookSummary.value) || Boolean(generatingDeepReading.value) || Boolean(generatingMindmap.value));
const canGenerateSummary = computed(() => canGenerateBookSummary({
  generating: isGeneratingReadingOutput.value,
  hasBook: hasBook.value,
}));
const busy = computed(() => loaderVisible.value);
const centerTransition = getBookCenterTransition();
const bookFinderPlaceholder = createBookFinderDraftPlaceholder();
const promptDialogLabel = computed(() => promptDialogMode.value === "deep-reading" ? "详细解读" : "书籍简述");

function resolvePromptPresetId(mode: "quick-read" | "deep-reading") {
  return mode === "deep-reading" ? "builtin-deep-reading" : "builtin-quick-read";
}

function resetWorkbenchState() {
  notebook.value = null;
  sources.value = [];
  reportEntries.value = [];
  messages.value = [];
  bookFinderPersistedMessages.value = [];
  progressMessage.value = "";
  deletingSourceId.value = null;
  generatingBookSummary.value = false;
  generatingDeepReading.value = false;
  generatingMindmap.value = false;
  sending.value = false;
  bookFinderSending.value = false;
  bookFinderDraft.value = "";
  promptDialogOpen.value = false;
  promptDialogMode.value = null;
  promptDialogPrompt.value = "";
  promptDialogLoading.value = false;
  promptDialogSaving.value = false;
  promptDialogError.value = "";
  activeConversationId.value = null;
  conversationHistory.value = [];
  selectedSummaryEntryId.value = null;
  activeCenterTab.value = "chat";
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
    messages.value = mergeMessages(messages.value, await notebooksApi.getChatMessages(notebookId.value));
    conversationHistory.value = messages.value.map((message) => ({
      role: message.role,
      message: message.content,
    }));
  } catch (err) {
    showToast(err instanceof Error ? err.message : "刷新对话记录失败", "error");
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
  } catch (err) {
    error.value = err instanceof Error ? err.message : "读取书籍来源失败";
  } finally {
    loading.value = false;
  }
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

async function onSendMessage(content: string) {
  const trimmedContent = content.trim();
  if (!notebookId.value || !trimmedContent || sending.value) {
    return;
  }

  sending.value = true;

  try {
    const result = await notebooksApi.sendMessage(notebookId.value, {
      content: trimmedContent,
      ...(activeConversationId.value ? { conversationId: activeConversationId.value } : {}),
      ...(conversationHistory.value.length > 0
        ? { conversationHistory: conversationHistory.value }
        : {}),
    });

    activeConversationId.value = result.conversationId;
    if (result.message) {
      conversationHistory.value = [
        ...conversationHistory.value,
        { role: "user", message: trimmedContent },
        { role: "assistant", message: result.message.content },
      ];
    }
    await refreshMessages();
  } catch (err) {
    showToast(err instanceof Error ? err.message : "发送消息失败", "error");
  } finally {
    sending.value = false;
  }
}

async function generateReadingOutput(options: {
  presetId: "builtin-quick-read" | "builtin-deep-reading" | "builtin-book-mindmap";
  begin: () => void;
  end: () => void;
  successMessage: string;
  failureMessage: string;
}) {
  if (!notebookId.value || !canGenerateSummary.value || isGeneratingReadingOutput.value) {
    return;
  }

  options.begin();
  try {
    const result = await generateBookSummary(notebookId.value, options.presetId);
    await refreshReportEntries();
    const newestSummary = getBookSummaryEntry(reportEntries.value);
    if (newestSummary) {
      selectedSummaryEntryId.value = newestSummary.id;
      activeCenterTab.value = "summary";
    }
    showToast(result.message || options.successMessage, "info");
  } catch (err) {
    showToast(err instanceof Error ? err.message : options.failureMessage, "error");
  } finally {
    options.end();
  }
}

async function onGenerateBookSummary() {
  await generateReadingOutput({
    presetId: "builtin-quick-read",
    begin: () => {
      generatingBookSummary.value = true;
    },
    end: () => {
      generatingBookSummary.value = false;
    },
    successMessage: "书籍简述已生成。",
    failureMessage: "生成书籍简述失败",
  });
}

async function onGenerateDeepReading() {
  await generateReadingOutput({
    presetId: "builtin-deep-reading",
    begin: () => {
      generatingDeepReading.value = true;
    },
    end: () => {
      generatingDeepReading.value = false;
    },
    successMessage: "详细解读已生成。",
    failureMessage: "生成详细解读失败",
  });
}

async function onGenerateMindmap() {
  await generateReadingOutput({
    presetId: "builtin-book-mindmap",
    begin: () => {
      generatingMindmap.value = true;
    },
    end: () => {
      generatingMindmap.value = false;
    },
    successMessage: "书籍导图已生成。",
    failureMessage: "生成书籍导图失败",
  });
}

async function openPromptDialog(mode: "quick-read" | "deep-reading") {
  if (busy.value) {
    return;
  }

  promptDialogOpen.value = true;
  promptDialogMode.value = mode;
  promptDialogPrompt.value = "";
  promptDialogError.value = "";
  promptDialogLoading.value = true;

  try {
    const preset = await getBookSummaryPreset(resolvePromptPresetId(mode));
    promptDialogPrompt.value = preset.prompt;
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取提示词失败";
    promptDialogError.value = message;
    showToast(message, "error");
  } finally {
    promptDialogLoading.value = false;
  }
}

function openQuickReadPromptDialog() {
  void openPromptDialog("quick-read");
}

function openDeepReadingPromptDialog() {
  void openPromptDialog("deep-reading");
}

function closePromptDialog() {
  if (promptDialogSaving.value) {
    return;
  }

  promptDialogOpen.value = false;
  promptDialogMode.value = null;
  promptDialogPrompt.value = "";
  promptDialogError.value = "";
  promptDialogLoading.value = false;
}

async function savePromptDialog() {
  if (!promptDialogMode.value || promptDialogLoading.value || promptDialogSaving.value) {
    return;
  }

  const prompt = promptDialogPrompt.value.trim();
  if (!prompt) {
    promptDialogError.value = "提示词不能为空。";
    return;
  }

  promptDialogSaving.value = true;
  promptDialogError.value = "";
  try {
    await updateBookSummaryPreset(resolvePromptPresetId(promptDialogMode.value), prompt);
    showToast(`${promptDialogLabel.value}提示词已更新。`, "info");
    closePromptDialog();
  } catch (err) {
    const message = err instanceof Error ? err.message : "保存提示词失败";
    promptDialogError.value = message;
    showToast(message, "error");
  } finally {
    promptDialogSaving.value = false;
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
  activeCenterTab.value = "summary";
}

watch(
  currentBookSummary,
  (entry) => {
    if (!entry) {
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
    resetWorkbenchState();
    void loadWorkbench();
  },
  { immediate: true },
);
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
            <ChatPanel
              v-if="activeCenterTab === 'chat'"
              key="chat"
              :messages="messages"
              :sending="sending"
              :on-send="onSendMessage"
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
            />
          </Transition>
        </div>
      </div>
    </template>

    <template #right>
        <BookActionsPanel
          :has-book="hasBook"
          :busy="busy"
          :quick-read-loading="generatingBookSummary"
          :deep-reading-loading="generatingDeepReading"
          :mindmap-loading="generatingMindmap"
          :history-entries="bookSummaries"
          :selected-entry-id="currentBookSummary?.id ?? null"
          :on-quick-read="onGenerateBookSummary"
          :on-configure-quick-read="openQuickReadPromptDialog"
          :on-deep-reading="onGenerateDeepReading"
          :on-configure-deep-reading="openDeepReadingPromptDialog"
          :on-mindmap="onGenerateMindmap"
          :on-select-entry="onSelectSummaryEntry"
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

      <div
        v-if="promptDialogOpen"
        class="fixed inset-0 z-40 bg-[#20170f]/35"
        @click="closePromptDialog"
      ></div>
      <div v-if="promptDialogOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <section
          class="w-full max-w-3xl border border-[#d8cfbe] bg-[#f8f3ea] shadow-[0_24px_70px_rgba(47,39,31,0.18)]"
          @click.stop
        >
          <header class="flex items-start justify-between gap-4 border-b border-[#d8cfbe] bg-[#fbf6ed] px-5 py-4">
            <div>
              <p class="text-sm tracking-[0.18em] text-[#8a7864] uppercase">输出提示词</p>
              <h2 class="mt-2 text-[1.1rem] leading-tight text-[#34281d]" style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;">
                {{ promptDialogLabel }}
              </h2>
            </div>
            <button
              type="button"
              class="border border-[#d8cfbe] bg-[#fffaf2] px-3 py-2 text-sm text-[#5d4f3d] transition-colors duration-100 hover:bg-[#f1e7d8]"
              :disabled="promptDialogSaving"
              @click="closePromptDialog"
            >
              关闭
            </button>
          </header>

          <div class="px-5 py-5">
            <p class="text-base leading-7 text-[#5d4f3d]">
              修改后，后续生成会直接使用新的提示词。这里改的是当前内置阅读动作的实际输出指令。
            </p>
            <p v-if="promptDialogError" class="mt-4 border border-[#d9c1b8] bg-[#fbefe9] px-4 py-3 text-sm leading-6 text-[#8b4b3c]">
              {{ promptDialogError }}
            </p>
            <p v-if="promptDialogLoading" class="mt-4 text-base leading-7 text-[#8a7864]">
              正在加载提示词...
            </p>
            <textarea
              v-else
              v-model="promptDialogPrompt"
              rows="14"
              class="mt-4 w-full border border-[#cab79c] bg-[#fffaf1] px-4 py-3 text-base leading-7 text-[#34281d] outline-none transition-colors duration-100 focus:border-[#a48d68]"
              placeholder="请输入输出提示词"
            ></textarea>
          </div>

          <footer class="flex items-center justify-end gap-3 border-t border-[#d8cfbe] bg-[#fbf6ed] px-5 py-4">
            <button
              type="button"
              class="border border-[#d8cfbe] bg-[#fffaf2] px-4 py-2 text-sm text-[#5d4f3d] transition-colors duration-100 hover:bg-[#f1e7d8]"
              :disabled="promptDialogSaving"
              @click="closePromptDialog"
            >
              取消
            </button>
            <button
              type="button"
              class="border border-[#3a2e20] bg-[#3a2e20] px-4 py-2 text-sm text-[#f8f3ea] transition-colors duration-100 hover:bg-[#2f271f] disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="promptDialogLoading || promptDialogSaving || !promptDialogPrompt.trim()"
              @click="savePromptDialog"
            >
              {{ promptDialogSaving ? "保存中..." : "保存提示词" }}
            </button>
          </footer>
        </section>
      </div>
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
