<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  ArtifactState,
  notebooksApi,
  type ChatMessage,
  type Notebook,
  type ReportEntry,
  type ResearchState,
  type SendMessageHistoryItem,
  type Source,
  type SourceAddResponse,
} from "@/api/notebooks";
import {
  payloadToState,
  subscribeResearchStream,
  type ResearchRuntimeEvent,
} from "@/api/sse";
import NotebookWorkbenchShell from "@/components/notebook-workbench/NotebookWorkbenchShell.vue";
import SourcesPanel from "@/components/notebook-workbench/SourcesPanel.vue";
import ChatPanel from "@/components/notebook-workbench/ChatPanel.vue";
import StudioPanel from "@/components/notebook-workbench/StudioPanel.vue";
import ReportListPanel from "@/components/notebook-workbench/ReportListPanel.vue";
import ReportDetailPanel from "@/components/notebook-workbench/ReportDetailPanel.vue";
import AddSourceDialog from "@/components/notebook-workbench/AddSourceDialog.vue";
import ConfirmDialog from "@/components/ui/ConfirmDialog.vue";
import AppToast from "@/components/ui/AppToast.vue";
import { useToast } from "@/composables/useToast";
import { useGlobalLoader } from "@/composables/useGlobalLoader";
import FullscreenLoader from "@/components/ui/FullscreenLoader.vue";
import { streamPostSSE } from "@/api/source-stream";

const route = useRoute();
const { showToast } = useToast();
const { visible: loaderVisible, loaderTitle, entries: loaderEntries, startLoading, addEntry, stopLoading } = useGlobalLoader();

// ── Center tab state ────────────────────────────────────────────────────────
const activeCenterTab = ref<'chat' | 'reports'>('chat');

// ── Center panel state ──────────────────────────────────────────────────────
const reportView = ref<'list' | 'detail'>('list');
const selectedEntry = ref<ReportEntry | null>(null);

/** Incremented to trigger ReportListPanel to re-fetch. */
const artifactRefreshKey = ref(0);

/** Cache of the unified entries list so we can look up entries by ID. */
const cachedEntries = ref<ReportEntry[]>([]);

// ── Delete confirmation ─────────────────────────────────────────────────────
const showDeleteConfirm = ref(false);
const pendingDeleteId = ref<string | null>(null);

// ── Source delete confirmation ──────────────────────────────────────────────
const showSourceDeleteConfirm = ref(false);
const pendingDeleteSource = ref<{ id: string; title: string } | null>(null);

// ── Core data ───────────────────────────────────────────────────────────────
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

const addSourceOpen = ref(false);
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

/** True when there are sources but every one of them is still processing.
 *  In this state, auto-research should be blocked — NotebookLM can't answer yet. */
