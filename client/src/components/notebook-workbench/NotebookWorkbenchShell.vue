<script setup lang="ts">
import { ref, watch } from "vue";
import NotebookTopBar from "@/components/notebook-workbench/NotebookTopBar.vue";
import ResizeDivider from "@/components/notebook-workbench/ResizeDivider.vue";

interface Props {
  title: string;
  loading: boolean;
  error: string;
  hasData: boolean;
  emptyMessage?: string;
  leftStorageKey?: string;
  rightStorageKey?: string;
  leftMin?: number;
  leftMax?: number;
  leftInitial?: number;
  rightMin?: number;
  rightMax?: number;
  rightInitial?: number;
  centerMin?: number;
  onShare?: () => void;
  onMore?: () => void;
}

const props = withDefaults(defineProps<Props>(), {
  emptyMessage: "当前工作台暂无可展示数据。",
  leftStorageKey: "workbench-left-width",
  rightStorageKey: "workbench-right-width",
  leftMin: 200,
  leftMax: 480,
  leftInitial: 280,
  rightMin: 280,
  rightMax: 560,
  rightInitial: 340,
  centerMin: 320,
});

function clampWidth(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readStoredWidth(key: string, fallback: number, min: number, max: number) {
  const stored = Number(localStorage.getItem(key));
  const width = Number.isFinite(stored) && stored > 0 ? stored : fallback;
  return clampWidth(width, min, max);
}

const leftWidth = ref(readStoredWidth(props.leftStorageKey, props.leftInitial, props.leftMin, props.leftMax));
const rightWidth = ref(readStoredWidth(props.rightStorageKey, props.rightInitial, props.rightMin, props.rightMax));

watch(
  () => [
    props.leftStorageKey,
    props.rightStorageKey,
    props.leftInitial,
    props.rightInitial,
    props.leftMin,
    props.leftMax,
    props.rightMin,
    props.rightMax,
  ] as const,
  ([leftKey, rightKey, leftInitial, rightInitial, leftMin, leftMax, rightMin, rightMax]) => {
    leftWidth.value = readStoredWidth(leftKey, leftInitial, leftMin, leftMax);
    rightWidth.value = readStoredWidth(rightKey, rightInitial, rightMin, rightMax);
  },
);

watch([leftWidth, rightWidth], ([nextLeftWidth, nextRightWidth]) => {
  localStorage.setItem(props.leftStorageKey, nextLeftWidth.toString());
  localStorage.setItem(props.rightStorageKey, nextRightWidth.toString());
});

function onLeftDrag(delta: number) {
  leftWidth.value = Math.min(props.leftMax, Math.max(props.leftMin, leftWidth.value + delta));
}

function onRightDrag(delta: number) {
  rightWidth.value = Math.min(props.rightMax, Math.max(props.rightMin, rightWidth.value - delta));
}
</script>

<template>
  <div class="h-full overflow-hidden bg-[#e9dfcf] text-[#2f271f]">
    <slot name="toast" />
    <slot name="loader" />

    <div class="h-full bg-[linear-gradient(180deg,_rgba(248,242,231,0.98),_rgba(237,228,212,0.98))]">
      <div v-if="loading" class="flex h-full items-center justify-center text-base text-[#6f6354]">
        正在加载工作台...
      </div>

      <div v-else-if="error" class="flex h-full items-center justify-center p-6">
        <div class="w-full max-w-lg border border-[#c98e7e] bg-[#f4ddd6] p-4 text-base leading-relaxed text-[#7b3328]">
          {{ error }}
        </div>
      </div>

      <div v-else-if="!hasData" class="flex h-full items-center justify-center p-6">
        <div class="w-full max-w-lg border border-[#d8cfbe] bg-[#f8f3ea] p-6 text-center text-base leading-relaxed text-[#716452]">
          {{ emptyMessage }}
        </div>
      </div>

      <div v-else class="flex h-full flex-col overflow-hidden">
        <NotebookTopBar :title="title" :on-share="props.onShare" :on-more="props.onMore" />

        <div class="min-h-0 flex-1 overflow-hidden p-3 sm:p-4 lg:p-5">
          <div class="flex h-full min-h-0 gap-0">
            <div class="min-w-0 shrink-0 flex flex-col" :style="{ width: `${leftWidth}px` }">
              <slot name="left" />
            </div>

            <ResizeDivider @drag="onLeftDrag" />

            <div class="min-w-0 flex-1 flex flex-col" :style="{ minWidth: `${props.centerMin}px` }">
              <slot name="center" />
            </div>

            <ResizeDivider @drag="onRightDrag" />

            <div class="min-w-0 shrink-0 flex flex-col" :style="{ width: `${rightWidth}px` }">
              <slot name="right" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <slot name="dialogs" />
  </div>
</template>
