<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { api, type AuthStatus, type ResearchTask } from "@/api/client";
import CreateTaskForm from "@/components/CreateTaskForm.vue";
import TaskCard from "@/components/TaskCard.vue";

const router = useRouter();
const tasks = ref<ResearchTask[]>([]);
const authStatus = ref<AuthStatus | null>(null);
const loading = ref(true);
const error = ref("");

let refreshTimer: ReturnType<typeof setInterval> | null = null;

async function fetchTasks() {
  try {
    const [taskList, currentAuthStatus] = await Promise.all([
      api.listTasks(),
      api.getAuthStatus().catch(() => null),
    ]);

    tasks.value = taskList;
    authStatus.value = currentAuthStatus;
    error.value = "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function authBannerVariant(status: AuthStatus | null): "info" | "warn" | "error" | null {
  if (!status) return null;
  if (status.status === "refreshing") return "info";
  if (status.status === "missing" || status.status === "expired") return "warn";
  if (status.status === "reauth_required" || status.status === "error") return "error";
  return null;
}

function authBannerMessage(status: AuthStatus | null): string {
  if (!status) return "";

  switch (status.status) {
    case "refreshing":
      return "NotebookLM 认证正在后台刷新。";
    case "missing":
      return "尚未初始化 NotebookLM 登录，请先运行 npx notebooklm login。";
    case "expired":
      return "NotebookLM 会话已过期，系统将在请求时尝试恢复。";
    case "reauth_required":
      return status.error ?? "NotebookLM 认证需要重新登录。";
    case "error":
      return status.error ?? "NotebookLM 认证状态异常。";
    default:
      return "";
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
    <div class="space-y-4">
      <div
        v-if="authBannerVariant(authStatus)"
        :class="[
          'rounded-lg border px-4 py-3 text-sm',
          authBannerVariant(authStatus) === 'info' && 'border-blue-200 bg-blue-50 text-blue-700',
          authBannerVariant(authStatus) === 'warn' && 'border-amber-200 bg-amber-50 text-amber-800',
          authBannerVariant(authStatus) === 'error' && 'border-red-200 bg-red-50 text-red-700',
        ]"
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{{ authBannerMessage(authStatus) }}</span>
          <router-link
            to="/settings/accounts"
            :class="[
              'text-sm underline underline-offset-2 transition-colors',
              authStatus?.status !== 'ready'
                ? 'text-amber-700'
                : 'text-[#2c2c2c] opacity-60',
            ]"
          >
            管理账号
          </router-link>
        </div>
      </div>

      <CreateTaskForm @created="onTaskCreated" />
    </div>

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