const sourcesAllProcessing = computed(() => {
  return sources.value.length > 0 && sources.value.every((s) => s.status === "processing");
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
  selectedEntry.value = null;
  cachedEntries.value = [];
  reportView.value = 'list';
}

function pushNotice(message: string, type: "info" | "error" = "info") {
  showToast(message, type);
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
  sources.value = await notebooksApi.getSources(notebookId.value);
}

async function onAddSourceUrl(payload: { url: string; title?: string }) {
  if (!notebookId.value) return;
  addSourceOpen.value = false;
  startLoading('正在添加网页来源...');
  const result = await streamPostSSE<SourceAddResponse>(
    `/api/notebooks/${notebookId.value}/sources/stream/add/url`,
    payload,
    (p) => addEntry('info', p.message)
  );
  stopLoading();
  if (result.success) {
    await refreshSources();
  } else if (result.timedOut) {
    await refreshSources();
    pushNotice('来源已提交，仍在处理中。列表已刷新，请稍后查看完整状态。');
  } else {
    pushNotice(result.error ?? '添加网站来源失败', 'error');
  }
}

async function onAddSourceText(payload: { title: string; content: string }) {
  if (!notebookId.value) return;
  addSourceOpen.value = false;
  startLoading('正在添加文本来源...');
  const result = await streamPostSSE<SourceAddResponse>(
    `/api/notebooks/${notebookId.value}/sources/stream/add/text`,
    payload,
    (p) => addEntry('info', p.message)
  );
  stopLoading();
  if (result.success) {
    await refreshSources();
  } else if (result.timedOut) {
    await refreshSources();
    pushNotice('来源已提交，仍在处理中。列表已刷新，请稍后查看完整状态。');
  } else {
    pushNotice(result.error ?? '添加文本来源失败', 'error');
  }
}

async function onAddSourceFile(file: File) {
  if (!notebookId.value) return;
  addSourceOpen.value = false;
  startLoading('正在上传文件来源...');
  const formData = new FormData();
  formData.append('file', file);
  const result = await streamPostSSE<SourceAddResponse>(
    `/api/notebooks/${notebookId.value}/sources/stream/add/file`,
    formData,
    (p) => addEntry('info', p.message)
  );
  stopLoading();
  if (result.success) {
    await refreshSources();
  } else if (result.timedOut) {
    await refreshSources();
    pushNotice('来源已提交，仍在处理中。列表已刷新，请稍后查看完整状态。');
  } else {
    pushNotice(result.error ?? '上传文件来源失败', 'error');
  }
}

async function onSearchAndAddSources(payload: {
  query: string;
  sourceType: 'web' | 'drive';
  mode: 'fast' | 'deep';
}) {
  if (!notebookId.value) return;
  addSourceOpen.value = false;
  startLoading('正在搜索并添加来源...');
  const result = await streamPostSSE(
    `/api/notebooks/${notebookId.value}/sources/stream/search-and-add`,
    payload,
    (p) => addEntry('info', p.message)
  );
  stopLoading();
  if (result.success) {
    await refreshSources();
  } else if (result.timedOut) {
    await refreshSources();
    pushNotice('来源已提交，仍在处理中。列表已刷新，请稍后查看完整状态。');
  } else if (result.error) {
    pushNotice(result.error, 'error');
  }
}

async function onSendMessage(content: string) {
  const trimmedContent = content.trim();
  if (!notebookId.value || !trimmedContent || sending.value) {
    return;
  }

  sending.value = true;
  startLoading('正在发送消息...');

  try {
    const result = await notebooksApi.sendMessage(notebookId.value, {
      content: trimmedContent,
      ...(activeConversationId.value ? { conversationId: activeConversationId.value } : {}),
      ...(conversationHistory.value.length > 0
        ? { conversationHistory: conversationHistory.value }
        : {}),
    });

    activeConversationId.value = result.conversationId;
    conversationHistory.value = result.message
      ? [...conversationHistory.value, { role: "user" as const, message: trimmedContent }, { role: "assistant" as const, message: result.message.content }]
      : conversationHistory.value;
    await refreshMessages();
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "发送消息失败", "error");
  } finally {
    sending.value = false;
    stopLoading();
  }
}

/** Refresh conversation messages from the backend. */
async function refreshMessages() {
  if (!notebookId.value) return;
  try {
    messages.value = mergeMessages(messages.value, await notebooksApi.getMessages(notebookId.value));
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "刷新对话记录失败", "error");
  }
}

// ── Reports ─────────────────────────────────────────────────────────────────
async function refreshReports() {
  if (!notebookId.value) return;
  try {
    cachedEntries.value = await notebooksApi.listEntries(notebookId.value);
  } catch {
    // Silently fail – user can retry
  }
}

function onSelectEntry(entryId: string) {
  const entry = cachedEntries.value.find((e) => e.id === entryId);
  if (!entry) {
    // Cache may be stale — refresh and retry once
    void refreshReports().then(() => {
      const retried = cachedEntries.value.find((e) => e.id === entryId);
      if (retried) {
        selectedEntry.value = retried;
        reportView.value = 'detail';
      }
    });
    return;
  }
  selectedEntry.value = entry;
  reportView.value = 'detail';
}

/** Sync parent cache when ReportListPanel finishes a fetch. */
function onEntriesLoaded(entries: ReportEntry[]) {
  cachedEntries.value = entries;
}

function onBackToList() {
  selectedEntry.value = null;
  reportView.value = 'list';
}

function onRequestDeleteReport(reportId: string) {
  pendingDeleteId.value = reportId;
  showDeleteConfirm.value = true;
}

