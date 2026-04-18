import { existsSync, unlinkSync } from "node:fs";
import { Hono } from "hono";
import { authManager, DEFAULT_ACCOUNT_ID } from "../../notebooklm/auth-manager.js";
import { getLegacyStorageStatePath, getProfilePaths, writeAuthMeta, writeStorageState } from "../../notebooklm/auth-profile.js";
import { getAuthStatus, loginAccount } from "../../notebooklm/index.js";
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

function isInteractiveLoginAvailable(): boolean {
  // Docker containers create /.dockerenv (Linux/macOS Docker)
  try {
    if (existsSync("/.dockerenv")) return false;
  } catch {
    // ignore stat errors
  }
  // Headless Linux without a display server
  if (process.platform === "linux" && !process.env.DISPLAY) return false;
  return true;
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

  if (!isInteractiveLoginAvailable()) {
    return c.json(
      {
        error:
          "当前环境不支持交互式登录（无桌面浏览器 / Docker 容器）。请在账号管理页面使用「上传凭据」功能代替。",
      },
      503,
    );
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
  });
  // 静默处理缓存失效失败，凭证文件已清除，失效失败不影响响应
  await authManager.invalidateAuthClient(accountId).catch(() => undefined);

  return c.json({ message: "账号凭证已清除" });
});

// POST /api/auth/accounts/:accountId/upload-state — upload raw storage-state JSON string to restore auth
auth.post("/accounts/:accountId/upload-state", async (c) => {
  const { accountId } = c.req.param();
  if (!isSupportedAccount(accountId)) {
    return c.json({ error: "账号不存在" }, 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "无效的请求体" }, 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("storageState" in body) ||
    typeof (body as Record<string, unknown>).storageState !== "string"
  ) {
    return c.json({ error: "storageState 字段必填" }, 400);
  }

  const storageStateStr = (body as { storageState: string }).storageState;

  let parsed: unknown;
  try {
    parsed = JSON.parse(storageStateStr);
  } catch {
    return c.json({ error: "不是有效的 JSON" }, 400);
  }

  // Validate SAPISID cookie presence
  const hasCookiesArray =
    parsed !== null &&
    typeof parsed === "object" &&
    "cookies" in parsed &&
    Array.isArray((parsed as Record<string, unknown>).cookies);

  if (!hasCookiesArray) {
    return c.json({ error: "缺少必要的 SAPISID cookie，请重新运行 npx notebooklm login" }, 400);
  }

  type CookieEntry = { name: string; value: string; expires?: number };
  const cookies = (parsed as { cookies: unknown[] }).cookies;
  const sapisidCookie = cookies.find(
    (c): c is CookieEntry =>
      typeof c === "object" && c !== null && (c as Record<string, unknown>).name === "SAPISID",
  ) as CookieEntry | undefined;

  if (!sapisidCookie) {
    return c.json({ error: "缺少必要的 SAPISID cookie，请重新运行 npx notebooklm login" }, 400);
  }

  if (loginInProgress.has(accountId)) {
    return c.json({ error: "已有登录流程进行中，请等待完成" }, 409);
  }

  writeStorageState(accountId, parsed);
  await authManager.invalidateAuthClient(accountId).catch(() => undefined);
  writeAuthMeta(accountId, {
    accountId,
    status: "ready",
    lastCheckedAt: new Date().toISOString(),
  });
  taskQueue.resume();

  const expiresRaw = sapisidCookie.expires;
  const expiresAt =
    typeof expiresRaw === "number" && expiresRaw > 0
      ? new Date(expiresRaw * 1000).toISOString()
      : undefined;

  logger.info({ accountId }, "upload-state: credentials written, queue resumed");

  return c.json({ message: "凭据已激活", ...(expiresAt !== undefined ? { expiresAt } : {}) });
});

// POST /api/auth/reauth — upload new storage-state.json (base64) to restore auth
// Protected by Authorization: Bearer <ADMIN_SECRET>
auth.post("/reauth", async (c) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return c.json({ error: "再授权接口未启用：未配置 ADMIN_SECRET" }, 503);
  }

  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!token || token !== adminSecret) {
    return c.json({ error: "Unauthorized" }, 401);
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

  // Refresh the auth profile to pick up the new storage state.
  // Only resume the queue if auth is confirmed ready.
  let refreshResult;
  try {
    refreshResult = await authManager.refreshAuthProfile(accountId, "manual-reauth");
  } catch (err) {
    logger.error({ err }, "reauth: refreshAuthProfile threw after writing new storage state");
    return c.json({ error: "再授权验证失败：上游服务不可用" }, 502);
  }

  if (refreshResult.status !== "ready") {
    logger.warn({ accountId, authStatus: refreshResult.status }, "reauth: storage state written but auth still not ready");
    return c.json({
      error: "再授权失败：新凭证写入成功但认证状态未恢复为 ready",
      authStatus: refreshResult.status,
    }, 422);
  }

  // Auth is confirmed ready — wake up the queue
  taskQueue.resume();

  logger.info({ accountId }, "reauth: storage state updated, auth ready, queue resumed");

  return c.json({ message: "再授权成功，队列已恢复" });
});

export default auth;
