<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import ConfirmDialog from "@/components/ui/ConfirmDialog.vue";
import { api, type AuthStatus } from "@/api/client";
import { formatTime } from "@/utils/format";
import { notebooksApi } from "@/api/notebooks";
import { createNotebookListViewModel, createNotebookWorkbenchPath } from "./notebook-list-view";
import { getNotebookListMaxWidth } from "./front-layout";

const router = useRouter();
const {
  notebooks,
  loading,
  error,
  actionError,
  pendingDeleteNotebook,
  deletingNotebookId,
  openNotebook,
  requestDeleteNotebook,
  cancelDeleteNotebook,
  confirmDeleteNotebook,
} = createNotebookListViewModel({
  onMounted,
  navigate: (path: string) => {
    void router.push(path);
  },
});

// 新建笔记本状态
const showCreateModal = ref(false);
const createTitle = ref("");
const creating = ref(false);
const createError = ref("");
const authStatus = ref<AuthStatus | null>(null);
const authLoading = ref(true);
const authError = ref("");
const loginPending = ref(false);
const authNotice = ref("");
const pageMaxWidth = `${getNotebookListMaxWidth()}px`;

let authRefreshTimer: number | undefined;

const authTone = computed(() => {
  if (!authStatus.value) return null;
  if (authStatus.value.status === "ready") return "ready";
  if (authStatus.value.status === "refreshing") return "info";
  if (["missing", "expired"].includes(authStatus.value.status)) return "warn";
  return "error";
});

const authMessage = computed(() => {
  if (!authStatus.value) return "";

  switch (authStatus.value.status) {
    case "ready":
      return "NotebookLM 已登录，可以直接打开或创建读书笔记。";
    case "refreshing":
      return "NotebookLM 认证正在刷新，请稍候片刻。";
    case "missing":
      return "当前还没有 NotebookLM 登录凭证，可以直接在这里触发交互登录。";
    case "expired":
      return "现有 NotebookLM 会话已过期，可以重新触发交互登录恢复。";
    case "reauth_required":
      return authStatus.value.error ?? "NotebookLM 需要重新登录才能继续使用。";
    case "error":
      return authStatus.value.error ?? "NotebookLM 认证状态异常，可尝试重新登录。";
    default:
      return "";
  }
});

const canTriggerLogin = computed(() => {
  if (!authStatus.value) return false;
  return ["missing", "expired", "reauth_required", "error"].includes(authStatus.value.status);
});

async function loadAuthStatus() {
  try {
    authStatus.value = await api.getAuthStatus();
    authError.value = "";
  } catch (cause) {
    authError.value = cause instanceof Error ? cause.message : "认证状态加载失败";
  } finally {
    authLoading.value = false;
  }
}

async function handleTriggerLogin() {
  if (!authStatus.value || loginPending.value || !canTriggerLogin.value) return;

  loginPending.value = true;
  authNotice.value = "";

  try {
    const result = await api.triggerLogin(authStatus.value.accountId);
    authNotice.value = result.message;
    authError.value = "";
    await loadAuthStatus();
  } catch (cause) {
    authNotice.value = "";
    authError.value = cause instanceof Error ? cause.message : "无法触发登录";
  } finally {
    loginPending.value = false;
  }
}

function openCreateModal() {
  createTitle.value = "";
  createError.value = "";
  showCreateModal.value = true;
}

function closeCreateModal() {
  if (creating.value) return;
  showCreateModal.value = false;
}

async function handleCreate() {
  if (creating.value) return;
  const title = createTitle.value.trim();
  if (!title) {
    createError.value = "请输入笔记本名称";
    return;
  }
  creating.value = true;
  createError.value = "";
  try {
    const notebook = await notebooksApi.createNotebook({ title });
    showCreateModal.value = false;
    void router.push(createNotebookWorkbenchPath(notebook.id));
  } catch (cause) {
    createError.value = cause instanceof Error ? cause.message : "创建失败，请重试";
  } finally {
    creating.value = false;
  }
}

function handleModalKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") closeCreateModal();
}

