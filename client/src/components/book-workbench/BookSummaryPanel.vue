<script setup lang="ts">
import { computed, ref } from "vue";
import type { ReportEntry } from "@/api/notebooks";
import ReportDetailPanel from "@/components/notebook-workbench/ReportDetailPanel.vue";
import { getBookDetailTransition } from "@/views/book-motion";
import { getBookSummaryDetailLayout } from "./book-layout";

interface Props {
  notebookId: string;
  entries: ReportEntry[];
  entry: ReportEntry | null;
}

const props = defineProps<Props>();

const layout = getBookSummaryDetailLayout();
const detailTransition = getBookDetailTransition();
const hasEntries = computed(() => props.entries.length > 0);
const fullscreenOpen = ref(false);

const canDownload = computed(() => {
  if (!props.entry) return false;
  const code = props.entry.contentJson?.["code"];
  return (typeof code === "string" && code.trim().length > 0) || Boolean(props.entry.fileUrl);
});

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim() || "download";
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function downloadEntry(entry: ReportEntry) {
  const baseName = sanitizeFilename(entry.title ?? "diagram");

  const code = entry.contentJson?.["code"];
  if (typeof code === "string" && code.trim()) {
    const blob = new Blob([code], { type: "text/plain" });
    triggerDownload(URL.createObjectURL(blob), `${baseName}.mmd`);
    return;
  }

  if (entry.fileUrl) {
    try {
      const res = await fetch(entry.fileUrl);
      const text = await res.text();
      const blob = new Blob([text], { type: "text/markdown" });
      triggerDownload(URL.createObjectURL(blob), `${baseName}.md`);
    } catch {
      // silent fail
    }
    return;
  }
}

function openFullscreen() {
  if (!props.entry) {
    return;
  }

  fullscreenOpen.value = true;
}

function closeFullscreen() {
  fullscreenOpen.value = false;
}
</script>

<template>
  <section :class="layout.shellClass">
    <div :class="layout.detailPaneClass">
      <div v-if="entry" class="absolute right-4 top-4 z-10 flex gap-2">
        <button
          v-if="canDownload"
          type="button"
          aria-label="下载"
          class="rounded-md border border-[#d8cfbe] bg-[#fbf6ed]/92 px-2 py-2 text-[#5d4f3d] transition-colors duration-100 hover:bg-[#f1e7d8]"
          @click="downloadEntry(entry)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="2" x2="8" y2="11" />
            <polyline points="4,7 8,11 12,7" />
            <line x1="2" y1="14" x2="14" y2="14" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="全屏阅读"
          class="rounded-md border border-[#d8cfbe] bg-[#fbf6ed]/92 px-2 py-2 text-[#5d4f3d] transition-colors duration-100 hover:bg-[#f1e7d8]"
          @click="openFullscreen"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="5,1 1,1 1,5" />
            <polyline points="11,1 15,1 15,5" />
            <polyline points="5,15 1,15 1,11" />
            <polyline points="11,15 15,15 15,11" />
          </svg>
        </button>
      </div>

      <Transition :name="layout.detailTransitionName" mode="out-in">
        <ReportDetailPanel
          v-if="entry"
          :key="entry.id"
          :notebook-id="notebookId"
          :entry="entry"
        />
        <div v-else key="empty" class="flex h-full items-center justify-center px-6 text-base leading-7 text-[#8a7864]">
          <template v-if="hasEntries">
            先从右侧历史版本里选择一份阅读产出。
          </template>
          <template v-else>
            暂无阅读产出。上传书籍后可直接在右侧生成。
          </template>
        </div>
      </Transition>
    </div>
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-opacity duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="fullscreenOpen && entry" class="fixed inset-0 z-50 bg-black/45" @click.self="closeFullscreen">
          <div class="flex h-full w-full flex-col bg-[#f8f3ea] text-[#2f271f]">
            <div class="flex items-center justify-between border-b border-[#d8cfbe] bg-[#fbf6ed] px-6 py-4">
              <div class="min-w-0">
                <h2 class="truncate text-[1.1rem] leading-tight text-[#34281d]" style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;">
                  {{ entry.title || '未命名阅读产出' }}
                </h2>
                <p class="mt-1 text-sm text-[#8a7864]">全屏阅读模式</p>
              </div>
              <button
                type="button"
                class="rounded-md border border-[#d8cfbe] bg-[#fffaf2] px-3 py-2 text-sm text-[#5d4f3d] transition-colors duration-100 hover:bg-[#f1e7d8]"
                @click="closeFullscreen"
              >
                关闭
              </button>
            </div>

            <div :class="entry?.contentJson?.kind === 'mermaid_mindmap' ? 'min-h-0 flex-1 overflow-y-auto' : 'min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8'">
              <ReportDetailPanel :notebook-id="notebookId" :entry="entry" :compact="entry?.contentJson?.kind === 'mermaid_mindmap'" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.folio-note-enter-active {
  transition: opacity v-bind('`${detailTransition.durationEnterMs}ms`') ease-out,
    transform v-bind('`${detailTransition.durationEnterMs}ms`') ease-out;
}

.folio-note-leave-active {
  transition: opacity v-bind('`${detailTransition.durationLeaveMs}ms`') ease-in,
    transform v-bind('`${detailTransition.durationLeaveMs}ms`') ease-in;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.folio-note-enter-from {
  opacity: 0;
  transform: translate3d(v-bind('`${detailTransition.enterX}px`'), v-bind('`${detailTransition.enterY}px`'), 0);
}

.folio-note-leave-to {
  opacity: 0;
  transform: translate3d(v-bind('`${detailTransition.leaveX}px`'), 0, 0);
}
</style>
