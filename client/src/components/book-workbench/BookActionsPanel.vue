<script setup lang="ts">
import { computed } from "vue";
import type { ReportEntry } from "@/api/notebooks";
import { getBookActionLabel } from "./book-actions";

interface Props {
  hasBook: boolean;
  busy?: boolean;
  quickReadLoading?: boolean;
  deepReadingLoading?: boolean;
  mindmapLoading?: boolean;
  historyEntries: ReportEntry[];
  selectedEntryId?: string | null;
  onQuickRead: () => void | Promise<void>;
  onConfigureQuickRead: () => void | Promise<void>;
  onDeepReading: () => void | Promise<void>;
  onConfigureDeepReading: () => void | Promise<void>;
  onMindmap: () => void | Promise<void>;
  onSelectEntry: (entryId: string) => void;
  onDeleteHistoryEntry: (entryId: string) => void | Promise<void>;
}

const props = defineProps<Props>();

const quickReadLabel = computed(() => getBookActionLabel("quick-read", Boolean(props.quickReadLoading)));
const deepReadingLabel = computed(() => getBookActionLabel("deep-reading", Boolean(props.deepReadingLoading)));
const mindmapLabel = computed(() => getBookActionLabel("mindmap", Boolean(props.mindmapLoading)));
const actionBusy = computed(() => Boolean(props.quickReadLoading) || Boolean(props.deepReadingLoading) || Boolean(props.mindmapLoading));
const quickReadDisabled = computed(() => !props.hasBook || Boolean(props.busy) || actionBusy.value);
const deepReadingDisabled = computed(() => !props.hasBook || Boolean(props.busy) || actionBusy.value);
const mindmapDisabled = computed(() => !props.hasBook || Boolean(props.busy) || actionBusy.value);
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
          <div
            v-for="entry in historyEntries"
            :key="entry.id"
            class="relative"
          >
            <button
              type="button"
              class="w-full border px-3 py-3 pr-12 text-left transition-colors duration-100"
              :class="selectedEntryId === entry.id
                ? 'border-[#3a2e20] bg-[#efe1c5] text-[#2f271f]'
                : 'border-[#d7ccb8] bg-[#fffaf1] text-[#5d4f3d] hover:border-[#c7b89d] hover:bg-[#f4ecd9]'"
              @click="onSelectEntry(entry.id)"
            >
              <p class="text-base leading-6 font-medium">{{ entry.title || '未命名阅读产出' }}</p>
              <p class="mt-2 text-sm leading-6 text-[#8a7864]">{{ formatTime(entry.updatedAt) }}</p>
            </button>
            <button
              type="button"
              class="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center text-[#8a7864] transition-all duration-100 hover:bg-[#eadfc9] hover:text-[#4b3e2f] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="Boolean(busy)"
              aria-label="删除阅读产出"
              @click.stop="onDeleteHistoryEntry(entry.id)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                <path d="M4 4l8 8" />
                <path d="M12 4 4 12" />
              </svg>
            </button>
          </div>
        </div>
        <div v-else class="mt-4 flex flex-1 items-center border border-dashed border-[#d7ccb8] bg-[#fbf6ed] px-4 text-base leading-7 text-[#8a7864]">
          暂无阅读产出。生成后会在这里按时间沉淀版本记录。
        </div>
      </section>

      <section class="mt-auto border-t border-[#d4c6b1] pt-4">
        <div class="text-[1.05rem] leading-tight text-[#34281d]" style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;">
          阅读操作
        </div>
        <p class="mt-3 text-base leading-7 text-[#5d4f3d]">
          直接基于当前上传书籍生成书籍简述、详细解读或书籍导图。
        </p>
        <div class="mt-5 flex items-stretch gap-2">
          <button
            type="button"
            class="inline-flex flex-1 items-center justify-center border border-[#cab79c] bg-[#fbf5ea] px-4 py-3 text-base text-[#4b3e2f] transition-all duration-100 hover:bg-[#f3ead8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="quickReadDisabled"
            @click="onQuickRead"
          >
            {{ quickReadLabel }}
          </button>
          <button
            type="button"
            class="inline-flex items-center justify-center border border-[#cab79c] bg-[#fbf5ea] px-3 text-[#5d4f3d] transition-all duration-100 hover:bg-[#f3ead8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="Boolean(busy) || Boolean(quickReadLoading)"
            aria-label="配置书籍简述提示词"
            @click="onConfigureQuickRead"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="1.75" />
              <path d="M8 2.25v1.1" />
              <path d="M8 12.65v1.1" />
              <path d="M13.75 8h-1.1" />
              <path d="M3.35 8h-1.1" />
              <path d="m12.07 3.93-.78.78" />
              <path d="m4.71 11.29-.78.78" />
              <path d="m12.07 12.07-.78-.78" />
              <path d="m4.71 4.71-.78-.78" />
            </svg>
          </button>
        </div>

        <div class="mt-3 flex items-stretch gap-2">
          <button
            type="button"
            class="inline-flex flex-1 items-center justify-center border border-[#cab79c] bg-[#efe5d2] px-4 py-3 text-base text-[#4b3e2f] transition-all duration-100 hover:bg-[#e7dcc8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="deepReadingDisabled"
            @click="onDeepReading"
          >
            {{ deepReadingLabel }}
          </button>
          <button
            type="button"
            class="inline-flex items-center justify-center border border-[#cab79c] bg-[#efe5d2] px-3 text-[#5d4f3d] transition-all duration-100 hover:bg-[#e7dcc8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="Boolean(busy) || Boolean(deepReadingLoading)"
            aria-label="配置详细解读提示词"
            @click="onConfigureDeepReading"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="1.75" />
              <path d="M8 2.25v1.1" />
              <path d="M8 12.65v1.1" />
              <path d="M13.75 8h-1.1" />
              <path d="M3.35 8h-1.1" />
              <path d="m12.07 3.93-.78.78" />
              <path d="m4.71 11.29-.78.78" />
              <path d="m12.07 12.07-.78-.78" />
              <path d="m4.71 4.71-.78-.78" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          class="mt-3 inline-flex w-full items-center justify-center border border-[#cab79c] bg-[#e8dfcf] px-4 py-3 text-base text-[#4b3e2f] transition-all duration-100 hover:bg-[#ddd2c0] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="mindmapDisabled"
          @click="onMindmap"
        >
          {{ mindmapLabel }}
        </button>

        <p v-if="!hasBook" class="mt-3 text-sm leading-6 text-[#8a7864]">
          先在左侧上传一本书，再生成书籍简述、详细解读或书籍导图。
        </p>
      </section>
    </div>
  </section>
</template>