onMounted(() => {
  void loadAuthStatus();
  authRefreshTimer = window.setInterval(() => {
    void loadAuthStatus();
  }, 5000);
});

onBeforeUnmount(() => {
  if (authRefreshTimer) {
    window.clearInterval(authRefreshTimer);
  }
});
</script>

<template>
  <div>
    <!-- 主页面 -->
    <div class="notebook-home" :style="{ maxWidth: pageMaxWidth }">
      <!-- 页面头部：版心标题区 -->
      <div class="page-header">
        <div class="header-rule-top" />
        <div class="header-content">
          <div>
            <h1 class="page-title">锐捷读书</h1>
            <p class="page-subtitle">在首页直接完成 NotebookLM 登录，然后进入读书工作台。</p>
          </div>
          <div class="header-actions">
            <router-link class="btn-link" to="/settings/accounts">
              账号管理
            </router-link>
            <button class="btn-create" type="button" @click="openCreateModal">
              新建读书笔记
            </button>
          </div>
        </div>
        <div class="header-rule-bottom" />
      </div>

      <!-- 内容区 -->
      <div class="page-body">
        <section
          class="auth-panel"
          :class="[
            authTone === 'ready' && 'auth-panel-ready',
            authTone === 'info' && 'auth-panel-info',
            authTone === 'warn' && 'auth-panel-warn',
            authTone === 'error' && 'auth-panel-error',
          ]"
        >
          <div class="auth-copy">
            <p class="auth-kicker">NotebookLM 认证</p>
            <p v-if="authLoading" class="auth-text">正在检查登录状态...</p>
            <p v-else-if="authMessage" class="auth-text">{{ authMessage }}</p>
            <p v-else class="auth-text">暂时无法获取认证状态，请稍后重试。</p>
            <p v-if="authNotice" class="auth-notice">{{ authNotice }}</p>
            <p v-if="authError" class="auth-error">{{ authError }}</p>
          </div>

          <div class="auth-actions">
            <button
              v-if="canTriggerLogin || loginPending"
              type="button"
              class="btn-auth-primary"
              :disabled="loginPending || authLoading"
              @click="handleTriggerLogin"
            >
              {{ loginPending ? "等待登录..." : "交互登录 NotebookLM" }}
            </button>
            <router-link class="btn-auth-secondary" to="/settings/accounts">
              查看账号状态
            </router-link>
          </div>
        </section>

        <div v-if="actionError" class="state-error state-inline-error">
          <span class="error-mark">✕</span>
          <span>{{ actionError }}</span>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="state-loading">正在加载目录...</div>

        <!-- 错误状态 -->
        <div v-else-if="error" class="state-error">
          <span class="error-mark">✕</span>
          <span>{{ error }}</span>
        </div>

        <!-- 空状态 -->
        <div v-else-if="notebooks.length === 0" class="state-empty">
          <div class="empty-icon">◇</div>
          <p class="empty-title">尚无笔记本</p>
          <p class="empty-hint">点击右上角「新建笔记本」开始你的第一份研究。</p>
        </div>

        <!-- 笔记本列表 -->
        <TransitionGroup v-else class="notebook-list" tag="div" name="list-folio">
          <article
            v-for="notebook in notebooks"
            :key="notebook.id"
            class="notebook-card"
          >
            <div class="card-spine" />
            <button type="button" class="card-body" @click="openNotebook(notebook.id)">
              <div class="card-main">
                <p class="card-title">{{ notebook.title }}</p>
                <p v-if="notebook.description.trim()" class="card-desc">
                  {{ notebook.description }}
                </p>
              </div>
<div class="card-meta">
                <span class="card-time">{{ formatTime(notebook.updatedAt) }}</span>
              </div>
            </button>
