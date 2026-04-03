<script setup lang="ts">
interface Props {
  title: string;
  onShare: () => void;
  onMore: () => void;
}

defineProps<Props>();
</script>

<template>
  <header class="h-14 border-b border-gray-200 bg-white px-4 sm:px-6 flex items-center justify-between">
    <div class="min-w-0">
      <h1 class="text-base sm:text-lg font-semibold text-gray-900 truncate">{{ title }}</h1>
    </div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
        @click="onShare"
      >
        分享
      </button>
      <button
        type="button"
        class="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
        @click="onMore"
      >
        更多
      </button>
    </div>
  </header>
</template>
