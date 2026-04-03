<script setup lang="ts">
import type { Source } from "@/api/notebooks";

interface Props {
  sources: Source[];
  onAddSource: () => void;
}

defineProps<Props>();
</script>

<template>
  <section class="h-full bg-white border border-gray-200 rounded-lg p-4 flex flex-col">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold text-gray-900">来源</h2>
      <button
        type="button"
        class="px-2.5 py-1 text-xs rounded-md bg-gray-900 text-white hover:bg-gray-800"
        @click="onAddSource"
      >
        添加
      </button>
    </div>

    <div class="mb-3">
      <input
        type="text"
        readonly
        value="搜索来源（即将支持）"
        class="w-full text-xs rounded-md border border-gray-300 px-2.5 py-2 text-gray-500 bg-gray-50"
      />
    </div>

    <div class="mb-3 rounded-md border border-gray-200 bg-gray-50 p-2.5">
      <p class="text-xs font-medium text-gray-700">筛选条件</p>
      <p class="text-xs text-gray-500 mt-1">按来源类型与状态筛选（即将支持）</p>
    </div>

    <div v-if="sources.length === 0" class="text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded-md p-4">
      暂无来源，请添加后开始对话。
    </div>

    <ul v-else class="space-y-2 overflow-auto pr-1">
      <li
        v-for="source in sources"
        :key="source.id"
        class="border border-gray-200 rounded-md p-3"
      >
        <p class="text-sm font-medium text-gray-900">{{ source.title }}</p>
        <p class="text-xs text-gray-500 mt-1">{{ source.type }} · {{ source.status }}</p>
        <p class="text-xs text-gray-600 mt-2 line-clamp-2">{{ source.summary }}</p>
      </li>
    </ul>
  </section>
</template>
