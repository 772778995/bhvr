<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { api, type ResearchTask } from "@/api/client";
import CreateTaskForm from "@/components/CreateTaskForm.vue";
import TaskCard from "@/components/TaskCard.vue";

const router = useRouter();
const tasks = ref<ResearchTask[]>([]);
const loading = ref(true);
const error = ref("");

let refreshTimer: ReturnType<typeof setInterval> | null = null;

async function fetchTasks() {
  try {
    tasks.value = await api.listTasks();
    error.value = "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function onTaskCreated(id: string) {
  // Navigate to detail page or refresh list
  router.push(`/task/${id}`);
}

onMounted(() => {
  fetchTasks();
  // Auto-refresh every 5 seconds
  refreshTimer = setInterval(fetchTasks, 5000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <div class="space-y-6">
    <CreateTaskForm @created="onTaskCreated" />

    <div>
      <h2 class="text-lg font-semibold text-gray-900 mb-3">研究任务</h2>

      <div v-if="loading" class="text-sm text-gray-500">加载中...</div>

      <div
        v-else-if="error"
        class="text-sm text-red-600 bg-red-50 rounded px-3 py-2"
      >
        {{ error }}
      </div>

      <div v-else-if="tasks.length === 0" class="text-sm text-gray-500">
        暂无任务，请在上方创建。
      </div>

      <div v-else class="space-y-3">
        <TaskCard v-for="task in tasks" :key="task.id" :task="task" />
      </div>
    </div>
  </div>
</template>
