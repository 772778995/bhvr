<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import type { LoaderEntry } from "@/composables/useGlobalLoader";

const props = defineProps<{
  visible: boolean;
  title: string;
  entries: LoaderEntry[];
}>();

const logEl = ref<HTMLElement | null>(null);

watch(
  () => props.entries,
  () => {
    nextTick(() => {
      logEl.value?.scrollTo({ top: logEl.value.scrollHeight, behavior: "smooth" });
    });
  },
  { deep: true }
);

function formatTime(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

const entryColor: Record<string, string> = {
  info: "#2f271f",
  success: "#2d6a2d",
  warning: "#7a5a00",
  error: "#7b3328",
};
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        style="background: rgba(32,24,18,0.75)"
      >
        <div
          class="rounded-xl shadow-xl max-w-[480px] w-[calc(100%-2rem)] px-6 py-5"
          style="background: #f5ead1; border: 1px solid #d7c29a"
        >
          <!-- Title row -->
          <div class="flex items-center gap-3">
            <svg class="animate-spin shrink-0" :width="24" :height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#d7c29a" stroke-width="3"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="#7a6a56" stroke-width="3" stroke-linecap="round"/>
            </svg>
            <span class="font-semibold text-base" style="color: #2f271f">{{ title }}</span>
          </div>

          <!-- Progress log -->
          <div
            v-if="entries.length > 0"
            ref="logEl"
            class="mt-4 max-h-60 overflow-y-auto space-y-1"
          >
            <div
              v-for="entry in entries"
              :key="entry.id"
              class="flex items-start gap-2 text-sm leading-relaxed"
            >
              <span class="text-xs font-mono shrink-0 mt-0.5" style="color: #7a6a56">
                {{ formatTime(entry.timestamp) }}
              </span>
              <span :style="{ color: entryColor[entry.type] ?? '#2f271f' }">
                {{ entry.message }}
              </span>
            </div>
          </div>

          <!-- Footer hint -->
          <p class="text-sm text-center mt-3" style="color: #7a6a56">请勿关闭或刷新页面</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
