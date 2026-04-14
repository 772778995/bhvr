<script setup lang="ts">
import { computed } from "vue";
import { notebooksApi, type ReportEntry } from "@/api/notebooks";
import {
  downloadBookSummaryEntry,
  getBookSummaryDownloadButtonClass,
  shouldShowBookSummaryDownload,
} from "./book-summary-list";

interface Props {
  entries: ReportEntry[];
  selectedEntryId?: string | null;
  onSelect: (entryId: string) => void;
}

const props = defineProps<Props>();

const isEmpty = computed(() => props.entries.length === 0);

function formatTime(raw: string): string {
  try {
    return new Date(raw).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return raw;
  }
}

async function onDownload(entry: ReportEntry): Promise<void> {
  if (!shouldShowBookSummaryDownload(entry)) {
    return;
  }

  await downloadBookSummaryEntry(entry, notebooksApi.fetchEntryContent);
}
</script>

<template>
  <aside class="flex h-full min-h-0 w-68 min-w-0 shrink-0 flex-col border-r border-[#ded4c2] bg-[#f7f0e3]">
    <div v-if="isEmpty" class="flex-1 px-4 py-6 text-sm leading-6 text-[#8a7864]">
      暂无书籍总结。先在右侧生成一份，再回到这里查看历史版本。
    </div>

    <ul v-else class="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-2">
      <li v-for="entry in entries" :key="entry.id">
        <div
          class="flex items-start gap-2 border px-3 py-3 transition-colors duration-100"
          :class="selectedEntryId === entry.id
            ? 'border-[#3a2e20] bg-[#efe1c5] text-[#2f271f]'
            : 'border-[#d7ccb8] bg-[#fffaf1] text-[#5d4f3d] hover:border-[#c7b89d] hover:bg-[#f4ecd9]'"
        >
          <button
            type="button"
            class="min-w-0 flex-1 text-left"
            @click="onSelect(entry.id)"
          >
            <p class="text-base leading-6 font-medium">
              {{ entry.title || '未命名总结' }}
            </p>
            <p class="mt-2 text-sm leading-6 text-[#8a7864]">
              {{ formatTime(entry.updatedAt) }}
            </p>
          </button>

          <button
            type="button"
            :disabled="!shouldShowBookSummaryDownload(entry)"
            :class="getBookSummaryDownloadButtonClass(!shouldShowBookSummaryDownload(entry))"
            aria-label="下载书籍总结 markdown"
            title="下载 markdown"
            @click="onDownload(entry)"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="4 10 8 14 12 10" />
              <line x1="8" y1="2" x2="8" y2="14" />
            </svg>
          </button>
        </div>
      </li>
    </ul>
  </aside>
</template>
