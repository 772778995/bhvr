<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { formatTime } from "@/utils/format";
import { createNotebookListViewModel } from "./notebook-list-view";

const router = useRouter();
const { notebooks, loading, error, openNotebook } = createNotebookListViewModel({
  navigate: (path) => {
    void router.push(path);
  },
  onMounted,
});
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold text-gray-900">我的 Notebooks</h1>
      <p class="text-sm text-gray-500 mt-1">选择一个 Notebook 进入工作台。</p>
    </div>

    <div v-if="loading" class="text-sm text-gray-500">加载中...</div>

    <div
      v-else-if="error"
      class="text-sm text-red-600 bg-red-50 rounded px-3 py-2"
    >
      {{ error }}
    </div>

    <div
      v-else-if="notebooks.length === 0"
      class="bg-white rounded-lg border border-gray-200 p-6 text-sm text-gray-500"
    >
      暂无 Notebook。
    </div>

    <div v-else class="space-y-3">
      <button
        v-for="notebook in notebooks"
        :key="notebook.id"
        type="button"
        class="w-full text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
        @click="openNotebook(notebook.id)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-gray-900 truncate">
              {{ notebook.title }}
            </p>
            <p
              v-if="notebook.description.trim()"
              class="mt-1 text-sm text-gray-500 line-clamp-2"
            >
              {{ notebook.description }}
            </p>
          </div>
          <span class="shrink-0 text-xs text-gray-400">
            {{ formatTime(notebook.updatedAt) }}
          </span>
        </div>
      </button>
    </div>
  </div>
</template>
