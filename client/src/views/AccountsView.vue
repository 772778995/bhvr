<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api, type AuthStatus } from "@/api/client";
import { formatTime } from "@/utils/format";
import { getAccountsPageMaxWidth } from "./front-layout";

type StatusTone = {
  label: string;
  dotClass: string;
  textClass: string;
};

const accounts = ref<AuthStatus[]>([]);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const deletingAccountId = ref("");
const loginWaitingIds = ref<string[]>([]);

// 上传区状态（每个账号独立）
const uploadInputs = ref<Record<string, string>>({});
const uploadingIds = ref<string[]>([]);
const uploadResults = ref<Record<string, { ok: boolean; message: string; expiresAt?: string }>>({});

let refreshTimer: number | undefined;
let loadingPromise: Promise<void> | null = null;
let latestGeneration = 0;

const statusMap: Record<AuthStatus["status"], StatusTone> = {
  ready: {
    label: "已登录",
    dotClass: "#5b7f52",
    textClass: "#36512f",
  },
  refreshing: {
    label: "刷新中",
    dotClass: "#b48a3a",
    textClass: "#7d5d1f",
  },
  expired: {
    label: "已过期",
    dotClass: "#9a4333",
    textClass: "#7d2a1d",
  },
  reauth_required: {
    label: "已过期",
    dotClass: "#9a4333",
    textClass: "#7d2a1d",
  },
  missing: {
    label: "未登录",
    dotClass: "#8a8172",
    textClass: "#5f584d",
  },
  error: {
    label: "错误",
    dotClass: "#9a4333",
    textClass: "#7d2a1d",
  },
};

const hasAccounts = computed(() => accounts.value.length > 0);
const pageMaxWidth = `${getAccountsPageMaxWidth()}px`;

function isWaitingForLogin(accountId: string) {
  return loginWaitingIds.value.includes(accountId);
}

function canTriggerLogin(status: AuthStatus["status"]) {
  return ["missing", "expired", "reauth_required", "error"].includes(status);
}

function syncLoginWaitingState(nextAccounts: AuthStatus[]) {
  loginWaitingIds.value = loginWaitingIds.value.filter((accountId) => {
    const account = nextAccounts.find((item) => item.accountId === accountId);
    if (!account) return false;
    // 保留等待态：仅当账号仍在过渡中（refreshing）才继续等待
    // 登录成功（ready）、失败（error/missing/expired/reauth_required）都应清除等待态，允许重试
    return account.status === "refreshing";
  });
}

function getStatusTone(status: AuthStatus["status"]) {
  return statusMap[status];
}

async function loadAccounts({
  silent = false,
  force = false,
}: { silent?: boolean; force?: boolean } = {}) {
  if (!force && loadingPromise) {
    return loadingPromise;
  }

  if (!silent) {
    loading.value = true;
  }

  const gen = ++latestGeneration;

  loadingPromise = (async () => {
    try {
      const response = await api.listAccounts();
      if (gen !== latestGeneration) return;
      accounts.value = response.accounts;
      syncLoginWaitingState(response.accounts);
      error.value = "";
    } catch (cause) {
      if (gen !== latestGeneration) return;
      if (!silent) {
        accounts.value = [];
      }
      error.value = cause instanceof Error ? cause.message : "账号列表加载失败";
    } finally {
      if (gen === latestGeneration) {
        loading.value = false;
        loadingPromise = null;
      }
    }
  })();

  return loadingPromise;
}

async function handleLogin(accountId: string) {
  if (isWaitingForLogin(accountId)) return;

  try {
    await api.triggerLogin(accountId);
    loginWaitingIds.value = [...new Set([...loginWaitingIds.value, accountId])];
    notice.value = "登录窗口已打开，请在浏览器中完成 Google 登录";
    error.value = "";
    await loadAccounts({ silent: true, force: true });
  } catch (cause) {
    notice.value = "";
    error.value = cause instanceof Error ? cause.message : "无法触发登录";
  }
}

async function handleDelete(account: AuthStatus) {
  if (deletingAccountId.value) return;
  if (account.status === "ready") {
    const confirmed = window.confirm(`确认清除账号 ${account.accountId} 的凭证吗？`);
    if (!confirmed) return;
  }

  deletingAccountId.value = account.accountId;
  try {
    await api.deleteAccount(account.accountId);
    loginWaitingIds.value = loginWaitingIds.value.filter((id) => id !== account.accountId);
    notice.value = "凭证已清除";
    error.value = "";
    await loadAccounts({ silent: true, force: true });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "清除凭证失败";
  } finally {
    deletingAccountId.value = "";
  }
}

