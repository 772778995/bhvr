/**
 * NotebookLM client — wraps notebooklm-kit SDK.
 * Handles authentication via saved cookies from `notebooklm login` CLI,
 * and provides methods for the research workflow.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { NotebookLMClient } from "notebooklm-kit";
import { getQuotaStatus, consumeQuota } from "../lib/quota.js";

// Path to storage state saved by `notebooklm login` CLI
const STORAGE_STATE_PATH = resolve(homedir(), ".notebooklm", "storage-state.json");

// Google cookie domain filter (same as notebooklm CLI)
const ALLOWED_DOMAINS = [
  ".google.com",
  "notebooklm.google.com",
  ".notebooklm.google.com",
  "accounts.google.com",
  ".googleusercontent.com",
];

export interface AuthStatus {
  authenticated: boolean;
  storageStateExists: boolean;
  cookieCount: number;
  error?: string;
}

export interface AskResult {
  success: boolean;
  answer?: string;
  citations?: unknown[];
  error?: string;
}

// Singleton SDK instance (lazy-initialized)
let sdkInstance: NotebookLMClient | null = null;
let lastAuthToken: string | null = null;
let lastCookieHeader: string | null = null;

/**
 * Extract and deduplicate cookies from the storage-state.json file.
 */
function loadCookies(): { cookieHeader: string; cookieCount: number } | null {
  if (!existsSync(STORAGE_STATE_PATH)) return null;

  const storageState = JSON.parse(readFileSync(STORAGE_STATE_PATH, "utf-8"));
  const rawCookies = storageState.cookies;
  if (!rawCookies || !Array.isArray(rawCookies)) return null;

  const filtered = rawCookies.filter((cookie: any) =>
    ALLOWED_DOMAINS.some((domain) => {
      if (domain.startsWith("."))
        return cookie.domain === domain || cookie.domain.endsWith(domain);
      return cookie.domain === domain;
    })
  );

  // Deduplicate by name, preferring .google.com domain
  const cookieMap = new Map<string, any>();
  for (const cookie of filtered) {
    const existing = cookieMap.get(cookie.name);
    if (!existing || cookie.domain === ".google.com") {
      cookieMap.set(cookie.name, cookie);
    }
  }

  const cookies = Array.from(cookieMap.values());
  if (cookies.length === 0) return null;

  return {
    cookieHeader: cookies.map((c: any) => `${c.name}=${c.value}`).join("; "),
    cookieCount: cookies.length,
  };
}

/**
 * Fetch the SNlM0e auth token from the NotebookLM homepage using cookies.
 */
async function fetchAuthToken(cookieHeader: string): Promise<string> {
  const resp = await fetch("https://notebooklm.google.com/", {
    headers: {
      Cookie: cookieHeader,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    redirect: "manual",
  });

  if (resp.status !== 200) {
    const location = resp.headers.get("location") || "";
    if (location.includes("accounts.google.com")) {
      throw new Error(
        'Session expired. Run "npx notebooklm login" to re-authenticate.'
      );
    }
    throw new Error(`Failed to fetch auth token: HTTP ${resp.status}`);
  }

  const html = await resp.text();
  const tokenMatch = html.match(/"SNlM0e":"([^"]+)"/);
  if (!tokenMatch?.[1]) {
    throw new Error("Failed to extract auth token (SNlM0e) from page");
  }

  return tokenMatch[1];
}

/**
 * Get or create the singleton SDK client.
 * Connects lazily on first use.
 */
async function getClient(): Promise<NotebookLMClient> {
  if (sdkInstance) return sdkInstance;

  const cookieData = loadCookies();
  if (!cookieData) {
    throw new Error(
      'No authentication found. Run "npx notebooklm login" first.'
    );
  }

  const authToken = await fetchAuthToken(cookieData.cookieHeader);

  const client = new NotebookLMClient({
    authToken,
    cookies: cookieData.cookieHeader,
  });

  await client.connect();

  sdkInstance = client;
  lastAuthToken = authToken;
  lastCookieHeader = cookieData.cookieHeader;

  return client;
}

/**
 * Dispose the SDK client (for graceful shutdown).
 */
export function disposeClient(): void {
  if (sdkInstance) {
    sdkInstance.dispose();
    sdkInstance = null;
    lastAuthToken = null;
    lastCookieHeader = null;
  }
}

/**
 * Check authentication status without fully connecting.
 */
export function getAuthStatus(): AuthStatus {
  const storageStateExists = existsSync(STORAGE_STATE_PATH);

  if (!storageStateExists) {
    return { authenticated: false, storageStateExists, cookieCount: 0 };
  }

  const cookieData = loadCookies();
  if (!cookieData) {
    return {
      authenticated: false,
      storageStateExists,
      cookieCount: 0,
      error: "No valid Google cookies found in storage state",
    };
  }

  return {
    authenticated: true,
    storageStateExists,
    cookieCount: cookieData.cookieCount,
  };
}

/**
 * List all notebooks.
 */
export async function listNotebooks() {
  const client = await getClient();
  return client.notebooks.list();
}

/**
 * Extract the notebook project ID from a NotebookLM URL.
 * URL format: https://notebooklm.google.com/notebook/<projectId>
 */
export function extractNotebookId(url: string): string {
  const match = url.match(/notebook\/([a-f0-9-]+)/i);
  if (!match?.[1]) {
    throw new Error(`Cannot extract notebook ID from URL: ${url}`);
  }
  return match[1];
}

/**
 * Ask a question to a specific notebook.
 * Uses the chat API — each call is independent (no conversation context).
 */
export async function askNotebook(
  notebookId: string,
  question: string
): Promise<AskResult> {
  try {
    const quota = getQuotaStatus();
    if (quota.remaining <= 0) {
      return {
        success: false,
        error: `Daily quota exceeded (${quota.limit}/day). Try again tomorrow.`,
      };
    }

    const client = await getClient();
    consumeQuota();
    const result = await client.generation.chat(notebookId, question);

    if (!result?.text) {
      return {
        success: false,
        error: "Empty response from NotebookLM",
      };
    }

    return {
      success: true,
      answer: result.text,
      citations: result.citations || [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // If auth expired, clear the cached client so next call re-authenticates
    if (message.includes("expired") || message.includes("401")) {
      disposeClient();
    }

    return { success: false, error: message };
  }
}