<button
              type="button"
              class="card-delete"
              :disabled="deletingNotebookId === notebook.id"
              :aria-label="`删除《${notebook.title}》`"
              @click="requestDeleteNotebook(notebook)"
            >
              <svg
                v-if="deletingNotebookId === notebook.id"
                class="icon-sm"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" fill="none" />
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              <svg
                v-else
                class="icon-sm"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </article>
        </TransitionGroup>
      </div>
    </div>

    <!-- 新建笔记本弹窗 -->
    <Transition name="modal">
      <div
        v-if="showCreateModal"
        class="modal-backdrop"
        @click.self="closeCreateModal"
        @keydown="handleModalKeydown"
      >
        <div class="modal-panel" role="dialog" aria-modal="true" aria-label="新建笔记本">
          <div class="modal-header">
            <h2 class="modal-title">新建笔记本</h2>
            <button
              type="button"
              class="modal-close"
              :disabled="creating"
              @click="closeCreateModal"
            >
              ×
            </button>
          </div>

          <div class="modal-body">
            <label class="field-label" for="notebook-title">名称</label>
            <input
              id="notebook-title"
              v-model="createTitle"
              class="field-input"
              type="text"
              placeholder="为这份研究起一个名字"
              maxlength="120"
              :disabled="creating"
              @keydown.enter="handleCreate"
            />
            <p v-if="createError" class="field-error">{{ createError }}</p>
          </div>

          <div class="modal-footer">
            <button
              type="button"
              class="btn-cancel"
              :disabled="creating"
              @click="closeCreateModal"
            >
              取消
            </button>
            <button
              type="button"
              class="btn-confirm"
              :disabled="creating || !createTitle.trim()"
              @click="handleCreate"
            >
              <span v-if="creating" class="btn-spinner" />
              {{ creating ? "创建中…" : "创建" }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <ConfirmDialog
      :visible="pendingDeleteNotebook !== null"
      title="删除笔记本"
      :message="`确定要删除《${pendingDeleteNotebook?.title ?? ''}》吗？此操作不可撤销。`"
      confirm-text="删除"
      :danger="true"
      @confirm="confirmDeleteNotebook"
      @cancel="cancelDeleteNotebook"
    />
  </div>
</template>

<style scoped>
/* ─── 页面容器 ─────────────────────────────────────── */
.notebook-home {
  margin: 0 auto;
  padding: 0 1.5rem 4rem;
}

/* ─── 页面头部 ─────────────────────────────────────── */
.page-header {
  padding-top: 2.5rem;
  margin-bottom: 2rem;
}

.header-rule-top {
  border-top: 2px solid #2f271f;
  margin-bottom: 0.9rem;
}

.header-content {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #2f271f;
  margin: 0;
  line-height: 1.3;
}

.page-subtitle {
  margin: 0.45rem 0 0;
  font-size: 0.95rem;
  line-height: 1.7;
  color: rgba(47, 39, 31, 0.62);
}

.header-rule-bottom {
  border-top: 1px solid rgba(47, 39, 31, 0.25);
  margin-top: 0.9rem;
}

/* ─── 新建按钮 ─────────────────────────────────────── */
.btn-create {
  flex-shrink: 0;
  padding: 0.45em 1.1em;
  font-size: 0.9rem;
  font-weight: 500;
  background: #2f271f;
  color: #efe5d6;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.1s ease;
  letter-spacing: 0.03em;
}

.btn-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.45em 1.1em;
  font-size: 0.9rem;
  color: #2f271f;
  text-decoration: none;
  border: 1px solid rgba(47, 39, 31, 0.22);
  border-radius: 2px;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.btn-link:hover {
  background: rgba(47, 39, 31, 0.04);
  border-color: rgba(47, 39, 31, 0.42);
}

.btn-create:hover {
  opacity: 0.85;
}

.btn-create:active {
  transform: scale(0.97);
}

.auth-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.1rem;
  margin-bottom: 1rem;
  border: 1px solid rgba(47, 39, 31, 0.18);
  background: rgba(255, 252, 246, 0.82);
}

.auth-panel-ready {
  border-color: rgba(66, 107, 61, 0.28);
  background: rgba(101, 133, 90, 0.08);
}

.auth-panel-info {
  border-color: rgba(61, 94, 132, 0.28);
  background: rgba(97, 125, 153, 0.08);
}

.auth-panel-warn {
  border-color: rgba(164, 117, 39, 0.26);
  background: rgba(182, 144, 72, 0.08);
}

.auth-panel-error {
  border-color: rgba(154, 67, 51, 0.28);
  background: rgba(154, 67, 51, 0.08);
}

