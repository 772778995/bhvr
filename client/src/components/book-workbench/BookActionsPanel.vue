<script setup lang="ts">
import { computed } from "vue";
import type { ReportEntry } from "@/api/notebooks";
import { getBookActionLabel } from "./book-actions";

interface Props {
  hasBook: boolean;
  busy?: boolean;
  quickReadLoading?: boolean;
  deepReadingLoading?: boolean;
  historyEntries: ReportEntry[];
  selectedEntryId?: string | null;
  onQuickRead: () => void | Promise<void>;
  onDeepReading: () => void | Promise<void>;
  onSelectEntry: (entryId: string) => void;
}

const props = defineProps<Props>();

const quickReadLabel = computed(() => getBookActionLabel("quick-read", Boolean(props.quickReadLoading)));
const deepReadingLabel = computed(() => getBookActionLabel("deep-reading", Boolean(props.deepReadingLoading)));
const actionBusy = computed(() => Boolean(props.quickReadLoading) || Boolean(props.deepReadingLoading));
const quickReadDisabled = computed(() => !props.hasBook || Boolean(props.busy) || actionBusy.value);
const deepReadingDisabled = computed(() => !props.hasBook || Boolean(props.busy) || actionBusy.value);
const hasHistory = computed(() => props.historyEntries.length > 0);

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
</script>

<template>
  <section class="flex h-full min-h-0 flex-col border border-[#d8cfbe] bg-[#f3ecdf]">
    <div class="min-h-0 flex flex-1 flex-col px-5 py-5">
      <section class="min-h-0 flex flex-1 flex-col overflow-hidden border-b border-[#d4c6b1] pb-5">
        <div class="text-[1.05rem] leading-tight text-[#34281d]" style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;">
          历史版本
        </div>
        <div v-if="hasHistory" class="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 space-y-2">
          <button
            v-for="entry in historyEntries"
            :key="entry.id"
            type="button"
            class="w-full border px-3 py-3 text-left transition-colors duration-100"
            :class="selectedEntryId === entry.id
              ? 'border-[#3a2e20] bg-[#efe1c5] text-[#2f271f]'
              : 'border-[#d7ccb8] bg-[#fffaf1] text-[#5d4f3d] hover:border-[#c7b89d] hover:bg-[#f4ecd9]'"
            @click="onSelectEntry(entry.id)"
          >
            <p class="text-base leading-6 font-medium">{{ entry.title || '未命名总结' }}</p>
            <p class="mt-2 text-sm leading-6 text-[#8a7864]">{{ formatTime(entry.updatedAt) }}</p>
          </button>
        </div>
        <div v-else class="mt-4 flex flex-1 items-center border border-dashed border-[#d7ccb8] bg-[#fbf6ed] px-4 text-base leading-7 text-[#8a7864]">
          暂无书籍总结。生成后会在这里按时间沉淀版本记录。
        </div>
      </section>

      <section class="mt-auto border-t border-[#d4c6b1] pt-4">
        <div class="text-[1.05rem] leading-tight text-[#34281d]" style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;">
          阅读操作
        </div>
        <p class="mt-3 text-base leading-7 text-[#5d4f3d]">
          直接基于当前上传书籍生成不同密度的阅读结果，不再依赖额外问答历史。
        </p>
        <button
          type="button"
          class="mt-5 inline-flex w-full items-center justify-center border border-[#cab79c] bg-[#fbf5ea] px-4 py-3 text-base text-[#4b3e2f] transition-all duration-100 hover:bg-[#f3ead8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="quickReadDisabled"
          @click="onQuickRead"
        >
          {{ quickReadLabel }}
        </button>

        <button
          type="button"
          class="mt-3 inline-flex w-full items-center justify-center border border-[#cab79c] bg-[#efe5d2] px-4 py-3 text-base text-[#4b3e2f] transition-all duration-100 hover:bg-[#e7dcc8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="deepReadingDisabled"
          @click="onDeepReading"
        >
          {{ deepReadingLabel }}
        </button>

        <p v-if="!hasBook" class="mt-3 text-sm leading-6 text-[#8a7864]">
          先在左侧上传一本书，再开始快速读书。
        </p>
      </section>
    </div>
  </section>
</template>
