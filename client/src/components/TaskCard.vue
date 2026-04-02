<script setup lang="ts">
import { computed } from "vue";
import type { ResearchTask } from "@/api/client";
import { statusLabels, statusColors } from "@/utils/status";
import { formatTime } from "@/utils/format";

const props = defineProps<{
  task: ResearchTask;
}>();

const progress = computed(() =>
  props.task.numQuestions > 0
    ? Math.round((props.task.completedQuestions / props.task.numQuestions) * 100)
    : 0,
);
</script>

<template>
  <router-link
    :to="`/task/${task.id}`"
    class="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-gray-900 truncate">
          {{ task.topic || task.notebookUrl }}
        </p>
        <p v-if="task.topic" class="text-xs text-gray-500 truncate mt-0.5">
          {{ task.notebookUrl }}
        </p>
      </div>
      <span
        :class="statusColors[task.status]"
        class="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full"
      >
        {{ statusLabels[task.status] }}
      </span>
    </div>

    <!-- Progress bar -->
    <div v-if="task.status !== 'pending' && task.status !== 'error'" class="mt-3">
      <div class="flex justify-between text-xs text-gray-500 mb-1">
        <span>进度</span>
        <span>{{ task.completedQuestions }} / {{ task.numQuestions }}</span>
      </div>
      <div class="w-full bg-gray-100 rounded-full h-1.5">
        <div
          class="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
          :style="{ width: `${progress}%` }"
        />
      </div>
    </div>

    <p v-if="task.errorMessage" class="mt-2 text-xs text-red-600 truncate">
      {{ task.errorMessage }}
    </p>

    <p class="mt-2 text-xs text-gray-400">
      {{ formatTime(task.createdAt) }}
    </p>
  </router-link>
</template>
