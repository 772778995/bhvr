/**
 * Google authentication for NotebookLM.
 * First-time: opens headful browser for manual login.
 * Subsequent: uses saved session (profile dir + state.json cookies).
 */

import { writeFileSync, existsSync, statSync } from "node:fs";
import { chromium } from "patchright";
import {
  BROWSER_ARGS,
  NOTEBOOKLM_URL_PATTERN,
  TIMEOUTS,
} from "./selectors";
import { PROFILE_DIR, STATE_FILE, DATA_DIR } from "./engine";
import { mkdirSync } from "node:fs";

export interface AuthStatus {
  authenticated: boolean;
  stateFileExists: boolean;
  stateFileAge?: number; // days since last save
  profileExists: boolean;
}

/**
 * Check if we have a valid auth session.
 */
export function getAuthStatus(): AuthStatus {
  const stateFileExists = existsSync(STATE_FILE);
  const profileExists = existsSync(PROFILE_DIR);

  let stateFileAge: number | undefined;
  if (stateFileExists) {
    const stats = statSync(STATE_FILE);
    stateFileAge =
      (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24); // days
  }

  return {
    authenticated: stateFileExists && profileExists,
    stateFileExists,
    stateFileAge,
    profileExists,
  };
}

/**
 * Launch a visible (headful) browser and navigate to NotebookLM.
 * User must manually log in. Once redirected back to notebooklm.google.com,
 * the session is saved to both the browser profile and state.json.
 *
 * Returns true if login succeeded, false if timed out.
 */
export async function setupAuth(): Promise<boolean> {
  mkdirSync(DATA_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false, // MUST be visible for manual login
    viewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [...BROWSER_ARGS],
    timeout: 60_000, // 60s for browser launch
  });

  const page = context.pages[0] || (await context.newPage());

  try {
    await page.goto("https://notebooklm.google.com", {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUTS.PAGE_LOAD,
    });

    // Wait for user to complete login and be redirected back to NotebookLM
    // This blocks until the URL matches or timeout (10 min default)
    await page.waitForURL(NOTEBOOKLM_URL_PATTERN, {
      timeout: TIMEOUTS.AUTH_LOGIN_WAIT,
    });

    // Save session cookies to state.json
    const state = await context.storageState();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    return true;
  } catch {
    return false;
  } finally {
    await context.close();
  }
}
