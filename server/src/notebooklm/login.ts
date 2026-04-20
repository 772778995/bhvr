import { chromium } from "playwright";
import {
  ensureProfileDirectories,
  getProfilePaths,
  writeAuthMeta,
  writeStorageState,
} from "./auth-profile.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const NOTEBOOKLM_URL = "https://notebooklm.google.com/";

export async function loginAccount(accountId: string): Promise<{ accountId: string; status: "ready" }> {
  ensureProfileDirectories(accountId);
  const paths = getProfilePaths(accountId);

  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

  try {
    context = await chromium.launchPersistentContext(paths.browserUserDataDir, {
      headless: false,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
      args: ["--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(NOTEBOOKLM_URL);
    await page.waitForURL(
      (url) => !url.href.includes("accounts.google.com")
        && !url.href.includes("/challenge")
        && url.href.includes("notebooklm.google.com"),
      { timeout: LOGIN_TIMEOUT_MS },
    );

    const storageState = await context.storageState();
    const hasSapisid = storageState.cookies.some((cookie) => cookie.name === "SAPISID");
    if (!hasSapisid) {
      throw new Error("登录未完成：缺少必要的 Google 会话 cookie");
    }

    writeStorageState(accountId, storageState);

    const now = new Date().toISOString();
    writeAuthMeta(accountId, {
      accountId,
      status: "ready",
      lastRefreshedAt: now,
      lastCheckedAt: now,
    });

    return { accountId, status: "ready" };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`登录超时：请在 ${Math.floor(LOGIN_TIMEOUT_MS / 60000)} 分钟内完成 Google 登录`);
    }

    throw error;
  } finally {
    await context?.close();
  }
}