function isUploading(accountId: string) {
  return uploadingIds.value.includes(accountId);
}

function getUploadInput(accountId: string) {
  return uploadInputs.value[accountId] ?? "";
}

function setUploadInput(accountId: string, value: string) {
  uploadInputs.value = { ...uploadInputs.value, [accountId]: value };
}

function getUploadResult(accountId: string) {
  return uploadResults.value[accountId] ?? null;
}

function handleFileChange(accountId: string, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result as string;
    setUploadInput(accountId, text);
  };
  reader.onerror = () => {
    uploadResults.value = {
      ...uploadResults.value,
      [accountId]: { ok: false, message: "文件读取失败，请重试或改用粘贴方式" },
    };
  };
  reader.readAsText(file);
}

function handleTextareaInput(accountId: string, event: Event) {
  const textarea = event.target as HTMLTextAreaElement;
  setUploadInput(accountId, textarea.value);
  // 清空文件选择
  const fileInput = document.getElementById(`file-input-${accountId}`) as HTMLInputElement | null;
  if (fileInput) {
    fileInput.value = "";
  }
}

function formatExpiresAt(expiresAt: string) {
  try {
    return new Date(expiresAt).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return expiresAt;
  }
}

async function handleUploadState(accountId: string) {
  const text = uploadInputs.value[accountId] ?? "";
  if (!text.trim() || uploadingIds.value.includes(accountId)) return;

  uploadingIds.value = [...uploadingIds.value, accountId];
  // 清除旧结果
  const newResults = { ...uploadResults.value };
  delete newResults[accountId];
  uploadResults.value = newResults;

  try {
    const result = await api.uploadStorageState(accountId, text);
    uploadResults.value = { ...uploadResults.value, [accountId]: { ok: true, message: result.message, expiresAt: result.expiresAt } };
    uploadInputs.value = { ...uploadInputs.value, [accountId]: "" };
    await loadAccounts({ silent: true, force: true });
  } catch (err) {
    uploadResults.value = { ...uploadResults.value, [accountId]: { ok: false, message: err instanceof Error ? err.message : "上传失败" } };
  } finally {
    uploadingIds.value = uploadingIds.value.filter((id) => id !== accountId);
  }
}

onMounted(() => {
  refreshTimer = window.setInterval(() => {
    void loadAccounts({ silent: true });
  }, 5000);

  void loadAccounts();
});

onBeforeUnmount(() => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }
});
</script>

