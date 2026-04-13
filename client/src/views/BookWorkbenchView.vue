<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { Source } from "@/api/notebooks";
import { notebooksApi } from "@/api/notebooks";
import { uploadBookSourcePdf } from "@/api/book-source";
import NotebookWorkbenchShell from "@/components/notebook-workbench/NotebookWorkbenchShell.vue";
import BookSourcePanel from "@/components/book-workbench/BookSourcePanel.vue";
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

const notebookId = computed(() => {
  const value = route.params.id;
  return typeof value === "string" ? value.trim() : "";
});

const currentBook = computed(() => getCurrentBookSource(sources.value));
const hasData = computed(() => true);
const hasBook = computed(() => currentBook.value !== null);
const currentBookTitle = computed(() => currentBook.value?.title ?? "当前书籍");
const busy = computed(() => loaderVisible.value);

async function refreshSources() {
  if (!notebookId.value) {
    sources.value = [];
    return;
  }
  sources.value = await notebooksApi.getSources(notebookId.value);
}

async function loadWorkbench() {
  if (!notebookId.value) {
    error.value = "缺少书籍工作台 ID。";
    loading.value = false;
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    await refreshSources();
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

onMounted(() => {
  void loadWorkbench();
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
      <section class="flex h-full flex-col justify-center border border-[#d8cfbe] bg-[#fbf7ef] px-8 py-10 text-center text-[#3d3126]">
        <p class="text-xs uppercase tracking-[0.28em] text-[#8d7f6d]">
          Book Workbench
        </p>
        <h2
          class="mt-4 text-[1.9rem] leading-tight text-[#2f2418] sm:text-[2.2rem]"
          style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;"
        >
          {{ hasBook ? currentBookTitle : '等待接入一本书' }}
        </h2>
        <p class="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#615444] sm:text-[1.05rem]">
          <template v-if="hasBook">
            左侧书籍面板已经切入单书模式。中间研究区和右侧阅读工具仍沿用后续任务接入，不在这里胡乱抢活。
          </template>
          <template v-else>
            先在左侧上传一本 PDF。书籍上传成功后，这个工作台会以该书为唯一阅读来源，进入后续阅读流程。
          </template>
        </p>
      </section>
    </template>

    <template #right>
      <section class="flex h-full items-center justify-center border border-[#d8cfbe] bg-[#f3ecdf] px-6 text-center text-base leading-relaxed text-[#7a6c59]">
        右侧扩展区暂时留白。
      </section>
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
