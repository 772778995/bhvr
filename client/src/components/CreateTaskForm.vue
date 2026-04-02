<script setup lang="ts">
import { ref } from "vue";
import { api } from "@/api/client";

const emit = defineEmits<{
  created: [id: string];
}>();

const notebookUrl = ref("");
const topic = ref("");
const numQuestions = ref(10);
const loading = ref(false);
const error = ref("");

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    const res = await api.createResearch({
      notebookUrl: notebookUrl.value,
      topic: topic.value || undefined,
      numQuestions: numQuestions.value,
    });
    notebookUrl.value = "";
    topic.value = "";
    numQuestions.value = 10;
    emit("created", res.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "提交失败";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form
    @submit.prevent="handleSubmit"
    class="bg-white rounded-lg border border-gray-200 p-6 space-y-4"
  >
    <h2 class="text-lg font-semibold text-gray-900">创建研究任务</h2>

    <div v-if="error" class="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
      {{ error }}
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">
        NotebookLM 链接 <span class="text-red-500">*</span>
      </label>
      <input
        v-model="notebookUrl"
        type="url"
        required
        placeholder="https://notebooklm.google.com/notebook/..."
        class="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">
        研究主题（可选）
      </label>
      <input
        v-model="topic"
        type="text"
        placeholder="例如：量子计算的最新进展"
        class="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">
        问题数量
      </label>
      <input
        v-model.number="numQuestions"
        type="number"
        min="1"
        max="100"
        class="w-32 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>

    <button
      type="submit"
      :disabled="loading"
      class="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {{ loading ? "提交中..." : "开始研究" }}
    </button>
  </form>
</template>