<template>
  <div class="accounts-page" :style="{ maxWidth: pageMaxWidth }">
    <div class="page-header">
      <RouterLink class="back-link" to="/">返回首页</RouterLink>
      <div class="header-rule-top" />
      <div class="header-content">
        <div>
          <p class="page-kicker">账号管理</p>
          <h1 class="page-title">Google 账号与凭证</h1>
        </div>
        <p class="header-note">每 5 秒自动检查一次状态，用于感知登录完成。</p>
      </div>
      <div class="header-rule-bottom" />
    </div>

    <div class="page-body">
      <p v-if="notice" class="state-notice">{{ notice }}</p>
      <p v-if="error && hasAccounts" class="state-error-banner">{{ error }}</p>

      <div v-if="loading && !hasAccounts" class="state-loading">
        正在加载账号...
      </div>

      <div v-else-if="error" class="state-error">
        <span class="error-mark">✕</span>
        <span>{{ error }}</span>
      </div>

      <div v-else-if="!hasAccounts" class="state-empty">
        <div class="empty-mark">◇</div>
        <p class="empty-title">尚未发现可管理的账号</p>
        <p class="empty-text">当服务端暴露账号后，这里会显示其登录状态与凭证操作。</p>
      </div>

      <TransitionGroup v-else class="accounts-list" tag="div" name="accounts-folio">
        <article v-for="account in accounts" :key="account.accountId" class="account-card">
          <div class="account-upper">
            <div class="account-main">
              <div class="account-meta">
                <p class="account-label">账号 ID</p>
                <h2 class="account-id">{{ account.accountId }}</h2>
              </div>

              <div class="status-row">
                <span
                  class="status-dot"
                  :style="{ backgroundColor: getStatusTone(account.status).dotClass }"
                  aria-hidden="true"
                />
                <span
                  class="status-text"
                  :style="{ color: getStatusTone(account.status).textClass }"
                >
                  {{ getStatusTone(account.status).label }}
                </span>
              </div>

              <p class="account-time">
                最后检查：{{ account.lastCheckedAt ? formatTime(account.lastCheckedAt) : "-" }}
              </p>

              <p v-if="account.error" class="account-error">{{ account.error }}</p>
            </div>

            <div class="account-actions">
              <button
                v-if="canTriggerLogin(account.status) || isWaitingForLogin(account.accountId)"
                type="button"
                class="btn-primary"
                :disabled="isWaitingForLogin(account.accountId) || deletingAccountId === account.accountId || isUploading(account.accountId)"
                @click="handleLogin(account.accountId)"
              >
                {{ isWaitingForLogin(account.accountId) ? "等待登录..." : "登录" }}
              </button>

              <button
                type="button"
                class="btn-secondary"
                :disabled="deletingAccountId === account.accountId || isWaitingForLogin(account.accountId) || isUploading(account.accountId)"
                @click="handleDelete(account)"
              >
                {{ deletingAccountId === account.accountId ? "清除中..." : "清除凭证" }}
              </button>
            </div>
          </div>

          <!-- 上传凭据区：非 ready 且非等待登录时显示 -->
          <div
            v-if="account.status !== 'ready' && !isWaitingForLogin(account.accountId)"
            class="upload-section"
          >
            <div class="upload-divider" />

            <details class="upload-guide">
              <summary class="upload-guide-summary">如何获取凭据文件？</summary>
              <div class="upload-guide-body">
                <p class="upload-guide-text">在<strong>本机</strong>（不是服务器）运行以下命令：</p>
                <div class="upload-code-block">
                  <code>npx notebooklm login</code>
                </div>
                <p class="upload-guide-text">命令执行后，凭据文件保存在：</p>
                <ul class="upload-guide-paths">
                  <li><span class="upload-path-os">macOS / Linux：</span><code>~/.notebooklm/storage-state.json</code></li>
                  <li><span class="upload-path-os">Windows：</span><code>%USERPROFILE%\.notebooklm\storage-state.json</code></li>
                </ul>
              </div>
            </details>

            <div class="upload-inputs">
              <!-- 方式一：文件上传 -->
              <label class="upload-file-label">
                <span class="upload-input-hint">选择文件</span>
                <input
                  :id="`file-input-${account.accountId}`"
                  type="file"
                  accept=".json"
                  class="upload-file-input"
                  @change="handleFileChange(account.accountId, $event)"
                />
              </label>

              <!-- 方式二：粘贴 JSON -->
              <textarea
                class="upload-textarea"
                :class="{ 'upload-textarea--error': getUploadInput(account.accountId).length > 50000 }"
                placeholder="或在此粘贴 storage-state.json 的内容"
                :value="getUploadInput(account.accountId)"
                @input="handleTextareaInput(account.accountId, $event)"
              />
              <p v-if="getUploadInput(account.accountId).length > 50000" class="upload-limit-warn">
                内容超过 50,000 字符限制（当前 {{ getUploadInput(account.accountId).length.toLocaleString() }} 字符）
              </p>
            </div>

            <!-- 提交按钮 -->
            <button
              type="button"
              class="btn-upload"
              :disabled="!getUploadInput(account.accountId).trim() || isUploading(account.accountId) || getUploadInput(account.accountId).length > 50000"
              @click="handleUploadState(account.accountId)"
            >
              {{ isUploading(account.accountId) ? "验证中..." : "验证并激活" }}
            </button>

            <!-- 结果显示 -->
            <div v-if="getUploadResult(account.accountId)" class="upload-result">
              <template v-if="getUploadResult(account.accountId)!.ok">
                <p class="upload-result--ok">✓ 凭据已激活</p>
                <p v-if="getUploadResult(account.accountId)!.expiresAt" class="upload-result-meta">
                  预计有效至 {{ formatExpiresAt(getUploadResult(account.accountId)!.expiresAt!) }}（约）
                </p>
              </template>
              <template v-else>
                <p class="upload-result--err">✕ {{ getUploadResult(account.accountId)!.message }}</p>
                <p class="upload-result-meta upload-result-meta--err">请重新运行 <code>npx notebooklm login</code> 后再上传</p>
              </template>
            </div>
          </div>
        </article>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.accounts-page {
  min-height: 100%;
  margin: 0 auto;
  padding: 0 1.5rem 4rem;
  background: #faf7f2;
  color: #2c2c2c;
}