.auth-copy {
  min-width: 0;
  flex: 1;
}

.auth-kicker {
  margin: 0 0 0.3rem;
  font-size: 0.78rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(47, 39, 31, 0.46);
}

.auth-text,
.auth-notice,
.auth-error {
  margin: 0;
  font-size: 1rem;
  line-height: 1.7;
}

.auth-notice {
  margin-top: 0.35rem;
  color: #36512f;
}

.auth-error {
  margin-top: 0.35rem;
  color: #8a3020;
}

.auth-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.75rem;
}

.btn-auth-primary,
.btn-auth-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0.55em 1.1em;
  font-size: 0.95rem;
  line-height: 1.4;
  text-decoration: none;
  cursor: pointer;
  transition: opacity 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
}

.btn-auth-primary {
  border: 1px solid #2f271f;
  background: #2f271f;
  color: #efe5d6;
}

.btn-auth-secondary {
  border: 1px solid rgba(47, 39, 31, 0.22);
  background: transparent;
  color: #2f271f;
}

.btn-auth-primary:hover:not(:disabled),
.btn-auth-secondary:hover {
  opacity: 0.86;
}

.btn-auth-primary:active:not(:disabled) {
  transform: scale(0.98);
}

.btn-auth-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ─── 状态占位 ─────────────────────────────────────── */
.state-loading {
  display: flex;
  justify-content: flex-start;
  padding: 2.5rem 0;
}

.state-error {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.8rem 1rem;
  border: 1px solid rgba(180, 50, 30, 0.35);
  background: rgba(180, 50, 30, 0.06);
  color: #7a2010;
  font-size: 0.95rem;
  border-radius: 2px;
}

.state-inline-error {
  margin-bottom: 1rem;
}

.error-mark {
  font-size: 0.8rem;
  opacity: 0.7;
}

.state-empty {
  padding: 3.5rem 0;
  text-align: center;
  color: rgba(47, 39, 31, 0.5);
}

.empty-icon {
  font-size: 2rem;
  margin-bottom: 1rem;
  opacity: 0.4;
}

.empty-title {
  font-size: 1rem;
  font-weight: 600;
  color: rgba(47, 39, 31, 0.6);
  margin: 0 0 0.5rem;
}

.empty-hint {
  font-size: 0.9rem;
  margin: 0;
  line-height: 1.6;
}

/* ─── 笔记本列表 ─────────────────────────────────────── */
.notebook-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.notebook-card {
  display: flex;
  align-items: stretch;
  width: 100%;
  background: transparent;
  border-bottom: 1px solid rgba(47, 39, 31, 0.15);
  padding: 0;
  transition: background-color 0.16s ease, transform 0.14s ease;
}

.notebook-card:first-child {
  border-top: 1px solid rgba(47, 39, 31, 0.15);
}

.notebook-card:hover,
.notebook-card:focus-within {
  background-color: rgba(47, 39, 31, 0.04);
  transform: translateX(3px);
}

.notebook-card:hover .card-arrow,
.notebook-card:focus-within .card-arrow {
  transform: translateX(3px);
}

.card-spine {
  width: 3px;
  background: transparent;
  flex-shrink: 0;
  transition: background-color 0.12s ease;
  border-radius: 0;
}

.notebook-card:hover .card-spine,
.notebook-card:focus-within .card-spine {
  background-color: #2f271f;
}

.card-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1.15rem 1rem 1.15rem 0.95rem;
   min-width: 0;
   text-align: left;
   font: inherit;
   color: inherit;
   background: transparent;
   border: none;
   cursor: pointer;
}

.card-body:focus-visible {
  outline: 2px solid rgba(47, 39, 31, 0.24);
  outline-offset: -2px;
}

.card-main {
  flex: 1;
  min-width: 0;
}

.card-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #2f271f;
  margin: 0;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-desc {
  margin: 0.2em 0 0;
  font-size: 0.95rem;
  color: rgba(47, 39, 31, 0.55);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: rgba(47, 39, 31, 0.4);
}

.card-time {
  font-size: 0.88rem;
}

