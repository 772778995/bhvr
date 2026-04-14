<script setup lang="ts">
import { computed } from "vue";
import type { ResearchState } from "@/api/notebooks";
import {
  getQuickReadActionLabel,
  getResearchPrimaryActionLabel,
  getResearchProgressCopy,
  getResearchRoundsCopy,
  getResearchStatusCopy,
  type ResearchActionPendingState,
} from "./book-actions";

interface Props {
  researchState: ResearchState;
  answeredRounds: number;
  hasBook: boolean;
  canQuickRead: boolean;
  busy?: boolean;
  quickReadLoading?: boolean;
  researchActionPending?: ResearchActionPendingState;
  onToggleResearch: () => void | Promise<void>;
  onQuickRead: () => void | Promise<void>;
}

const props = defineProps<Props>();

const actionLabel = computed(() => getResearchPrimaryActionLabel(props.researchState, props.researchActionPending ?? null));
const quickReadLabel = computed(() => getQuickReadActionLabel(Boolean(props.quickReadLoading)));
const roundsCopy = computed(() => getResearchRoundsCopy(props.answeredRounds));
const progressCopy = computed(() => getResearchProgressCopy(props.researchState));
const statusCopy = computed(() => getResearchStatusCopy(props.researchState));
const running = computed(() => props.researchState.status === "running");
const researchPending = computed(() => props.researchActionPending === "starting" || props.researchActionPending === "stopping");
const disabled = computed(() => !props.hasBook || Boolean(props.busy) || researchPending.value);
const quickReadDisabled = computed(() => !props.hasBook || !props.canQuickRead || Boolean(props.busy) || Boolean(props.quickReadLoading));
</script>

<template>
  <section class="flex h-full min-h-0 flex-col border border-[#d8cfbe] bg-[#f3ecdf]">
    <div class="min-h-0 flex flex-1 flex-col px-5 py-5">
      <section class="border border-[#d4c6b1] bg-[#fbf6ed] px-4 py-4">
        <div class="flex items-start justify-between gap-4">
          <div class="text-[1.05rem] leading-tight text-[#34281d]" style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;">
            自动研究
          </div>

          <span
            class="shrink-0 border px-2.5 py-1 text-xs uppercase tracking-[0.14em]"
            :class="running ? 'border-[#c8b290] bg-[#efe1c5] text-[#5b482c]' : 'border-[#d6cab8] bg-[#f7f1e5] text-[#7d6d59]'"
          >
            {{ running ? '运行中' : '待启动' }}
          </span>
        </div>

        <p class="mt-4 text-base leading-7 text-[#5d4f3d]">
          {{ statusCopy }}
        </p>

        <p class="mt-3 text-sm leading-6 text-[#8a7864]">
          {{ roundsCopy }}
        </p>

        <p v-if="progressCopy" class="mt-1 text-sm leading-6 tracking-[0.08em] text-[#6f604f]">
          {{ progressCopy }}
        </p>

        <button
          type="button"
          class="mt-5 inline-flex w-full items-center justify-center gap-2 border px-4 py-3 text-base transition-all duration-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          :class="running
            ? 'border-[#b98c7d] bg-[#f1e3de] text-[#7d3427] hover:bg-[#ead7d1]'
            : 'border-[#bdaa8c] bg-[#f2e6d3] text-[#47392b] hover:bg-[#e8d9c2]'"
          :disabled="disabled"
          @click="onToggleResearch"
        >
          <svg
            v-if="researchPending"
            class="animate-spin"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.4" stroke-dasharray="38 14" stroke-linecap="round" />
          </svg>
          {{ actionLabel }}
        </button>

        <p v-if="!hasBook" class="mt-3 text-sm leading-6 text-[#8a7864]">
          先在左侧上传一本书，自动研究才能开始。
        </p>
      </section>

      <section class="mt-auto pt-6">
        <button
          type="button"
          class="inline-flex w-full items-center justify-center border border-[#cab79c] bg-[#fbf5ea] px-4 py-3 text-base text-[#4b3e2f] transition-all duration-100 hover:bg-[#f3ead8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="quickReadDisabled"
          @click="onQuickRead"
        >
          {{ quickReadLabel }}
        </button>

        <p v-if="hasBook && !canQuickRead" class="mt-3 text-sm leading-6 text-[#8a7864]">
          先完成至少一轮自动研究，或等待研究历史加载出来，再整理书籍总结。
        </p>
      </section>
    </div>
  </section>
</template>
