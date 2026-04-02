/**
 * NotebookLM interaction — ask questions and get answers via browser automation.
 * Each call = one browser session (open → ask → poll → close).
 */

import {
  createSession,
  closeSession,
  fastType,
  type BrowserSession,
} from "./engine";
import {
  QUERY_INPUT_SELECTORS,
  RESPONSE_SELECTORS,
  THINKING_SELECTOR,
  NOTEBOOKLM_URL_PATTERN,
  TIMEOUTS,
} from "./selectors";
import type { Page } from "patchright";

export interface AskResult {
  success: boolean;
  answer?: string;
  error?: string;
}

/**
 * Find the query input element by trying multiple selectors.
 */
async function findQueryInput(page: Page): Promise<string | null> {
  for (const selector of QUERY_INPUT_SELECTORS) {
    try {
      const el = page.locator(selector);
      if ((await el.count()) > 0 && (await el.first().isVisible())) {
        return selector;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Poll for the response to stabilize.
 * Waits until the answer text is identical for N consecutive polls.
 * Reference: notebooklm-skill ask_question.py stability algorithm.
 */
async function pollForResponse(page: Page): Promise<string | null> {
  const deadline = Date.now() + TIMEOUTS.RESPONSE_POLL_MAX;
  let lastText: string | null = null;
  let stableCount = 0;

  while (Date.now() < deadline) {
    // Skip if still "thinking"
    try {
      const thinking = page.locator(THINKING_SELECTOR);
      if ((await thinking.count()) > 0 && (await thinking.first().isVisible())) {
        await page.waitForTimeout(TIMEOUTS.RESPONSE_POLL_INTERVAL);
        continue;
      }
    } catch {
      // No thinking indicator, that's fine
    }

    // Try each response selector
    for (const selector of RESPONSE_SELECTORS) {
      try {
        const elements = page.locator(selector);
        const count = await elements.count();
        if (count === 0) continue;

        // Get the last response element (latest answer)
        const text = (await elements.nth(count - 1).innerText()).trim();
        if (!text) continue;

        if (text === lastText) {
          stableCount++;
          if (stableCount >= TIMEOUTS.RESPONSE_STABLE_COUNT) {
            return text;
          }
        } else {
          stableCount = 1;
          lastText = text;
        }
        break; // Found a response element, no need to try other selectors
      } catch {
        continue;
      }
    }

    await page.waitForTimeout(TIMEOUTS.RESPONSE_POLL_INTERVAL);
  }

  // Timed out — return whatever we have
  return lastText;
}

/**
 * Ask a single question to a NotebookLM notebook.
 * Opens a new browser session, navigates to the notebook, types the question,
 * waits for the answer, then closes the browser.
 */
export async function askNotebookLM(
  notebookUrl: string,
  question: string
): Promise<AskResult> {
  let session: BrowserSession | undefined;

  try {
    // 1. Launch browser + new page
    session = await createSession({ headless: true });
    const { page } = session;

    // 2. Navigate to notebook
    await page.goto(notebookUrl, {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUTS.PAGE_LOAD,
    });

    // 3. Verify we're on NotebookLM (not redirected to login)
    await page.waitForURL(NOTEBOOKLM_URL_PATTERN, {
      timeout: TIMEOUTS.PAGE_LOAD,
    });

    // 4. Wait for and find the query input
    await page.waitForTimeout(2000); // Let the page fully render
    const inputSelector = await findQueryInput(page);
    if (!inputSelector) {
      return {
        success: false,
        error: "Could not find query input field. Selectors may need updating.",
      };
    }

    // 5. Type the question (use fast type for long prompts)
    await fastType(page, inputSelector, question);

    // 6. Submit with Enter
    await page.keyboard.press("Enter");

    // 7. Poll for response
    const answer = await pollForResponse(page);
    if (!answer) {
      return {
        success: false,
        error: "Timed out waiting for response from NotebookLM.",
      };
    }

    return { success: true, answer };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  } finally {
    if (session) {
      await closeSession(session);
    }
  }
}