async function doDeleteReport() {
  if (!notebookId.value || !pendingDeleteId.value) return;
  showDeleteConfirm.value = false;
  try {
    await notebooksApi.deleteEntry(notebookId.value, pendingDeleteId.value);
    // If we were viewing the deleted item, go back to list
    if (selectedEntry.value?.id === pendingDeleteId.value) {
      selectedEntry.value = null;
      reportView.value = 'list';
    }
    pushNotice("已删除");
    await refreshReports();
    artifactRefreshKey.value++;
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "删除失败", "error");
  } finally {
    pendingDeleteId.value = null;
  }
}

function onCancelDelete() {
  showDeleteConfirm.value = false;
  pendingDeleteId.value = null;
}

// ── Source deletion ─────────────────────────────────────────────────────────
function onRequestDeleteSource(sourceId: string) {
  const source = sources.value.find((s) => s.id === sourceId);
  if (!source) return;
  pendingDeleteSource.value = { id: source.id, title: source.title };
  showSourceDeleteConfirm.value = true;
}

async function doDeleteSource() {
  if (!notebookId.value || !pendingDeleteSource.value) return;
  showSourceDeleteConfirm.value = false;
  const { id, title } = pendingDeleteSource.value;
  try {
    await notebooksApi.deleteSource(notebookId.value, id);
    pushNotice(`来源「${title}」已删除`);
    await refreshSources();
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "删除来源失败", "error");
  } finally {
    pendingDeleteSource.value = null;
  }
}

function onCancelSourceDelete() {
  showSourceDeleteConfirm.value = false;
  pendingDeleteSource.value = null;
}

// ── Research ────────────────────────────────────────────────────────────────
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
  }

  if (event.type === "stopped") {
    void refreshMessages();
  }

  if (event.type === "error" && event.payload?.lastError) {
    pushNotice(event.payload.lastError, "error");
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
    if (researchState.value.status === "running") {
      await notebooksApi.stopResearch(notebookId.value);
      pushNotice("自动研究将在当前轮结束后停止");
    } else {
      await notebooksApi.startResearch(notebookId.value);
      researchState.value = {
        ...researchState.value,
        status: "running",
        step: "starting",
      };
    }
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "启动研究失败", "error");
  }
}

/** Generates a research report from local Q&A data via our own system. */
async function onGenerateReport(presetId?: string): Promise<void> {
  if (!notebookId.value) return;
  try {
    await notebooksApi.generateReport(notebookId.value, presetId);
    pushNotice("研究报告已生成");
    await refreshReports();
    activeCenterTab.value = 'reports';
    reportView.value = 'list';
  } catch (err) {
    pushNotice(err instanceof Error ? err.message : "生成研究报告失败", "error");
  }
}

/** Called when a Studio artifact finishes generating — refresh list + switch tab. */
async function onArtifactReady() {
  artifactRefreshKey.value++;
  activeCenterTab.value = 'reports';
  await refreshReports();

  if (selectedEntry.value?.artifactType === "audio") {
    const latestAudio = cachedEntries.value.find((entry) => entry.artifactType === "audio");
    if (latestAudio) {
      selectedEntry.value = latestAudio;
      reportView.value = 'detail';
    }
  }
}

// ── Source processing polling ────────────────────────────────────────────────
let sourcePollingTimer: ReturnType<typeof setInterval> | null = null;
let sourcePollingStart = 0;
const SOURCE_POLL_INTERVAL = 5000; // 5 seconds
const SOURCE_POLL_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function startSourcePolling() {
  if (sourcePollingTimer) return; // already polling
  sourcePollingStart = Date.now();
  sourcePollingTimer = setInterval(async () => {
    if (Date.now() - sourcePollingStart > SOURCE_POLL_TIMEOUT) {
      stopSourcePolling();
      pushNotice("来源处理超时，请检查笔记本状态");
      void refreshSources();
      return;
    }
    try {
      // 直接用 getSources() 检查来源状态，避免依赖可能不稳定的 getSourceProcessingStatus
      const latestSources = await notebooksApi.getSources(notebookId.value);
      const stillProcessing = latestSources.some((s) => s.status === "processing");
      if (!stillProcessing) {
        // 所有来源已结束（ready 或 failed），直接更新列表并停止轮询
        sources.value = latestSources;
        stopSourcePolling();
      }
    } catch {
      // Silently continue polling
    }
  }, SOURCE_POLL_INTERVAL);
}