.page-header {
  padding-top: 2.2rem;
  margin-bottom: 1.75rem;
}

.back-link {
  display: inline-block;
  margin-bottom: 1rem;
  color: rgba(44, 44, 44, 0.72);
  text-decoration: none;
  font-size: 0.95rem;
  line-height: 1.6;
}

.back-link:hover {
  color: #2c2c2c;
}

.header-rule-top {
  border-top: 2px solid #2c2c2c;
  margin-bottom: 0.95rem;
}

.header-content {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.25rem;
}

.page-kicker {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(44, 44, 44, 0.52);
}

.page-title {
  margin: 0;
  font-family: serif;
  font-size: 2rem;
  line-height: 1.25;
  font-weight: 600;
  color: #2c2c2c;
}

.header-note {
  max-width: 18rem;
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.7;
  color: rgba(44, 44, 44, 0.58);
  text-align: right;
}

.header-rule-bottom {
  border-top: 1px solid rgba(44, 44, 44, 0.18);
  margin-top: 0.95rem;
}

.page-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.state-notice,
.state-error,
.state-error-banner {
  padding: 0.85rem 1rem;
  border: 1px solid #d4c9b0;
  box-shadow: 0 1px 3px rgba(44, 44, 44, 0.06);
  line-height: 1.7;
  font-size: 1rem;
}

.state-notice {
  background: rgba(122, 104, 73, 0.06);
  color: #4f4332;
}

.state-loading {
  display: flex;
  justify-content: flex-start;
  padding: 2rem 0;
}

.state-error {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: rgba(154, 67, 51, 0.08);
  color: #7d2a1d;
}

.state-error-banner {
  margin: 0;
  background: rgba(154, 67, 51, 0.08);
  color: #7d2a1d;
}

.error-mark {
  font-size: 0.8rem;
  opacity: 0.7;
}

.state-empty {
  padding: 3.5rem 1rem;
  border: 1px solid #d4c9b0;
  box-shadow: 0 1px 3px rgba(44, 44, 44, 0.06);
  text-align: center;
  background: rgba(255, 252, 246, 0.72);
}

.empty-mark {
  margin-bottom: 0.9rem;
  font-size: 2rem;
  color: rgba(44, 44, 44, 0.32);
}

.empty-title {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  line-height: 1.6;
  font-weight: 600;
}

.empty-text {
  margin: 0;
  font-size: 1rem;
  line-height: 1.8;
  color: rgba(44, 44, 44, 0.58);
}

.accounts-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.account-card {
  display: flex;
  flex-direction: column;
  padding: 1.2rem 1.25rem;
  border: 1px solid #d4c9b0;
  background: rgba(255, 252, 246, 0.82);
  box-shadow: 0 1px 3px rgba(44, 44, 44, 0.06);
  transition: transform 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
}

.account-upper {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
}

.account-card:hover {
  transform: translateY(-2px);
  border-color: #c7baa0;
  background: rgba(255, 252, 246, 0.94);
}

.account-main {
  min-width: 0;
  flex: 1;
}

.account-meta {
  margin-bottom: 0.8rem;
}

.account-label {
  margin: 0 0 0.2rem;
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(44, 44, 44, 0.48);
}

.account-id {
  margin: 0;
  font-size: 1.15rem;
  line-height: 1.5;
  font-weight: 600;
  color: #2c2c2c;
  word-break: break-word;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.status-dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  flex-shrink: 0;
}

.status-text {
  font-size: 1rem;
  line-height: 1.6;
}

.account-time {
  margin: 0;
  font-size: 1rem;
  line-height: 1.7;
  color: rgba(44, 44, 44, 0.62);
}

.account-error {
  margin: 0.55rem 0 0;
  font-size: 0.92rem;
  line-height: 1.7;
  color: #8d3022;
}

.account-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.7rem;
  min-width: 9rem;
}

.btn-primary,
.btn-secondary {
  padding: 0.65rem 1rem;
  font-size: 1rem;
  line-height: 1.4;
  cursor: pointer;
  transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
}

.btn-primary {
  border: 1px solid #2c2c2c;
  background: #2c2c2c;
  color: #faf7f2;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.88;
}

.btn-primary:active:not(:disabled),
.btn-secondary:active:not(:disabled) {
  transform: scale(0.98);
}

