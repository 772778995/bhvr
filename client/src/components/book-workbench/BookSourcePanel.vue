<script setup lang="ts">
import type { Source } from "@/api/notebooks";

interface Props {
  book: Source | null;
  busy: boolean;
  progressMessage: string;
  onUpload: () => void;
  onReplace: () => void;
  onDelete?: (sourceId: string) => void;
}

defineProps<Props>();

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
      <p class="text-xs uppercase tracking-[0.22em] text-[#8d7d67]">Book Archive</p>
      <div class="mt-2 flex items-end justify-between gap-4">
        <div>
          <h2
            class="text-[1.45rem] leading-tight text-[#2f271f]"
            style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;"
          >
            当前书籍
          </h2>
          <p class="mt-2 text-sm leading-6 text-[#6a5b49]">
            单书模式下，这里只保留一本通过 PDF 上传的书。
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 border border-[#3a2e20] bg-[#3a2e20] px-3.5 py-2 text-base text-[#f8f3ea] transition-all duration-100 hover:bg-[#2d2319] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="busy || Boolean(book)"
          @click="onUpload"
        >
          上传 PDF
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <div
        v-if="!book"
        class="border border-dashed border-[#c9bca5] bg-[#fdf9f1] px-5 py-6"
      >
        <p class="text-sm uppercase tracking-[0.18em] text-[#9d8c74]">No Book Yet</p>
        <h3
          class="mt-3 text-[1.25rem] leading-tight text-[#34281d]"
          style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;"
        >
          先上传一本书，再开始阅读
        </h3>
        <p class="mt-3 text-base leading-8 text-[#5f513f]">
          仅支持 PDF 上传。处理完成后，这本书会成为当前工作台的唯一书籍来源。
        </p>
        <button
          type="button"
          class="mt-5 border border-[#bda986] bg-[#efe3cc] px-4 py-2 text-base text-[#4d3f2d] transition-colors duration-100 hover:bg-[#e7d8bd] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="busy"
          @click="onUpload"
        >
          选择书籍 PDF
        </button>
      </div>

      <article
        v-else
        class="border border-[#d6c9b4] bg-[#fffbf4] px-4 py-4"
        :class="book.status === 'processing' ? 'opacity-88' : ''"
      >
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
              <template v-else>
                书籍已接入当前工作台，后续阅读和研究都将围绕这一本书展开。
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
      </article>
    </div>
  </section>
</template>
