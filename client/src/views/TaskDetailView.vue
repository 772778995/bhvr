<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, type TaskDetail, type TaskStatus } from "@/api/client";
import { statusLabels, statusColors } from "@/utils/status";
import { formatTime } from "@/utils/format";

const route = useRoute();
const router = useRouter();

const taskId = computed(() => route.params.id as string);
const task = ref<TaskDetail | null>(null);
const status = ref<TaskStatus | null>(null);
const loading = ref(true);
const error = ref("");
const expandedQuestions = ref<Set<number>>(new Set());

let pollTimer: ReturnType<typeof setInterval> | null = null;

const isInProgress = computed(() => {
  const s = status.value?.status ?? task.value?.status;
  return s && s !== "done" && s !== "error";
});

const progress = computed(() => {
  const t = status.value ?? task.value;
  if (!t || t.numQuestions === 0) return 0;
  return Math.round((t.completedQuestions / t.numQuestions) * 100);
});

const renderedReport = computed(() => {
  if (!task.value?.report) return "";
  return DOMPurify.sanitize(marked(task.value.report) as string);
});

async function fetchFullDetail() {
  try {
    task.value = await api.getTask(taskId.value);
    error.value = "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function pollStatus() {
  try {
    status.value = await api.getTaskStatus(taskId.value);
    // When done or error, fetch full detail and stop polling
    if (status.value.status === "done" || status.value.status === "error") {
      await fetchFullDetail();
      stopPolling();
    }
  } catch {
    // ignore poll errors
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollStatus, 3000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function toggleQuestion(index: number) {
  if (expandedQuestions.value.has(index)) {
    expandedQuestions.value.delete(index);
  } else {
    expandedQuestions.value.add(index);
  }
}

onMounted(async () => {
  await fetchFullDetail();
  if (isInProgress.value) {
    startPolling();
  }
});

watch(isInProgress, (val) => {
  if (val) startPolling();
  else stopPolling();
});

onUnmounted(() => {
  stopPolling();
});
</script>

<template>
  <div>
    <!-- Back button -->
    <button
      @click="router.push('/')"
      class="text-sm text-blue-600 hover:text-blue-800 mb-4 inline-flex items-center gap-1"
    >
      &larr; 返回列表
    </button>

    <div v-if="loading" class="text-sm text-gray-500">加载中...</div>

    <div
      v-else-if="error"
      class="text-sm text-red-600 bg-red-50 rounded px-3 py-2"
    >
      {{ error }}
    </div>

    <template v-else-if="task">
      <!-- Header -->
      <div class="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h1 class="text-xl font-semibold text-gray-900">
          {{ task.topic || "未命名研究" }}
        </h1>
        <p class="text-sm text-gray-500 mt-1 break-all">{{ task.notebookUrl }}</p>

        <div class="mt-4 flex items-center gap-4 text-sm">
          <span
            class="px-2 py-0.5 rounded-full text-xs font-medium"
            :class="statusColors[task.status]"
          >
            {{ statusLabels[task.status] || task.status }}
          </span>
          <span class="text-gray-500">创建于 {{ formatTime(task.createdAt) }}</span>
          <span v-if="task.completedAt" class="text-gray-500">
            完成于 {{ formatTime(task.completedAt) }}
          </span>
        </div>

        <!-- Progress -->
        <div v-if="task.status !== 'pending'" class="mt-4">
          <div class="flex justify-between text-xs text-gray-500 mb-1">
            <span>进度</span>
            <span>
              {{ (status ?? task).completedQuestions }} / {{ (status ?? task).numQuestions }}
            </span>
          </div>
          <div class="w-full bg-gray-100 rounded-full h-2">
            <div
              class="bg-blue-600 h-2 rounded-full transition-all duration-300"
              :style="{ width: `${progress}%` }"
            />
          </div>
        </div>

        <p v-if="task.errorMessage" class="mt-3 text-sm text-red-600">
          {{ task.errorMessage }}
        </p>
      </div>

      <!-- Questions -->
      <div
        v-if="task.questions.length > 0"
        class="bg-white rounded-lg border border-gray-200 mb-6"
      >
        <h2 class="text-base font-semibold text-gray-900 px-6 py-4 border-b border-gray-100">
          研究问题（{{ task.questions.length }}）
        </h2>
        <div class="divide-y divide-gray-100">
          <div
            v-for="(q, i) in task.questions"
            :key="q.id"
          >
            <button
              @click="toggleQuestion(i)"
              class="w-full text-left px-6 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors"
            >
              <span class="text-xs font-mono text-gray-400 mt-0.5 shrink-0">
                {{ String(q.orderNum).padStart(2, "0") }}
              </span>
              <span class="text-sm text-gray-800 flex-1">{{ q.questionText }}</span>
              <span
                class="text-xs shrink-0 mt-0.5"
                :class="{
                  'text-green-600': q.status === 'done',
                  'text-blue-600': q.status === 'asking',
                  'text-gray-400': q.status === 'pending',
                  'text-red-600': q.status === 'error',
                }"
              >
                {{ q.status === 'done' ? '已回答' : q.status === 'asking' ? '提问中...' : q.status === 'error' ? '出错' : '等待中' }}
              </span>
              <svg
                class="w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform"
                :class="{ 'rotate-180': expandedQuestions.has(i) }"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div
              v-if="expandedQuestions.has(i) && q.answerText"
              class="px-6 pb-4 pl-14"
            >
              <div class="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded p-3">
                {{ q.answerText }}
              </div>
            </div>
            <div
              v-if="expandedQuestions.has(i) && q.errorMessage"
              class="px-6 pb-4 pl-14"
            >
              <p class="text-sm text-red-600">{{ q.errorMessage }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Report -->
      <div
        v-if="task.report"
        class="bg-white rounded-lg border border-gray-200 p-6"
      >
        <h2 class="text-base font-semibold text-gray-900 mb-4">研究报告</h2>
        <div
          class="prose prose-sm max-w-none text-gray-800"
          v-html="renderedReport"
        />
      </div>
    </template>
  </div>
</template>
