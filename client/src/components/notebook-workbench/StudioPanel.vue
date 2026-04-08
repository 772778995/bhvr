<script setup lang="ts">
import { computed } from "vue";
import type { NotebookReport, ResearchState } from "@/api/notebooks";

interface Props {
  researchState: ResearchState;
  report: NotebookReport | null;
  /** True when there are Q&A messages that can be compiled into a report. */
  hasResearchAssets: boolean;
  /** Current number of conversation turns (Q&A pairs). */
  messageCount: number;
  onStartResearch: () => void;
  onGenerateReport: () => void;
}

const props = defineProps<Props>();

const running = computed(() => props.researchState.status === "running");

const toggleOn = computed(() => running.value);

function handleToggle() {
  props.onStartResearch();
}

const countLabel = computed(() => {
  const turns = Math.floor(props.messageCount / 2);
  if (turns <= 0 && !running.value) return "暂无问答数据";
  if (running.value) {
    return `已追加 ${turns} 轮问答${props.researchState.step === "waiting_answer" ? "，正在等待回答…" : ""}`;
  }
  return `共 ${turns} 轮问答`;
});
</script>

<template>
  <section class="h-full min-h-0 bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-4 overflow-hidden">
    <!-- 自动课题研究控制区 -->
    <div class="flex flex-col gap-3 shrink-0">
      <!-- 标题行：标题 + toggle -->
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-gray-900">自动课题研究</h2>

        <!-- Toggle switch -->
        <button
          type="button"
          role="switch"
          :aria-checked="toggleOn"
          class="relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3a2e20]/40 focus-visible:ring-offset-1"
          :class="toggleOn ? 'bg-[#3a2e20]' : 'bg-gray-300'"
          @click="handleToggle"
        >
          <span
            class="pointer-events-none inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow ring-0 transition-transform duration-150 ease-in-out"
            :class="toggleOn ? 'translate-x-4.5' : 'translate-x-0'"
          />
        </button>
      </div>

      <!-- 问答数据计数 -->
      <p class="text-sm text-gray-500">{{ countLabel }}</p>

      <!-- 错误提示 -->
      <p
        v-if="researchState.lastError"
        class="text-sm text-red-600 leading-relaxed"
      >
        {{ researchState.lastError }}
      </p>

      <!-- 生成研究报告按钮 -->
      <button
        type="button"
        :disabled="running || !hasResearchAssets"
        class="w-full rounded-md border border-[#c8b89a] bg-[#fbf7ef] px-3 py-2.5 text-base text-[#564738] transition-all duration-100 hover:bg-[#f1e8d8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        @click="props.onGenerateReport()"
      >
        生成研究报告
      </button>
    </div>

    <!-- 报告预览 -->
    <div v-if="report" class="flex flex-col gap-2 min-h-0 flex-1">
      <hr class="border-gray-100 shrink-0" />
      <h3 class="shrink-0 text-base font-semibold text-gray-900">报告预览</h3>
      <div class="flex-1 min-h-0 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
        {{ report.content }}
      </div>
      <p class="shrink-0 text-sm text-gray-400">
        生成于 {{ report.generatedAt }}
      </p>
    </div>

    <div
      v-else
      class="flex flex-1 items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-center text-base leading-relaxed text-gray-500"
    >
      暂无报告，完成研究后点击"生成研究报告"。
    </div>
  </section>
</template>
