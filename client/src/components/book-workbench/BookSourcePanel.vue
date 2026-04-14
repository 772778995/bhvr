<script setup lang="ts">
import type { Source } from "@/api/notebooks";
import { getBookSourcePanelLayout } from "./book-layout";

interface Props {
  book: Source | null;
  busy: boolean;
  progressMessage: string;
  onUpload: () => void;
  onReplace: () => void;
  onDelete?: (sourceId: string) => void;
}

defineProps<Props>();

const emptyLayout = getBookSourcePanelLayout(false);
const loadedLayout = getBookSourcePanelLayout(true);

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ready: "已就绪",
    processing: "处理中",
    failed: "处理失败",
  };
  return map[status] ?? status;
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col border border-[#d8cfbe] bg-[#f8f3ea]">
    <div class="border-b border-[#e0d5c3] px-5 py-4">
      <div class="text-[1.2rem] leading-tight text-[#2f271f]" style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;">
        书籍
      </div>
    </div>

    <div :class="emptyLayout.bodyClass">
      <div
        v-if="!book"
        :class="emptyLayout.contentClass"
      >
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="border border-[#d6c9b4] bg-[#fffbf4] px-4 py-4 text-base leading-7 text-[#605341]">
            上传一本书后，这里会保留当前正在阅读的 PDF 来源。
          </div>

          <div :class="emptyLayout.footerClass">
            <button
              type="button"
              class="mt-3 w-full border border-[#bfa98a] bg-[#efe2cd] px-4 py-3 text-base text-[#433527] transition-colors duration-100 hover:bg-[#e7d6bc] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="busy"
              @click="onUpload"
            >
              上传书籍
            </button>
          </div>
        </div>
      </div>

      <article
        v-else
        :class="[
          loadedLayout.contentClass,
          'border border-[#d6c9b4] bg-[#fffbf4]',
          book.status === 'processing' ? 'opacity-88' : '',
        ]"
      >
        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 text-[#8a7a64]">
                <span class="border border-[#d2c3ab] bg-[#f4ebdd] px-2 py-0.5 text-xs uppercase tracking-[0.16em] text-[#6e5f4e]">PDF</span>
                <span class="text-sm">{{ statusLabel(book.status) }}</span>
              </div>

              <h3
                class="mt-3 truncate text-[1.2rem] leading-7 text-[#2f261a]"
                style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;"
                :title="book.title"
              >
                {{ book.title }}
              </h3>

              <p class="mt-3 text-base leading-7 text-[#605341]">
                <template v-if="book.status === 'processing'">
                  {{ progressMessage || '书籍正在处理中，请稍候。' }}
                </template>
                <template v-else-if="book.status === 'failed'">
                  这本书处理失败了。可以删除后重新上传更干净的 PDF。
                </template>
              </p>
            </div>

            <div v-if="book.status === 'processing'" class="mt-1 shrink-0 text-[#8b7d67]">
              <svg class="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.6" stroke-dasharray="50 14" stroke-linecap="round" />
              </svg>
            </div>
          </div>

          <div class="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              class="border border-[#c5b69f] bg-[#f1e7d7] px-3.5 py-2 text-base text-[#4b3d2e] transition-colors duration-100 hover:bg-[#e6d8c0] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="busy"
              @click="onReplace"
            >
              替换书籍
            </button>
            <button
              type="button"
              class="border border-[#d0b0a2] bg-[#f7e5df] px-3.5 py-2 text-base text-[#8a3f31] transition-colors duration-100 hover:bg-[#f0d7cf] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="busy"
              @click="book && onDelete ? onDelete(book.id) : undefined"
            >
              删除书籍
            </button>
          </div>
        </div>
      </article>

    </div>
  </section>
</template>