function stopSourcePolling() {
  if (sourcePollingTimer) {
    clearInterval(sourcePollingTimer);
    sourcePollingTimer = null;
  }
}

watch(
  () => sources.value.some((s) => s.status === "processing"),
  (hasProcessing) => {
    if (hasProcessing) {
      startSourcePolling();
    } else {
      stopSourcePolling();
    }
  },
  { immediate: true },
);

// ── Artifact creating recovery polling ──────────────────────────────────────
const entryPollingTimers = new Map<string, ReturnType<typeof setInterval>>();
const entryPollingStarts = new Map<string, number>();
/** Track entries that timed out so we don't restart polling via watch. */
const timedOutEntryIds = new Set<string>();
const ENTRY_POLL_INTERVAL = 10_000; // 10 seconds
const ENTRY_POLL_TIMEOUT = 10 * 60 * 1000; // 10 minutes

function startEntryPolling(entryId: string, artifactId: string) {
  if (entryPollingTimers.has(entryId) || timedOutEntryIds.has(entryId)) return;
  entryPollingStarts.set(entryId, Date.now());
  entryPollingTimers.set(
    entryId,
    setInterval(async () => {
      if (Date.now() - (entryPollingStarts.get(entryId) ?? 0) > ENTRY_POLL_TIMEOUT) {
        stopEntryPolling(entryId);
        timedOutEntryIds.add(entryId);
        const entry = cachedEntries.value.find((e) => e.id === entryId);
        const label = entry?.title ?? "产物";
        pushNotice(`「${label}」生成超时，请检查笔记本状态`);
        void refreshReports();
        return;
      }
      try {
        const artifact = await notebooksApi.getArtifact(notebookId.value, artifactId);
        if (artifact.state === ArtifactState.READY || artifact.state === ArtifactState.FAILED) {
          stopEntryPolling(entryId);
          await refreshReports();
        }
      } catch {
        // 静默继续轮询
      }
    }, ENTRY_POLL_INTERVAL),
  );
}

function stopEntryPolling(entryId: string) {
  const timer = entryPollingTimers.get(entryId);
  if (timer) {
    clearInterval(timer);
    entryPollingTimers.delete(entryId);
    entryPollingStarts.delete(entryId);
  }
}

function stopAllEntryPolling() {
  for (const entryId of [...entryPollingTimers.keys()]) {
    stopEntryPolling(entryId);
  }
}

watch(
  cachedEntries,
  (entries) => {
    const creatingIds = new Set<string>();
    for (const entry of entries) {
      if (entry.state === "creating" && entry.artifactId) {
        creatingIds.add(entry.id);
        startEntryPolling(entry.id, entry.artifactId);
      }
    }
    // 停止不再处于 creating 状态的条目的轮询
    for (const entryId of [...entryPollingTimers.keys()]) {
      if (!creatingIds.has(entryId)) {
        stopEntryPolling(entryId);
      }
    }
  },
  { immediate: true },
);

