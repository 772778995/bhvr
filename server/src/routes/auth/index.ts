import { existsSync, unlinkSync } from "node:fs";
import { Hono } from "hono";
import { authManager, DEFAULT_ACCOUNT_ID } from "../../notebooklm/auth-manager.js";
import { getLegacyStorageStatePath, getProfilePaths, writeAuthMeta } from "../../notebooklm/auth-profile.js";
import { getAuthStatus, loginAccount } from "../../notebooklm/index.js";

const auth = new Hono();
const loginInProgress = new Set<string>();

function isSupportedAccount(accountId: string): boolean {
  return accountId === DEFAULT_ACCOUNT_ID;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export default auth;
