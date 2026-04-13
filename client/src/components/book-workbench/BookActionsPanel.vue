<script setup lang="ts">
import { computed } from "vue";
import type { ResearchState } from "@/api/notebooks";
import { getQuickReadActionLabel, getResearchPrimaryActionLabel, getResearchStatusCopy } from "./book-actions";

interface Props {
  researchState: ResearchState;
  hasBook: boolean;
  canQuickRead: boolean;
  busy?: boolean;
  quickReadLoading?: boolean;
  onToggleResearch: () => void | Promise<void>;
  onQuickRead: () => void | Promise<void>;
}

const props = defineProps<Props>();

const actionLabel = computed(() => getResearchPrimaryActionLabel(props.researchState));
const quickReadLabel = computed(() => getQuickReadActionLabel(Boolean(props.quickReadLoading)));
const statusCopy = computed(() => getResearchStatusCopy(props.researchState));
const running = computed(() => props.researchState.status === "running");
const disabled = computed(() => !props.hasBook || Boolean(props.busy));
const quickReadDisabled = computed(() => !props.hasBook || !props.canQuickRead || Boolean(props.busy) || Boolean(props.quickReadLoading));
</script>

<template>
  <section class="flex h-full min-h-0 flex-col border border-[#d8cfbe] bg-[#f3ecdf]">
    <div class="border-b border-[#ddd1bf] px-5 py-4">
      <p class="text-xs uppercase tracking-[0.22em] text-[#8c7a66]">Reading Tools</p>
      <h2
        class="mt-2 text-[1.45rem] leading-tight text-[#30261c]"
        style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;"
      >
        自动研究
      </h2>
      <p class="mt-3 text-sm leading-6 text-[#665746]">
        围绕当前书籍自动生成研究问题，并逐步整理回答脉络。
      </p>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <section class="border border-[#d4c6b1] bg-[#fbf6ed] px-4 py-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm uppercase tracking-[0.14em] text-[#8f7d69]">Research Loop</p>
            <h3
              class="mt-2 text-[1.15rem] leading-tight text-[#34281d]"
              style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;"
            >
              围绕当前书籍自动提问
            </h3>
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

        <button
          type="button"
          class="mt-5 inline-flex items-center justify-center border px-4 py-2 text-base transition-all duration-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          :class="running ? 'border-[#b36b59] bg-[#ead1ca] text-[#7d3427] hover:bg-[#e3c2b9]' : 'border-[#3a2e20] bg-[#3a2e20] text-[#f8f3ea] hover:bg-[#2d2319]'"
          :disabled="disabled"
          @click="onToggleResearch"
        >
          {{ actionLabel }}
        </button>

        <p v-if="!hasBook" class="mt-3 text-sm leading-6 text-[#8a7864]">
          先在左侧上传一本书，自动研究才能开始。
        </p>
      </section>

      <section class="mt-5 border border-dashed border-[#ccbda5] bg-[#f7f0e3] px-4 py-4">
        <p class="text-sm uppercase tracking-[0.14em] text-[#91806d]">Quick Read</p>
        <h3
          class="mt-2 text-[1.1rem] leading-tight text-[#34281d]"
          style="font-family: Georgia, 'Times New Roman', 'Noto Serif SC', serif;"
        >
          一键生成书籍总结
        </h3>
        <p class="mt-3 text-base leading-7 text-[#655746]">
          自动整理这本书的结构、核心观点和延展阅读，生成一份适合快速通览的总结。
        </p>

        <button
          type="button"
          class="mt-5 inline-flex items-center justify-center border border-[#3a2e20] bg-[#3a2e20] px-4 py-2 text-base text-[#f8f3ea] transition-all duration-100 hover:bg-[#2d2319] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
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