// ── Data loading ────────────────────────────────────────────────────────────
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

  const [notebookResult, sourcesResult, messagesResult] = await Promise.allSettled([
    notebooksApi.getNotebook(notebookId.value),
    notebooksApi.getSources(notebookId.value),
    notebooksApi.getMessages(notebookId.value),
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
  messages.value = messagesResult.status === "fulfilled" ? mergeMessages([], messagesResult.value) : [];

  const partialFailure = sourcesResult.status === "rejected" || messagesResult.status === "rejected";

  if (partialFailure) {
    pushNotice("部分区域加载失败，已展示可用内容。");
  }

  // Load reports list (non-blocking)
  void refreshReports();

  loading.value = false;
}

watch(
  notebookId,
  (newId, oldId) => {
    if (newId !== oldId && sseCleanup) {
      sseCleanup();
      sseCleanup = null;
    }

    // Clean up polling state from the previous notebook
    stopSourcePolling();
    stopAllEntryPolling();
    timedOutEntryIds.clear();

    void loadWorkbenchData();
  },
  { immediate: true },
);

onUnmounted(() => {
  if (sseCleanup) {
    sseCleanup();
    sseCleanup = null;
  }
  stopSourcePolling();
  stopAllEntryPolling();
});
</script>

<template>
  <NotebookWorkbenchShell
    :title="notebook?.title ?? 'Notebook 工作台'"
    :loading="loading"
    :error="error"
    :has-data="hasData"
    empty-message="当前 Notebook 暂无可展示数据。"
    left-storage-key="notebook-left-width"
    right-storage-key="notebook-right-width"
    :on-share="onTopAction"
    :on-more="onTopAction"
  >
    <template #toast>
      <AppToast />
    </template>

    <template #loader>
      <FullscreenLoader :visible="loaderVisible" :title="loaderTitle" :entries="loaderEntries" />
    </template>

    <template #left>
      <SourcesPanel
        :sources="sources"
        :on-add-source="onAddSource"
        :on-delete-source="onRequestDeleteSource"
      />
    </template>

    <template #center>
      <div class="flex h-full min-h-0 flex-col">
        <div class="mb-0 shrink-0 flex border-b border-[#d8cfbe]">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm font-medium transition-colors duration-100"
            :class="activeCenterTab === 'chat'
              ? 'text-[#2f271f] border-b-2 border-[#3a2e20]'
              : 'text-[#9a8a78] hover:text-[#6a5b49]'"
            @click="activeCenterTab = 'chat'"
          >
            对话
          </button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm font-medium transition-colors duration-100"
            :class="activeCenterTab === 'reports'
              ? 'text-[#2f271f] border-b-2 border-[#3a2e20]'
              : 'text-[#9a8a78] hover:text-[#6a5b49]'"
            @click="activeCenterTab = 'reports'"
          >
            报告
          </button>
        </div>

        <div class="min-h-0 flex-1 pt-2">
          <ChatPanel
            v-show="activeCenterTab === 'chat'"
            :messages="messages"
            :sending="sending"
            :on-send="onSendMessage"
          />
          <template v-if="activeCenterTab === 'reports'">
            <ReportListPanel
              v-if="reportView === 'list'"
              :notebook-id="notebookId"
              :refresh-key="artifactRefreshKey"
              :on-select="onSelectEntry"
              :on-select-artifact="onSelectEntry"
              :on-delete="onRequestDeleteReport"
              :on-entries-loaded="onEntriesLoaded"
            />
            <ReportDetailPanel
              v-else-if="reportView === 'detail' && selectedEntry"
              :notebook-id="notebookId"
              :entry="selectedEntry ?? undefined"
              :on-back="onBackToList"
            />
          </template>
        </div>
      </div>
    </template>

    <template #right>
      <StudioPanel
        :notebook-id="notebookId"
        :research-state="researchState"
        :has-research-assets="hasResearchAssets"
        :message-count="messages.length"
        :sources-all-processing="sourcesAllProcessing"
        :on-start-research="onStartResearch"
        :on-generate-report="onGenerateReport"
        :on-artifact-ready="onArtifactReady"
      />
    </template>

    <template #dialogs>
      <AddSourceDialog
        :open="addSourceOpen"
        :busy="false"
        :on-close="onCloseAddSourceDialog"
        :on-add-url="onAddSourceUrl"
        :on-add-text="onAddSourceText"
        :on-search="onSearchAndAddSources"
        :on-pick-file="onAddSourceFile"
      />

      <ConfirmDialog
        :visible="showDeleteConfirm"
        title="删除报告"
        message="确定要删除这份报告吗？此操作不可撤销。"
        confirm-text="删除"
        :danger="true"
        @confirm="doDeleteReport"
        @cancel="onCancelDelete"
      />

      <ConfirmDialog
        :visible="showSourceDeleteConfirm"
        title="删除来源"
        :message="`确定要删除来源「${pendingDeleteSource?.title ?? ''}」吗？此操作不可撤销。`"
        confirm-text="删除"
        :danger="true"
        @confirm="doDeleteSource"
        @cancel="onCancelSourceDelete"
      />
    </template>
  </NotebookWorkbenchShell>
</template>
