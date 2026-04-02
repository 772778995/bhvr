<script setup lang="ts">
import type { ResearchEntry, StudioTool } from "@/api/notebooks";

interface Props {
  tools: StudioTool[];
  researchEntry: ResearchEntry | null;
  onOpenTool: (tool: StudioTool) => void;
  onOpenResearch: () => void;
}

defineProps<Props>();
</script>

<template>
  <section class="h-full bg-white border border-gray-200 rounded-lg p-4 flex flex-col">
    <h2 class="text-sm font-semibold text-gray-900 mb-3">Studio</h2>

    <div v-if="tools.length === 0" class="text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded-md p-4">
      暂无可用工具。
    </div>

    <div v-else class="grid grid-cols-2 gap-2 mb-4">
      <button
        v-for="tool in tools"
        :key="tool.id"
        type="button"
        class="text-left border border-gray-200 rounded-md p-2 hover:bg-gray-50"
        @click="onOpenTool(tool)"
      >
        <p class="text-sm font-medium text-gray-900">{{ tool.name }}</p>
        <p class="text-xs text-gray-500 mt-1">{{ tool.description }}</p>
      </button>
    </div>

    <div class="text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded-md p-4 mb-4">
      产出区将显示工具生成的内容。
    </div>

    <button
      type="button"
      class="mt-auto w-full px-3 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
      @click="onOpenResearch"
    >
      {{ researchEntry?.name ?? "自动课题研究" }}
    </button>
  </section>
</template>
