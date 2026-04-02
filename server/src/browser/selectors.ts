/**
 * CSS selectors for NotebookLM UI.
 * These WILL break when Google updates their UI — keep them centralized here.
 * Reference: pleaseprompto/notebooklm-skill config.py
 */

// Query input field — try multiple selectors in order
export const QUERY_INPUT_SELECTORS = [
  "textarea.query-box-input",
  'textarea[aria-label="Input for queries"]',
  'textarea[aria-label="Feld für Anfragen"]', // German locale
  'textarea[placeholder*="Ask"]',
  'textarea[placeholder*="question"]',
] as const;

// Response containers — last element is the latest answer
export const RESPONSE_SELECTORS = [
  ".to-user-container .message-text-content",
  "[data-message-author='bot']",
  "[data-message-author='assistant']",
] as const;

// Thinking/loading indicator
export const THINKING_SELECTOR = "div.thinking-message";

// NotebookLM URL pattern
export const NOTEBOOKLM_URL_PATTERN =
  /^https:\/\/notebooklm\.google\.com\//;

// Timeouts (ms)
export const TIMEOUTS = {
  PAGE_LOAD: 30_000,
  QUERY_INPUT_WAIT: 15_000,
  RESPONSE_POLL_MAX: 180_000, // 3 minutes max wait for answer
  RESPONSE_STABLE_COUNT: 3, // text must be same for 3 consecutive polls
  RESPONSE_POLL_INTERVAL: 1_000, // 1 second between polls
  AUTH_LOGIN_WAIT: 600_000, // 10 minutes for manual login
} as const;

// Browser launch args for anti-detection
export const BROWSER_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--no-default-browser-check",
] as const;
