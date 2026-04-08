<script setup lang="ts">
import type { NotebookReport } from "@/api/notebooks";

interface Props {
  reports: NotebookReport[];
  onSelect: (reportId: string) => void;
  onDelete: (reportId: string) => void;
}

defineProps<Props>();

function summarize(content: string | null, maxLen = 100): string {
  if (!content) return "（无内容）";
  const plain = content.replace(/[#*`>\-\[\]()!|]/g, "").trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
}

function formatTime(raw: string | null): string {
  if (!raw) return "未知时间";
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
  <section class="h-full min-h-0 flex flex-col overflow-hidden bg-[#f8f3ea] border border-[#d8cfbe] rounded-lg">
    <!-- Header -->
    <div class="shrink-0 px-5 pt-4 pb-3 border-b border-[#e0d5c0]">
      <h2
        class="text-lg font-semibold text-[#2f271f]"
        style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
      >
        研究报告
      </h2>
    </div>

    <!-- Empty state -->
    <div
      v-if="reports.length === 0"
      class="flex-1 flex items-center justify-center px-6"
    >
      <p class="text-base leading-relaxed text-[#9a8a78] text-center">
        暂无报告。完成研究后，在右侧点击「生成研究报告」。
      </p>
    </div>

    <!-- Report card list -->
    <TransitionGroup
      v-else
      tag="ul"
      class="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5"
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
    >
      <li
        v-for="report in reports"
        :key="report.id"
        class="group relative rounded-md border border-[#ddd3c2] bg-[#fffbf4] px-4 py-3 cursor-pointer transition-all duration-100 hover:border-[#c4b89a] hover:bg-[#f5eed8]"
        @click="onSelect(report.id)"
      >
        <!-- Title row -->
        <div class="flex items-start justify-between gap-2">
          <h3
            class="text-base font-medium text-[#2f271f] leading-snug truncate flex-1"
            style="font-family: 'Noto Serif SC', 'Source Han Serif SC', serif"
          >
            {{ report.title || "未命名报告" }}
          </h3>

          <!-- Delete button -->
          <button
            type="button"
            class="shrink-0 opacity-0 group-hover:opacity-100 rounded p-1 text-[#9a8a78] transition-all duration-100 hover:text-[#b33c2a] hover:bg-[#f4ddd6]"
            title="删除报告"
            @click.stop="onDelete(report.id)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        <!-- Summary -->
        <p class="mt-1.5 text-sm leading-relaxed text-[#6f6354] line-clamp-2">
          {{ summarize(report.content) }}
        </p>

        <!-- Time -->
        <p class="mt-1.5 text-xs text-[#9a8a78]">
          {{ formatTime(report.generatedAt) }}
        </p>
      </li>
    </TransitionGroup>
  </section>
</template>
