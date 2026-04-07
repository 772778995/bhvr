<script setup lang="ts">
import type { Source } from "@/api/notebooks";
import { iconForSourceType } from "@/utils/source-icons";

interface Props {
  sources: Source[];
  onAddSource: () => void;
}

defineProps<Props>();

function canOpen(source: Source): boolean {
  return source.type === "web" && Boolean(source.url);
}
</script>

<template>
  <section class="h-full min-h-0 bg-white border border-gray-200 rounded-lg p-4 flex flex-col overflow-hidden">
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

    <ul v-else class="space-y-2 overflow-y-auto min-h-0 flex-1 pr-1">
      <li
        v-for="source in sources"
        :key="source.id"
        class="border border-gray-200 rounded-md p-3"
      >
        <div class="flex items-start gap-2">
          <span class="text-sm text-gray-500 mt-0.5">{{ iconForSourceType(source.type) }}</span>

          <div class="flex-1 min-w-0">
            <a
              v-if="canOpen(source)"
              :href="source.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-sm font-medium text-blue-700 hover:underline truncate block"
            >
              {{ source.title }}
            </a>
            <p v-else class="text-sm font-medium text-gray-900 truncate">{{ source.title }}</p>
            <p class="text-xs text-gray-500 mt-1">{{ source.type }} · {{ source.status }}</p>
          </div>

        </div>
      </li>
    </ul>
  </section>
</template>
