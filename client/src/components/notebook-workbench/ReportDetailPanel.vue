<script setup lang="ts">
import { computed } from "vue";
import type { NotebookReport } from "@/api/notebooks";
import { renderMarkdown } from "@/utils/markdown";

interface Props {
  report: NotebookReport;
  onBack: () => void;
}

const props = defineProps<Props>();

const renderedHtml = computed(() => {
  if (!props.report.content) return "";
  return renderMarkdown(props.report.content);
});

function downloadMarkdown() {
  const content = props.report.content ?? "";
  const filename = (props.report.title || "report") + ".md";
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatTime(raw: string | null): string {
  if (!raw) return "";
  try {
    return new Date(raw).toLocaleString("zh-CN", {
      year: "numeric",
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
  <section class="h-full min-h-0 flex flex-col overflow-hidden bg-[#f8f3ea] border border-[#d8cfbe] rounded-lg">
    <!-- Toolbar -->
    <div class="shrink-0 px-4 py-3 border-b border-[#e0d5c0] flex items-center gap-3">
      <!-- Back button -->
      <button
        type="button"
        class="flex items-center gap-1 rounded px-2 py-1 text-sm text-[#6a5b49] transition-all duration-100 hover:bg-[#efe7d7] active:scale-95"
        @click="onBack"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="10 3 5 8 10 13" />
        </svg>
        <span>返回列表</span>
      </button>

      <div class="flex-1" />

      <!-- Download button -->
      <button
        type="button"
        class="flex items-center gap-1 rounded px-2 py-1 text-sm text-[#6a5b49] transition-all duration-100 hover:bg-[#efe7d7] active:scale-95"
        @click="downloadMarkdown"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 10 8 14 12 10" />
          <line x1="8" y1="2" x2="8" y2="14" />
        </svg>
        <span>下载 .md</span>
      </button>
    </div>

    <!-- Report title & metadata -->
    <div class="shrink-0 px-5 pt-4 pb-2">
      <h2
        class="text-lg font-semibold text-[#2f271f] leading-snug"
        style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
      >
        {{ report.title || "未命名报告" }}
      </h2>
      <p v-if="report.generatedAt" class="mt-1 text-xs text-[#9a8a78]">
        生成于 {{ formatTime(report.generatedAt) }}
      </p>
    </div>

    <!-- Markdown content -->
    <div class="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
      <div
        v-if="report.content"
        class="prose-warm"
        v-html="renderedHtml"
      />
      <p v-else class="text-base text-[#9a8a78] leading-relaxed">
        报告内容为空。
      </p>
    </div>
  </section>
</template>
