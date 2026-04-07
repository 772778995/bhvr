<script setup lang="ts">
import type { NotebookReport, ResearchState } from "@/api/notebooks";

interface Props {
  researchState: ResearchState;
  report: NotebookReport | null;
  /** True when there are Q&A messages that can be compiled into a report. */
  hasResearchAssets: boolean;
  onStartResearch: () => void;
  onGenerateReport: () => void;
}

const props = defineProps<Props>();

const STATUS_LABEL: Record<ResearchState["status"], string> = {
  idle: "空闲",
  running: "研究进行中…",
  failed: "出现错误",
  completed: "已完成",
};

const STEP_LABEL: Record<ResearchState["step"], string> = {
  idle: "",
  starting: "正在启动",
  generating_question: "生成研究问题",
  waiting_answer: "等待 NotebookLM 回答",
  refreshing_messages: "同步消息",
  completed: "全部完成",
  failed: "已中止",
};

function statusLabel(state: ResearchState): string {
  return STATUS_LABEL[state.status] ?? state.status;
}

function stepLabel(state: ResearchState): string {
  return STEP_LABEL[state.step] ?? state.step;
}

function isRunning(state: ResearchState): boolean {
  return state.status === "running";
}

function progressPercent(state: ResearchState): number {
  if (state.targetCount <= 0) return 0;
  return Math.min(100, Math.round((state.completedCount / state.targetCount) * 100));
}
</script>

<template>
  <section class="h-full min-h-0 bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-4 overflow-hidden">
    <!-- 自动课题研究控制区 -->
    <div class="flex flex-col gap-3 shrink-0">
      <h2 class="text-base font-semibold text-gray-900">自动课题研究</h2>

      <!-- 运行状态展示 -->
      <div class="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
        <!-- Status row -->
        <div class="flex items-center justify-between">
          <span class="text-gray-500">状态</span>
          <span
            :class="{
              'text-blue-600 font-medium': isRunning(researchState),
              'text-green-600 font-medium': researchState.status === 'completed',
              'text-red-600 font-medium': researchState.status === 'failed',
              'text-gray-600': researchState.status === 'idle',
            }"
          >
            {{ statusLabel(researchState) }}
          </span>
        </div>

        <!-- Step row (only while running or just finished) -->
        <div
          v-if="researchState.status === 'running' || (researchState.status === 'completed' && researchState.step !== 'idle')"
          class="flex items-center justify-between"
        >
          <span class="text-gray-500">步骤</span>
          <span class="text-gray-600">{{ stepLabel(researchState) }}</span>
        </div>

        <!-- Progress row -->
        <div
          v-if="researchState.targetCount > 0"
          class="flex items-center justify-between"
        >
          <span class="text-gray-500">进度</span>
          <span>{{ researchState.completedCount }} / {{ researchState.targetCount }} 轮</span>
        </div>

        <!-- Progress bar -->
        <div
          v-if="researchState.targetCount > 0"
          class="h-1.5 rounded-full bg-gray-200 overflow-hidden"
        >
          <div
            class="h-full rounded-full bg-blue-500 transition-all duration-300 ease-out"
            :style="{ width: `${progressPercent(researchState)}%` }"
          />
        </div>

        <!-- Error message -->
        <p
          v-if="researchState.lastError"
          class="text-sm text-red-600"
        >
          {{ researchState.lastError }}
        </p>
      </div>

      <!-- 操作按钮 -->
      <button
        type="button"
        :disabled="isRunning(researchState)"
        class="w-full rounded-md bg-[#3a2e20] px-3 py-2.5 text-base text-[#f5ede0] transition-all duration-100 hover:bg-[#2a201a] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        @click="props.onStartResearch()"
      >
        {{ isRunning(researchState) ? "研究进行中…" : "开始自动研究" }}
      </button>

      <button
        type="button"
        :disabled="isRunning(researchState) || !hasResearchAssets"
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
