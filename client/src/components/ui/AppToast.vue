<script setup lang="ts">
import { useToast } from "@/composables/useToast";

const { current, dismissToast, pauseHide, resumeHide } = useToast();
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-3 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 -translate-y-2 scale-95"
    >
      <div
        v-if="current"
        :key="current.id"
        class="fixed top-4 left-1/2 z-50 -translate-x-1/2 max-w-[480px] w-[calc(100%-2rem)] shadow-lg cursor-pointer select-none"
        :class="
          current.type === 'error'
            ? 'border border-[#c98e7e] bg-[#f4ddd6] text-[#7b3328]'
            : 'border border-[#d7c29a] bg-[#f5ead1] text-[#745a21]'
        "
        @mouseenter="pauseHide"
        @mouseleave="resumeHide"
        @click="dismissToast"
      >
        <div class="flex items-start gap-3 px-4 py-3">
          <span class="mt-0.5 shrink-0 text-base leading-none">
            {{ current.type === "error" ? "✕" : "ℹ" }}
          </span>
          <p class="flex-1 text-base leading-relaxed">{{ current.message }}</p>
          <button
            type="button"
            class="shrink-0 text-base leading-none opacity-50 hover:opacity-100 transition-opacity"
            aria-label="关闭"
            @click.stop="dismissToast"
          >
            ✕
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
