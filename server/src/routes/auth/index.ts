import { existsSync, unlinkSync } from "node:fs";
import { Hono } from "hono";
import { authManager, DEFAULT_ACCOUNT_ID } from "../../notebooklm/auth-manager.js";
import { getLegacyStorageStatePath, getProfilePaths, writeAuthMeta, writeStorageState } from "../../notebooklm/auth-profile.js";
import { getAuthStatus, loginAccount, validateProfile } from "../../notebooklm/index.js";
import { taskQueue } from "../../worker/queue.js";
import logger from "../../lib/logger.js";

const auth = new Hono();
const loginInProgress = new Set<string>();

function isSupportedAccount(accountId: string): boolean {
  return accountId === DEFAULT_ACCOUNT_ID;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isHeadlessDeploymentLoginDisabled(): boolean {
  if (process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN === "1") {
    return true;
  }

  if (process.env.NOTEBOOKLM_DISABLE_INTERACTIVE_LOGIN === "0") {
    return false;
  }

  return process.platform !== "win32"
    && !process.env.DISPLAY
    && !process.env.WAYLAND_DISPLAY;
}

// GET /api/auth/status — check if Google auth is valid
auth.get("/status", async (c) => {
  const status = await getAuthStatus();
  return c.json(status);
});

auth.get("/accounts", async (c) => {
  // 使用 getAuthStatus 而非直接读 authManager，确保走初始化/迁移逻辑
  const status = await getAuthStatus();
  return c.json({ accounts: [status] });
});

auth.post("/accounts/:accountId/login", async (c) => {
  const { accountId } = c.req.param();
  if (!isSupportedAccount(accountId)) {
    return c.json({ error: "账号不存在" }, 404);
  }

  if (isHeadlessDeploymentLoginDisabled()) {
    return c.json({
      error: "当前部署环境不支持交互式浏览器登录，请通过 storage-state 再授权流程恢复认证。",
    }, 503);
  }

  if (loginInProgress.has(accountId)) {
    return c.json({ error: "该账号已有登录操作正在进行中" }, 409);
  }

  loginInProgress.add(accountId);
  try {
    // 立即写入 refreshing 状态，让前端在等待用户登录期间能感知到"正在进行中"
    writeAuthMeta(accountId, {
      accountId,
      status: "refreshing",
      lastCheckedAt: new Date().toISOString(),
    });
  } catch {
    loginInProgress.delete(accountId);
    return c.json({ error: "无法初始化登录状态" }, 500);
  }
  void loginAccount(accountId)
    .then(async () => {
      // 静默处理缓存失效失败，不影响登录成功状态
      await authManager.invalidateAuthClient(accountId).catch(() => undefined);
      // 重置失败计数，防止重新认证后因 failureCount 达阈值而死锁
      authManager.resetFailureCount(accountId);
    })
    .catch((error) => {
      writeAuthMeta(accountId, {
        accountId,
        status: "error",
        error: toErrorMessage(error),
        lastCheckedAt: new Date().toISOString(),
      });
    })
    .finally(() => {
      loginInProgress.delete(accountId);
    });

  return c.json({ message: "登录窗口已打开，请在浏览器中完成 Google 登录" }, 202);
});

auth.delete("/accounts/:accountId", async (c) => {
  const { accountId } = c.req.param();
  if (!isSupportedAccount(accountId)) {
    return c.json({ error: "账号不存在" }, 404);
  }

  // 先清除 legacy storage-state，防止 ensureDefaultProfileInitialized 将其复制回来
  const legacyPath = getLegacyStorageStatePath();
  if (existsSync(legacyPath)) {
    unlinkSync(legacyPath);
  }

  const paths = getProfilePaths(accountId);
  if (existsSync(paths.storageStatePath)) {
    unlinkSync(paths.storageStatePath);
  }

  writeAuthMeta(accountId, {
    accountId,
    status: "missing",
    reason: "credentials_cleared",
  });
  // 静默处理缓存失效失败，凭证文件已清除，失效失败不影响响应
  await authManager.invalidateAuthClient(accountId).catch(() => undefined);

  return c.json({ message: "账号凭证已清除" });
});

// POST /api/auth/reauth — upload new storage-state.json (base64) to restore auth
// If ADMIN_SECRET env var is set, requires Authorization: Bearer <ADMIN_SECRET>
// If ADMIN_SECRET is not set, the endpoint is open (self-hosted deployments)
auth.post("/reauth", async (c) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret) {
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    if (!token || token !== adminSecret) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object" || !("storageState" in body) || typeof (body as Record<string, unknown>).storageState !== "string") {
    return c.json({ error: "storageState (base64 string) is required" }, 400);
  }

  const b64 = (body as { storageState: string }).storageState;

  // Strict base64 validation: only allow [A-Za-z0-9+/] with optional '=' padding
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) {
    return c.json({ error: "storageState is not valid base64" }, 400);
  }

  let decoded: string;
  try {
    decoded = Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return c.json({ error: "storageState is not valid base64" }, 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return c.json({ error: "storageState decoded content is not valid JSON" }, 400);
  }

  // Write the new storage state and invalidate the cached client
  const accountId = DEFAULT_ACCOUNT_ID;
  writeStorageState(accountId, parsed);
  await authManager.invalidateAuthClient(accountId).catch(() => undefined);

  // Validate the newly written credentials directly via HTTP (no Playwright).
  // This bypasses silentRefresh (which uses the persistent browser) and avoids
  // the failureCount guard inside refreshInternal.
  let validation: Awaited<ReturnType<typeof validateProfile>>;
  try {
    validation = await validateProfile(accountId);
  } catch (err) {
    logger.error({ err }, "reauth: validateProfile threw after writing new storage state");
    return c.json({ error: "再授权验证失败：上游服务不可用" }, 502);
  }

  if (validation.status !== "ready") {
    logger.warn({ accountId, authStatus: validation.status }, "reauth: storage state written but auth still not ready");
    return c.json({
      error: "再授权失败：新凭证写入成功但认证状态未恢复为 ready",
      authStatus: validation.status,
    }, 422);
  }

  // Reset the failure counter only after confirming auth is ready.
  authManager.resetFailureCount(accountId);

  // Persist the ready status so other parts of the system see it immediately.
  writeAuthMeta(accountId, {
    accountId,
    status: "ready",
    lastCheckedAt: new Date().toISOString(),
    lastRefreshedAt: new Date().toISOString(),
  });

  // Auth is confirmed ready — wake up the queue
  taskQueue.resume();

  logger.info({ accountId }, "reauth: storage state updated, auth ready, queue resumed");

  return c.json({ message: "再授权成功，队列已恢复" });
});

export default auth;