.card-arrow {
  font-size: 0.95rem;
  transition: transform 0.15s ease;
  color: rgba(47, 39, 31, 0.35);
}

.card-delete {
  align-self: center;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  margin-right: 0.6rem;
  padding: 0;
  color: #8a3020;
  background: transparent;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;
}

.card-delete:hover:not(:disabled),
.card-delete:focus-visible {
  background-color: rgba(122, 32, 16, 0.1);
  color: #b82820;
}

.card-delete:focus-visible {
  outline: none;
}

.card-delete:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.icon-sm {
  width: 0.85rem;
  height: 0.85rem;
}

/* ─── 弹窗 ─────────────────────────────────────── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 15, 8, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1.5rem;
}

.modal-panel {
  background: #efe5d6;
  border: 1px solid rgba(47, 39, 31, 0.2);
  border-radius: 2px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 8px 32px rgba(20, 15, 8, 0.18);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.2rem 1.4rem 0.8rem;
  border-bottom: 1px solid rgba(47, 39, 31, 0.15);
}

.modal-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #2f271f;
  margin: 0;
  letter-spacing: 0.03em;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.4rem;
  line-height: 1;
  color: rgba(47, 39, 31, 0.45);
  cursor: pointer;
  padding: 0 0.1em;
  transition: color 0.12s ease;
}

.modal-close:hover:not(:disabled) {
  color: #2f271f;
}

.modal-close:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.modal-body {
  padding: 1.2rem 1.4rem;
}

.field-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: rgba(47, 39, 31, 0.7);
  margin-bottom: 0.5rem;
  letter-spacing: 0.03em;
}

.field-input {
  width: 100%;
  padding: 0.6em 0.75em;
  font-size: 1rem;
  color: #2f271f;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(47, 39, 31, 0.25);
  border-radius: 2px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
}

.field-input:focus {
  border-color: rgba(47, 39, 31, 0.55);
  box-shadow: 0 0 0 2px rgba(47, 39, 31, 0.08);
}

.field-input:disabled {
  opacity: 0.55;
}

.field-error {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: #7a2010;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.8rem 1.4rem 1.2rem;
  border-top: 1px solid rgba(47, 39, 31, 0.1);
}

.btn-cancel {
  padding: 0.45em 1em;
  font-size: 0.9rem;
  background: transparent;
  color: rgba(47, 39, 31, 0.6);
  border: 1px solid rgba(47, 39, 31, 0.2);
  border-radius: 2px;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.btn-cancel:hover:not(:disabled) {
  border-color: rgba(47, 39, 31, 0.45);
  color: #2f271f;
}

.btn-cancel:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-confirm {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  padding: 0.45em 1.1em;
  font-size: 0.9rem;
  font-weight: 500;
  background: #2f271f;
  color: #efe5d6;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  transition: opacity 0.15s ease;
  letter-spacing: 0.02em;
}

.btn-confirm:hover:not(:disabled) {
  opacity: 0.85;
}

.btn-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1.5px solid rgba(239, 229, 214, 0.4);
  border-top-color: #efe5d6;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ─── 弹窗动画 ─────────────────────────────────────── */
.modal-enter-active {
  transition: opacity 0.18s ease-out;
}
.modal-leave-active {
  transition: opacity 0.14s ease-in;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .modal-panel {
  transition: transform 0.18s ease-out, opacity 0.18s ease-out;
}
.modal-leave-active .modal-panel {
  transition: transform 0.14s ease-in, opacity 0.14s ease-in;
}
.modal-enter-from .modal-panel {
  transform: translateY(-8px) scale(0.98);
  opacity: 0;
}
.modal-leave-to .modal-panel {
  transform: translateY(-4px) scale(0.99);
  opacity: 0;
}

.list-folio-enter-active {
  transition: opacity 180ms ease-out, transform 200ms ease-out;
}

.list-folio-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

@media (min-width: 860px) {
  .page-title {
    font-size: 1.8rem;
  }

  .card-title {
    font-size: 1.12rem;
  }
}

@media (max-width: 760px) {
  .header-content,
  .auth-panel,
  .auth-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .header-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
</style>