.btn-secondary {
  border: 1px solid #2c2c2c;
  background: transparent;
  color: #2c2c2c;
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(44, 44, 44, 0.04);
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.accounts-folio-enter-active {
  transition: opacity 180ms ease-out, transform 200ms ease-out;
}

.accounts-folio-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

@media (max-width: 640px) {
  .accounts-page {
    padding: 0 1rem 3rem;
  }

  .header-content,
  .account-upper {
    flex-direction: column;
  }

  .header-note {
    max-width: none;
    text-align: left;
  }

  .account-actions {
    width: 100%;
    min-width: 0;
  }
}

@media (min-width: 900px) {
  .page-title {
    font-size: 2.15rem;
  }

  .header-note {
    max-width: 24rem;
  }
}

/* ── 上传凭据区 ── */
.upload-divider {
  border-top: 1px solid rgba(44, 44, 44, 0.12);
  margin: 1rem 0;
}

.upload-guide {
  margin-bottom: 1rem;
}

.upload-guide-summary {
  font-size: 0.9rem;
  color: rgba(44, 44, 44, 0.65);
  cursor: pointer;
  user-select: none;
  line-height: 1.6;
  list-style: none;
}

.upload-guide-summary::-webkit-details-marker {
  display: none;
}

.upload-guide-summary::before {
  content: "▸ ";
  font-size: 0.75rem;
  opacity: 0.7;
}

details[open] > .upload-guide-summary::before {
  content: "▾ ";
}

.upload-guide-body {
  margin-top: 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid #d4c9b0;
  background: rgba(212, 201, 176, 0.12);
}

.upload-guide-text {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  line-height: 1.7;
  color: rgba(44, 44, 44, 0.8);
}

.upload-guide-text:last-of-type {
  margin-top: 0.65rem;
}

.upload-code-block {
  display: inline-block;
  padding: 0.45rem 0.8rem;
  border: 1px solid #d4c9b0;
  background: rgba(44, 44, 44, 0.04);
  margin-bottom: 0.2rem;
}

.upload-code-block code,
.upload-guide-paths code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.85rem;
  color: #2c2c2c;
}

.upload-guide-paths {
  margin: 0.4rem 0 0;
  padding-left: 1.2rem;
}

.upload-guide-paths li {
  font-size: 0.9rem;
  line-height: 1.8;
  color: rgba(44, 44, 44, 0.75);
}

.upload-path-os {
  color: rgba(44, 44, 44, 0.55);
  font-size: 0.85rem;
}

.upload-inputs {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  margin-bottom: 0.85rem;
}

.upload-file-label {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
}

.upload-input-hint {
  font-size: 0.9rem;
  color: rgba(44, 44, 44, 0.65);
  text-decoration: underline;
  text-decoration-color: rgba(44, 44, 44, 0.3);
  text-underline-offset: 2px;
}

.upload-file-input {
  font-size: 0.9rem;
  color: rgba(44, 44, 44, 0.75);
  /* 让原生 file input 直接显示，不隐藏 */
  max-width: 100%;
}

.upload-textarea {
  width: 100%;
  min-height: 7rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid #d4c9b0;
  background: rgba(255, 252, 246, 0.6);
  color: #2c2c2c;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.85rem;
  line-height: 1.55;
  resize: vertical;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.upload-textarea:focus {
  outline: none;
  border-color: rgba(44, 44, 44, 0.42);
}

.upload-textarea--error {
  border-color: #9a4333;
}

.upload-limit-warn {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #9a4333;
}

.btn-upload {
  padding: 0.65rem 1.25rem;
  font-size: 1rem;
  line-height: 1.4;
  cursor: pointer;
  border: 1px solid #2c2c2c;
  background: transparent;
  color: #2c2c2c;
  transition: opacity 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
  align-self: flex-start;
}

.btn-upload:hover:not(:disabled) {
  background: rgba(44, 44, 44, 0.06);
}

.btn-upload:active:not(:disabled) {
  transform: scale(0.98);
}

.btn-upload:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.upload-result {
  margin-top: 0.75rem;
}

.upload-result--ok {
  margin: 0 0 0.3rem;
  font-size: 1rem;
  line-height: 1.6;
  color: #5b7f52;
  font-weight: 600;
}

.upload-result--err {
  margin: 0 0 0.3rem;
  font-size: 1rem;
  line-height: 1.6;
  color: #9a4333;
  font-weight: 600;
}

.upload-result-meta {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.7;
  color: rgba(44, 44, 44, 0.62);
}

.upload-result-meta--err {
  color: rgba(154, 67, 51, 0.75);
}

.upload-section {
  display: flex;
  flex-direction: column;
}
</style>
