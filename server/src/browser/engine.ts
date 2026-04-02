/**
 * Browser engine — manages Patchright browser lifecycle.
 * Handles: launch, cookie injection, stealth utilities, cleanup.
 */

import { chromium, type BrowserContext, type Page } from "patchright";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BROWSER_ARGS } from "./selectors";

// Paths relative to project root
const DATA_DIR = resolve(import.meta.dir, "../../../data/browser_state");
const PROFILE_DIR = resolve(DATA_DIR, "browser_profile");
const STATE_FILE = resolve(DATA_DIR, "state.json");

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

/**
 * Launch a persistent browser context with anti-detection measures.
 * Uses real Chrome (not Chromium) + persistent profile for consistent fingerprint.
 */
export async function launchBrowser(options?: {
  headless?: boolean;
}): Promise<BrowserContext> {
  const headless = options?.headless ?? true;

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless,
    viewport: null, // Use default viewport (more natural)
    ignoreDefaultArgs: ["--enable-automation"],
    args: [...BROWSER_ARGS],
  });

  // Inject saved cookies if state file exists (dual-storage workaround)
  if (existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
      if (state.cookies?.length) {
        await context.addCookies(state.cookies);
      }
    } catch {
      // Ignore corrupt state file
    }
  }

  return context;
}

/**
 * Open a new page in the browser context.
 */
export async function newPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  return page;
}

/**
 * Create a full browser session (context + page).
 */
export async function createSession(options?: {
  headless?: boolean;
}): Promise<BrowserSession> {
  const context = await launchBrowser(options);
  const page = await newPage(context);
  return { context, page };
}

/**
 * Close browser session safely.
 */
export async function closeSession(session: BrowserSession): Promise<void> {
  try {
    await session.page.close();
  } catch {
    // Page may already be closed
  }
  try {
    await session.context.close();
  } catch {
    // Context may already be closed
  }
}

/**
 * Human-like typing — random delay per character + occasional pauses.
 * Reference: notebooklm-skill StealthUtils.human_type
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string
): Promise<void> {
  const element = page.locator(selector);
  await element.click();

  for (const char of text) {
    const delay = Math.random() * 50 + 25; // 25-75ms per char
    await element.pressSequentially(char, { delay: 0 });
    await page.waitForTimeout(delay);

    // 5% chance of a "thinking pause"
    if (Math.random() < 0.05) {
      await page.waitForTimeout(Math.random() * 250 + 150); // 150-400ms
    }
  }
}

/**
 * Type text quickly (for long prompts where human-like speed is too slow).
 */
export async function fastType(
  page: Page,
  selector: string,
  text: string
): Promise<void> {
  const element = page.locator(selector);
  await element.click();
  await element.fill(text);
}

export { DATA_DIR, PROFILE_DIR, STATE_FILE };
