/**
 * NotebookLM gateway — wraps notebooklm-kit SDK operations behind the auth manager.
 */

import { existsSync, readFileSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { Mutex, E_TIMEOUT } from "async-mutex";
import type { BrowserContext, Page } from "playwright";
import {
  NotebookLMClient,
  NotebookLMAuthError,
  RefreshClient,
  ResearchMode,
  SearchSourceType,
  SourceType,
  SourceStatus,
  ArtifactType,
  ArtifactState,
  getErrorCode,
} from "notebooklm-kit";
import type { Notebook, Source, Artifact } from "notebooklm-kit";
import type {
  AddDiscoveredSourcesOptions,
  AddSourceResult,
  SourceProcessingStatus,
  WebSearchResult,
  CreateArtifactOptions,
} from "notebooklm-kit";
import { getQuotaStatus, consumeQuota } from "../lib/quota.js";
import logger from "../lib/logger.js";
import { buildAlertSink } from "./alert-sink.js";
import {
  authManager,
  configureAuthManager,
  DEFAULT_ACCOUNT_ID,
  type RuntimeClientLike,
} from "./auth-manager.js";
import {
  ensureProfileDirectories,
  getLegacyStorageStatePath,
  getDefaultStorageStatePath,
  getProfilePaths,
  prepareStorageStateFromEnv,
  readAuthMeta,
  readStorageState,
  writeAuthMeta,
  writeStorageState,
  type AuthMeta,
  type AuthState,
} from "./auth-profile.js";

// ---------------------------------------------------------------------------
// Per-operation-key concurrency gate
// ---------------------------------------------------------------------------

/**
 * Bottom-layer interface family keys. Group by SDK sub-service, not by business function.
 * All callers must pass one of these constants — no magic strings.
 */
export type OperationKey =
  | "generation.chat"
  | "notebooks.read"
  | "notebooks.write"
  | "history.rpc"
  | "sources.read"
  | "sources.write"
  | "sources.search"
  | "artifacts.read"
  | "artifacts.write";

/** How long a request may wait in queue before timing out (ms). */
const QUEUE_TIMEOUT_MS = 120_000;

export interface KeyedRequestGate {
  run<T>(key: OperationKey, operation: () => Promise<T>): Promise<T>;
  /** Test-only: number of keys currently tracked in the internal map. */
  activeKeyCount(): number;
}

/**
 * Creates a keyed request gate.
 *
 * Each key gets its own serial queue implemented as a Promise chain.
 * Timeout is handled before the operation enters the chain, so a timed-out
 * caller never ghost-acquires the lock and cleanup is always exact.
 *
 * @param timeoutMs Max ms a caller may wait to acquire the key slot (default 120 s).
 */
export function createKeyedRequestGate(timeoutMs = QUEUE_TIMEOUT_MS): KeyedRequestGate {
  // Each entry is the tail of the current serial chain for that key.
  // `pending` counts callers that are waiting or executing; when it reaches 0
  // after a chain step completes we remove the key.
  interface ChainEntry {
    tail: Promise<void>;
    pending: number;
  }

  const map = new Map<string, ChainEntry>();

  async function run<T>(key: OperationKey, operation: () => Promise<T>): Promise<T> {
    // Grab or create the chain for this key.
    const entry: ChainEntry = map.get(key) ?? { tail: Promise.resolve(), pending: 0 };
    entry.pending += 1;
    map.set(key, entry);

    // Race: either we get a slot (previous tail resolves) within timeoutMs,
    // or we time out. In the timeout case we still need to let the chain
    // advance — we insert a no-op slot so the next waiter is not blocked.
    let slotResolve!: () => void;
    const slot = new Promise<void>((r) => { slotResolve = r; });

    // Attach ourselves to the tail. When it resolves, our turn begins.
    // We capture the old tail to chain from.
    const prevTail = entry.tail;
    // Our contribution to the chain: resolve `slot` when previous tail finishes.
    // This promise itself never rejects (errors inside operation don't propagate here).
    const ourChainLink: Promise<void> = prevTail.then(() => slot);
    entry.tail = ourChainLink;

    // Wait for our turn, with a timeout.
    let timedOut = false;
    const turnPromise = prevTail.then(() => {
      if (timedOut) {
        // We were already timed out — release our slot immediately so the
        // chain can continue.
        slotResolve();
        throw E_TIMEOUT;
      }
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) =>
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(E_TIMEOUT);
      }, timeoutMs)
    );

    try {
      await Promise.race([turnPromise, timeoutPromise]);
    } catch (err) {
      if (err === E_TIMEOUT) {
        // Make sure slot is resolved so downstream waiters are not blocked.
        // (timedOut flag causes turnPromise to resolve the slot when it fires.)
        entry.pending -= 1;
        if (entry.pending === 0) map.delete(key);
        throw E_TIMEOUT;
      }
      throw err;
    }

    // Our turn — execute the operation.
    try {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      return await operation();
    } finally {
      slotResolve(); // release our slot → next waiter's turn begins
      entry.pending -= 1;
      if (entry.pending === 0) map.delete(key);
    }
  }

  return {
    run,
    activeKeyCount: () => map.size,
  };
}

/** Module-level gate shared by all NotebookLM operations. */
const requestGate = createKeyedRequestGate();

/** Serializes auth state mutations (getClient / invalidate / refresh). */
const authFlowMutex = new Mutex();

// ---------------------------------------------------------------------------

const ALLOWED_DOMAINS = [
  ".google.com",
  "notebooklm.google.com",
  ".notebooklm.google.com",
  "accounts.google.com",
  ".googleusercontent.com",
];

const NOTEBOOKLM_BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

function extractAuthTokenFromHtml(html: string): string | null {
  const tokenMatch = html.match(/"SNlM0e":"([^"]+)"/);
  return tokenMatch?.[1] ?? null;
}

const testHooks = {
  importPlaywright: defaultImportPlaywright,
  canAttemptSilentRefresh: null as ((accountId: string) => boolean) | null,
};

export type AuthStatus = AuthMeta;

export interface AskResult {
  success: boolean;
  answer?: string;
  citations?: unknown[];
  error?: string;
}

export interface NotebookDetail {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
}

export interface NotebookSource {
  id: string;
  title: string;
  type: "pdf" | "web" | "text" | "youtube" | "drive" | "image" | "unknown";
  sourceTypeRaw?: string;
  status: "ready" | "processing" | "failed" | "unknown";
  url?: string;
}

export interface NotebookMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: "done" | "streaming" | "sent";
}

type NotebookHistoryThreadIdResponse = Array<Array<[string]>>;
type NotebookListHomeResponse = [string, unknown, string, string, unknown, unknown?][];

type NotebookHistoryUserMessageRecord = [
  id: string,
  createdAt: [seconds: number, nanos: number],
  roleCode: 1,
  content: string,
];

type NotebookHistoryAssistantMessageRecord = [
  id: string,
  createdAt: [seconds: number, nanos: number],
  roleCode: 2,
  unused: null,
  content: unknown[],
];

type NotebookHistoryMessageRecord = NotebookHistoryUserMessageRecord | NotebookHistoryAssistantMessageRecord;

export interface NotebookChatHistoryItem {
  role: "user" | "assistant";
  message: string;
}

export interface NotebookChatRequest {
  prompt: string;
  sourceIds?: string[];
  conversationId?: string;
  messageIds?: [string, string];
  conversationHistory?: NotebookChatHistoryItem[];
}

export interface NotebookChatResponse {
  text: string;
  conversationId?: string;
  messageIds?: [string, string];
  citations: unknown[];
}

export interface ResearchAskResult {
  success: boolean;
  answer?: string;
  error?: string;
  citations?: unknown[];
  conversationId?: string;
}

function mergeHistoryMessages(
  threadMessages: NotebookMessage[][],
  hiddenThreadIds: string[] = [],
  orderedThreadIds: string[] = [],
): NotebookMessage[] {
  const hidden = new Set(hiddenThreadIds);

  const flattened = threadMessages
    .map((messages, index) => ({
      threadId: orderedThreadIds[index],
      messages,
    }))
    .filter((entry) => !entry.threadId || !hidden.has(entry.threadId))
    .flatMap((entry) => entry.messages)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const seen = new Set<string>();
  return flattened.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

export interface AccessCheckResult {
  accessible: boolean;
  error?: string;
}

export interface SourceAddResponse {
  sourceIds: string[];
  wasChunked: boolean;
}

export interface SourceSearchInput {
  query: string;
  sourceType: "web" | "drive";
  mode: "fast" | "deep";
}

class AuthRequiredError extends Error {
  readonly code = "AUTH_REQUIRED";
}

class NotebookRequestAuthError extends Error {
  readonly code = "NOTEBOOK_AUTH_FAILED";
}

export function isNotebookAuthError(error: unknown): boolean {
  return error instanceof NotebookRequestAuthError || error instanceof AuthRequiredError;
}

async function defaultImportPlaywright(): Promise<typeof import("playwright")> {
  return await import("playwright");
}

function extractCookieData(storageState: unknown): { cookieHeader: string; cookieCount: number } | null {
  if (!storageState || typeof storageState !== "object") return null;
  const rawCookies = (storageState as { cookies?: unknown }).cookies;
  if (!rawCookies || !Array.isArray(rawCookies)) return null;

  const filtered = rawCookies.filter((cookie: any) =>
    ALLOWED_DOMAINS.some((domain) => {
      if (domain.startsWith(".")) return cookie.domain === domain || cookie.domain.endsWith(domain);
      return cookie.domain === domain;
    })
  );

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

function loadCookiesFromProfile(accountId: string): { cookieHeader: string; cookieCount: number } | null {
  const storageState = readStorageState(accountId);
  if (!storageState.ok || !storageState.value) return null;
  return extractCookieData(storageState.value);
}

function canAttemptSilentRefresh(accountId: string): boolean {
  if (testHooks.canAttemptSilentRefresh !== null) {
    return testHooks.canAttemptSilentRefresh(accountId);
  }
  const cookieData = loadCookiesFromProfile(accountId);
  if (!cookieData) return false;
  return cookieData.cookieHeader.includes("SAPISID=");
}

async function fetchAuthToken(cookieHeader: string): Promise<string> {
  const resp = await fetch("https://notebooklm.google.com/", {
    headers: {
      Cookie: cookieHeader,
      "User-Agent": NOTEBOOKLM_BROWSER_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    redirect: "manual",
  });

  if (resp.status !== 200) {
    const location = resp.headers.get("location") || "";
    if (location.includes("accounts.google.com")) {
      throw new Error('Session expired. Run "npx notebooklm login" to re-authenticate.');
    }
    if (location.includes("location=unsupported")) {
      throw new Error("NotebookLM rejected the request as an unsupported browser environment");
    }
    throw new Error(`Failed to fetch auth token: HTTP ${resp.status}`);
  }

  const html = await resp.text();
  const token = extractAuthTokenFromHtml(html);
  if (!token) {
    throw new Error("Failed to extract auth token (SNlM0e) from page");
  }

  return token;
}

async function extractAuthTokenFromPersistentBrowser(accountId: string): Promise<{ authToken: string; storageState: unknown }> {
  const { chromium } = await testHooks.importPlaywright();
  const paths = getProfilePaths(accountId);
  const context = await chromium.launchPersistentContext(paths.browserUserDataDir, {
    headless: true,
    channel: "chrome",
  });

  try {
    const page = await context.newPage();
    await page.goto("https://notebooklm.google.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await verifyNotebookPageAuthenticated(page);

    const html = await page.content();
    const authToken = extractAuthTokenFromHtml(html);
    if (!authToken) {
      throw new Error("Failed to extract auth token (SNlM0e) from browser page");
    }

    const storageState = await exportPersistentContextState(context, accountId);
    return { authToken, storageState };
  } finally {
    await context.close();
  }
}

async function verifyNotebookPageAuthenticated(page: Page): Promise<void> {
  const currentUrl = page.url();
  if (currentUrl.includes("accounts.google.com") || currentUrl.includes("challenge")) {
    throw new AuthRequiredError("Authentication requires manual re-login");
  }
}

async function exportPersistentContextState(context: BrowserContext, accountId: string): Promise<unknown> {
  const storageState = await context.storageState();
  writeStorageState(accountId, storageState);
  return storageState;
}

async function refreshWithPersistentProfile(accountId: string): Promise<{ authToken: string; storageState: unknown }> {
  return await extractAuthTokenFromPersistentBrowser(accountId);
}

function isRecognizedAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("401")
    || message.includes("expired")
    || message.includes("auth token")
    || message.includes("authentication")
    || error instanceof NotebookLMAuthError
    || error instanceof AuthRequiredError
    || error instanceof NotebookRequestAuthError;
}

async function ensureDefaultProfileInitialized(): Promise<void> {
  // Apply env-var secret injection first (Docker / headless server scenario).
  prepareStorageStateFromEnv(getDefaultStorageStatePath());

  ensureProfileDirectories(DEFAULT_ACCOUNT_ID);
  const profile = getProfilePaths(DEFAULT_ACCOUNT_ID);
  const legacyStorageStatePath = getLegacyStorageStatePath();
  const legacyExists = existsSync(legacyStorageStatePath);
  const profileExists = existsSync(profile.storageStatePath);

  if (!profileExists && legacyExists) {
    mkdirSync(profile.baseDir, { recursive: true });
    copyFileSync(legacyStorageStatePath, profile.storageStatePath);
  }

  if (profileExists && legacyExists) {
    const legacyMtime = statSync(legacyStorageStatePath).mtimeMs;
    const profileMtime = statSync(profile.storageStatePath).mtimeMs;
    if (legacyMtime > profileMtime) {
      copyFileSync(legacyStorageStatePath, profile.storageStatePath);

      const meta = readAuthMeta(DEFAULT_ACCOUNT_ID);
      if (meta.ok && meta.value.status === "reauth_required") {
        writeAuthMeta(DEFAULT_ACCOUNT_ID, {
          accountId: DEFAULT_ACCOUNT_ID,
          status: "expired",
          error: "Stored credentials require validation",
        });
      }
    }
  }

  const meta = readAuthMeta(DEFAULT_ACCOUNT_ID);
  if (meta.ok && meta.value.status === "missing" && existsSync(profile.storageStatePath)) {
    writeAuthMeta(DEFAULT_ACCOUNT_ID, {
      accountId: DEFAULT_ACCOUNT_ID,
      status: "expired",
      error: "Stored credentials require validation",
    });
  }
}

async function createRuntimeClient(accountId: string): Promise<RuntimeClientLike> {
  await ensureDefaultProfileInitialized();

  let cookieData = loadCookiesFromProfile(accountId);
  if (!cookieData) {
    throw new AuthRequiredError('No authentication found. Run "npx notebooklm login" first.');
  }

  let authToken: string;
  try {
    authToken = await fetchAuthToken(cookieData.cookieHeader);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("unsupported browser environment")) {
      throw error;
    }

    const refreshed = await extractAuthTokenFromPersistentBrowser(accountId);
    authToken = refreshed.authToken;
    writeStorageState(accountId, refreshed.storageState);
    cookieData = extractCookieData(refreshed.storageState);
    if (!cookieData) {
      throw new AuthRequiredError("Browser refresh completed but no valid Google cookies were exported");
    }
  }

  const client = new NotebookLMClient({
    authToken,
    cookies: cookieData.cookieHeader,
    autoRefresh: false,
  });

  await client.connect();
  return client;
}

async function validateProfile(accountId: string): Promise<{ status: Extract<AuthState, "ready" | "expired" | "reauth_required" | "error">; error?: string }> {
  try {
    const cookieData = loadCookiesFromProfile(accountId);
    if (!cookieData) {
      return { status: "reauth_required", error: 'No authentication found. Run "npx notebooklm login" first.' };
    }

    await fetchAuthToken(cookieData.cookieHeader);
    return { status: "ready" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("accounts.google.com") || message.includes("re-authenticate")) {
      return { status: "reauth_required", error: message };
    }

    if (message.includes("HTTP") || message.includes("token")) {
      return { status: "expired", error: message };
    }

    return { status: "error", error: message };
  }
}

async function silentRefresh(accountId: string): Promise<{ authToken: string; storageState: unknown }> {
  await ensureDefaultProfileInitialized();

  try {
    const refreshed = await refreshWithPersistentProfile(accountId);

    writeAuthMeta(accountId, {
      accountId,
      status: "ready",
      lastCheckedAt: new Date().toISOString(),
      lastRefreshedAt: new Date().toISOString(),
    });

    return refreshed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ accountId, err: error }, "Notebook auth refresh failed");
    if (error instanceof AuthRequiredError) {
      throw error;
    }

    const storageState = readStorageState(accountId);
    if (storageState.ok && storageState.value) {
      const cookieData = extractCookieData(storageState.value);
      if (cookieData) {
        try {
          const refreshClient = new RefreshClient(cookieData.cookieHeader);
          await refreshClient.refreshCredentials();

          const authToken = await fetchAuthToken(cookieData.cookieHeader);
          return { authToken, storageState: storageState.value };
        } catch (fallbackError) {
          throw new NotebookRequestAuthError(fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
        }
      }
    }

    throw new NotebookRequestAuthError(message);
  }
}

configureAuthManager({
  now: () => new Date(),
  createRuntimeClient,
  silentRefresh: async (accountId) => await silentRefresh(accountId),
  validateProfile,
  disposeRuntimeClient: async (client) => {
    client.dispose();
  },
}, buildAlertSink({ logger, fetch }));

export async function disposeClient(): Promise<void> {
  await authFlowMutex.runExclusive(() => authManager.invalidateAuthClient(DEFAULT_ACCOUNT_ID));
}

function extractChatResponseText(result: {
  text?: string;
  rawData?: unknown;
  chunks?: Array<{ text?: string; response?: string }>;
}): string {
  if (typeof result.text === "string" && result.text.trim().length > 0) {
    return result.text.trim();
  }

  const rawData = result.rawData;
  if (Array.isArray(rawData) && rawData.length > 0) {
    const first = rawData[0];
    if (Array.isArray(first) && typeof first[0] === "string" && first[0].trim().length > 0) {
      return first[0].trim();
    }
    if (typeof first === "string" && first.trim().length > 0) {
      return first.trim();
    }
  }

  const longestChunk = (result.chunks ?? [])
    .map((chunk) => (chunk.text && chunk.text.trim()) || (chunk.response && chunk.response.trim()) || "")
    .sort((a, b) => b.length - a.length)[0];

  return longestChunk?.trim() ?? "";
}

function buildChatContextItems(request: {
  sourceIds?: string[];
  conversationId?: string;
  messageIds?: [string, string];
}): string[][][] {
  if (request.conversationId && request.messageIds?.[1]) {
    return [
      [[request.conversationId]],
      [[request.messageIds[1]]],
    ];
  }

  return (request.sourceIds ?? []).map((sourceId) => [[sourceId]]);
}

function summarizeUnknownShape(value: unknown): string {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function summarizeChunk(chunk: { text?: string; response?: string; isError?: boolean; errorCode?: number; rawData?: unknown }): string {
  return [
    `text:${chunk.text?.length ?? 0}`,
    `response:${chunk.response?.length ?? 0}`,
    `error:${chunk.isError ? "true" : "false"}`,
    `code:${chunk.errorCode ?? "none"}`,
    `rawData:${summarizeUnknownShape(chunk.rawData)}`,
  ].join(",");
}

function formatEmptyChatResponseError(result: {
  text?: string;
  rawData?: unknown;
  chunks?: Array<{ text?: string; response?: string; isError?: boolean; errorCode?: number; rawData?: unknown }>;
  conversationId?: string;
  messageIds?: [string, string];
}): string {
  const firstChunk = result.chunks?.[0];
  const details = [
    result.conversationId ? `conversationId=${result.conversationId}` : "conversationId=none",
    result.messageIds ? `messageIds=${result.messageIds.join(",")}` : "messageIds=none",
    `rawData=${summarizeUnknownShape(result.rawData)}`,
    `chunks=${result.chunks?.length ?? 0}`,
    `firstChunk=${firstChunk ? summarizeChunk(firstChunk) : "none"}`,
  ];

  return `Empty response from NotebookLM (${details.join(", ")})`;
}

function extractNotebookChatError(result: {
  chunks?: Array<{ isError?: boolean; errorCode?: number }>;
  text?: string;
  rawData?: unknown;
  conversationId?: string;
  messageIds?: [string, string];
}): string {
  const errorChunk = result.chunks?.find((chunk) => chunk.isError && typeof chunk.errorCode === "number");
  if (errorChunk?.errorCode !== undefined) {
    if (errorChunk.errorCode === 8) {
      return "您已达到每日对话次数上限，改日再来吧！";
    }

    const definition = getErrorCode(errorChunk.errorCode);
    if (definition) {
      return `NotebookLM 错误: ${definition.message} (code: ${definition.code})`;
    }
    return `NotebookLM 错误: code ${errorChunk.errorCode}`;
  }

  return formatEmptyChatResponseError(result);
}

export const __testOnly = {
  get importPlaywright() {
    return testHooks.importPlaywright;
  },
  set importPlaywright(value: typeof defaultImportPlaywright) {
    testHooks.importPlaywright = value;
  },
  get canAttemptSilentRefreshOverride() {
    return testHooks.canAttemptSilentRefresh;
  },
  set canAttemptSilentRefreshOverride(value: ((accountId: string) => boolean) | null) {
    testHooks.canAttemptSilentRefresh = value;
  },
  createRuntimeClientForTests: createRuntimeClient,
  extractAuthTokenFromHtml,
  silentRefreshForTests: silentRefresh,
  extractChatResponseText,
  buildChatContextItems,
  formatEmptyChatResponseError,
  extractNotebookChatError,
  mergeHistoryMessages,
  createKeyedRequestGate,
};

export async function getAuthStatus(): Promise<AuthStatus> {
  await ensureDefaultProfileInitialized();
  return await authManager.getAuthProfileStatus(DEFAULT_ACCOUNT_ID);
}

async function getClient(): Promise<NotebookLMClient> {
  const client = await authManager.getAuthenticatedSdkClient(DEFAULT_ACCOUNT_ID);
  return client as NotebookLMClient;
}

async function runNotebookRequest<T>(operationKey: OperationKey, operation: (client: NotebookLMClient) => Promise<T>): Promise<T> {
  return requestGate.run(operationKey, async () => {
    // Acquire client under auth-flow lock so concurrent callers don't race on shared auth state.
    const client = await authFlowMutex.runExclusive(() => getClient());

    try {
      return await operation(client);
    } catch (error) {
      if (!isRecognizedAuthFailure(error)) {
        throw error;
      }

      // Auth failure: invalidate and refresh under auth-flow lock, then retry once.
      const retryClient = await authFlowMutex.runExclusive(async () => {
        await authManager.invalidateAuthClient(DEFAULT_ACCOUNT_ID);

        if (!canAttemptSilentRefresh(DEFAULT_ACCOUNT_ID)) {
          throw new NotebookRequestAuthError(error instanceof Error ? error.message : String(error));
        }

        const status = await authManager.refreshAuthProfile(DEFAULT_ACCOUNT_ID, "request-retry");
        if (status.status !== "ready") {
          throw new NotebookRequestAuthError(status.error ?? "Notebook authentication is unavailable");
        }

        return getClient();
      });

      try {
        return await operation(retryClient);
      } catch (retryError) {
        if (isRecognizedAuthFailure(retryError)) {
          throw new NotebookRequestAuthError(retryError instanceof Error ? retryError.message : String(retryError));
        }
        throw retryError;
      }
    }
  });
}

export async function listNotebooks(): Promise<NotebookDetail[]> {
  try {
    const notebooks = await runNotebookRequest("notebooks.read", async (client) => await client.notebooks.list());
    return notebooks.map(mapNotebook);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Permission denied")) {
      throw error;
    }

    logger.warn({ err: error }, "listNotebooks: notebooklm-kit list denied, falling back to browser home data");
    return await listNotebooksFromPersistentBrowser(DEFAULT_ACCOUNT_ID);
  }
}

export function extractNotebookId(url: string): string {
  const match = url.match(/notebook\/([a-f0-9-]+)/i);
  if (!match?.[1]) {
    throw new Error(`Cannot extract notebook ID from URL: ${url}`);
  }
  return match[1];
}

export async function askNotebook(notebookId: string, question: string): Promise<AskResult> {
  try {
    let quotaConsumed = false;
    const result = await runNotebookRequest("generation.chat", async (client) => {
      if (!quotaConsumed) {
        const quota = getQuotaStatus();
        if (quota.remaining !== null && quota.remaining <= 0) {
          throw new Error(`Daily quota exceeded (${quota.limit}/day). Try again tomorrow.`);
        }
        consumeQuota();
        quotaConsumed = true;
      }
      return await client.generation.chat(notebookId, question);
    });

    if (!result?.text) {
      return { success: false, error: "Empty response from NotebookLM" };
    }

    return { success: true, answer: result.text, citations: result.citations || [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("expired") || message.includes("401")) {
      await disposeClient();
    }
    return { success: false, error: message };
  }
}

function normalizeSourceType(type: SourceType | undefined): NotebookSource["type"] {
  switch (type) {
    case SourceType.PDF:
    case SourceType.PDF_FROM_DRIVE:
      return "pdf";
    case SourceType.URL:
      return "web";
    case SourceType.TEXT:
    case SourceType.TEXT_NOTE:
      return "text";
    case SourceType.YOUTUBE_VIDEO:
      return "youtube";
    case SourceType.GOOGLE_DRIVE:
    case SourceType.GOOGLE_SLIDES:
      return "drive";
    case SourceType.IMAGE:
    case SourceType.VIDEO_FILE:
      return "image";
    default:
      return "unknown";
  }
}

function normalizeSourceStatus(status: SourceStatus | undefined): NotebookSource["status"] {
  switch (status) {
    case SourceStatus.READY:
      return "ready";
    case SourceStatus.PROCESSING:
      return "processing";
    case SourceStatus.FAILED:
      return "failed";
    default:
      return "unknown";
  }
}

function mapSource(s: Source): NotebookSource {
  return {
    id: s.sourceId,
    title: s.title ?? s.sourceId,
    type: normalizeSourceType(s.type),
    sourceTypeRaw: s.type !== undefined ? String(s.type) : undefined,
    status: normalizeSourceStatus(s.status),
    ...(s.url ? { url: s.url } : {}),
  };
}

function mapNotebook(nb: Notebook): NotebookDetail {
  return {
    id: nb.projectId,
    title: nb.title ?? nb.projectId,
    description: "",
    updatedAt: nb.updatedAt ?? nb.lastAccessed ?? "",
  };
}

function normalizeNotebookListEntry(entry: NotebookListHomeResponse[number]): NotebookDetail | null {
  const title = typeof entry[0] === "string" && entry[0].trim().length > 0 ? entry[0].trim() : null;
  const id = typeof entry[2] === "string" && entry[2].trim().length > 0 ? entry[2].trim() : null;
  const metadata = Array.isArray(entry[5]) ? entry[5] : null;
  const updated = metadata && Array.isArray(metadata[5]) ? metadata[5] as [number, number] : undefined;

  if (!title || !id) {
    return null;
  }

  return {
    id,
    title,
    description: "",
    updatedAt: toIsoTimestamp(updated),
  };
}

function extractWrbPayload(text: string, rpcId: string): string | null {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (!line.startsWith("[[")) continue;

    try {
      const parsed = JSON.parse(line) as unknown[];
      for (const chunk of parsed) {
        if (!Array.isArray(chunk)) continue;
        if (chunk[0] !== "wrb.fr" || chunk[1] !== rpcId || typeof chunk[2] !== "string") continue;
        return chunk[2];
      }
    } catch {
      continue;
    }
  }

  return null;
}

function parseNotebookListFromHomeRpc(text: string): NotebookDetail[] {
  const payload = extractWrbPayload(text, "wXbhsf");
  if (!payload) {
    throw new Error("Failed to parse notebook list response from home RPC");
  }

  const parsed = JSON.parse(payload) as unknown;
  if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) {
    throw new Error("Unexpected notebook list payload shape from home RPC");
  }

  const rows = typeof parsed[0][0] === "string"
    ? parsed as NotebookListHomeResponse
    : parsed[0] as NotebookListHomeResponse;

  return rows
    .map(normalizeNotebookListEntry)
    .filter((entry): entry is NotebookDetail => entry !== null);
}

async function listNotebooksFromPersistentBrowser(accountId: string): Promise<NotebookDetail[]> {
  const { chromium } = await testHooks.importPlaywright();
  const paths = getProfilePaths(accountId);
  const context = await chromium.launchPersistentContext(paths.browserUserDataDir, {
    headless: true,
    channel: "chrome",
  });

  try {
    const page = context.pages?.()[0] ?? await context.newPage();
    let notebookResponseText: string | null = null;

    page.on("response", async (response) => {
      if (!response.url().includes("rpcids=wXbhsf")) {
        return;
      }

      notebookResponseText = await response.text().catch(() => null);
    });

    await page.goto("https://notebooklm.google.com/", { waitUntil: "networkidle", timeout: 60000 });
    await verifyNotebookPageAuthenticated(page);

    if (!notebookResponseText) {
      throw new Error("Notebook home page did not expose notebook list RPC response");
    }

    return parseNotebookListFromHomeRpc(notebookResponseText);
  } finally {
    await context.close();
  }
}

function parseRpcJson<T>(value: unknown): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value as T;
}

function toIsoTimestamp(timestamp: [seconds: number, nanos: number] | undefined): string {
  if (!timestamp || typeof timestamp[0] !== "number") {
    return new Date(0).toISOString();
  }

  const [seconds, nanos] = timestamp;
  return new Date((seconds * 1000) + Math.floor((nanos ?? 0) / 1_000_000)).toISOString();
}

function extractAssistantText(content: unknown[]): string {
  const firstEntry = content[0];
  if (!Array.isArray(firstEntry) || typeof firstEntry[0] !== "string") {
    return "";
  }

  return firstEntry[0];
}

function mapHistoryMessage(record: NotebookHistoryMessageRecord): NotebookMessage {
  const role = record[2] === 1 ? "user" : "assistant";
  const content = record[2] === 1 ? record[3] : extractAssistantText(record[4]);

  return {
    id: record[0],
    role,
    content,
    createdAt: toIsoTimestamp(record[1]),
    status: "done",
  };
}

async function listNotebookHistoryThreadIds(client: NotebookLMClient, notebookId: string): Promise<string[]> {
  const response = await client.rpc("hPTbtc", [[], null, notebookId, 20], notebookId);
  const parsed = parseRpcJson<NotebookHistoryThreadIdResponse>(response);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .flatMap((group) => Array.isArray(group) ? group : [])
    .map((entry) => Array.isArray(entry) ? entry[0] : null)
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

async function listNotebookHistoryMessages(
  client: NotebookLMClient,
  notebookId: string,
  threadId: string,
): Promise<NotebookMessage[]> {
  const response = await client.rpc("khqZz", [[], null, null, threadId, 20], notebookId);
  const parsed = parseRpcJson<unknown>(response);
  const records = Array.isArray(parsed)
    ? (Array.isArray(parsed[0]) ? parsed[0] : parsed)
    : null;

  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .filter((record): record is NotebookHistoryMessageRecord => Array.isArray(record) && typeof record[0] === "string")
    .map(mapHistoryMessage)
    .filter((message) => message.content.trim().length > 0)
    .reverse();
}

export async function getNotebookDetail(notebookId: string): Promise<NotebookDetail> {
  try {
    const notebook = await runNotebookRequest("notebooks.read", async (client) => await client.notebooks.get(notebookId));
    return mapNotebook(notebook);
  } catch (err) {
    if (isNotebookAuthError(err)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Permission denied")) {
      throw new Error("Permission denied");
    }
    logger.warn({ notebookId, err }, "getNotebookDetail: sdk.notebooks.get failed");
    throw new Error(`Failed to fetch notebook detail: ${message}`);
  }
}

export async function getNotebookSources(notebookId: string): Promise<NotebookSource[]> {
  const attempt = async () =>
    runNotebookRequest("sources.read", async (client) => await client.sources.list(notebookId));

  try {
    try {
      const sources = await attempt();
      return sources.map(mapSource);
    } catch (firstErr) {
      if (isNotebookAuthError(firstErr)) {
        throw firstErr;
      }
      // 瞬时网络抖动（fetch failed）：等 1 秒后重试一次
      logger.warn({ notebookId, firstErr }, "getNotebookSources: first attempt failed, retrying in 1s");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const sources = await attempt();
      return sources.map(mapSource);
    }
  } catch (err) {
    if (isNotebookAuthError(err)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ notebookId, err }, "getNotebookSources: sdk.sources.list failed after retry");
    throw new Error(`Failed to fetch notebook sources: ${message}`);
  }
}

export async function getNotebookMessages(
  notebookId: string,
  options: { hiddenThreadIds?: string[]; activeThreadId?: string } = {}
): Promise<NotebookMessage[]> {
  const messages = await runNotebookRequest("history.rpc", async (client) => {
    const threadIds = await listNotebookHistoryThreadIds(client, notebookId);
    logger.info(
      {
        notebookId,
        threadCount: threadIds.length,
        threadIds,
        activeThreadId: options.activeThreadId ?? null,
        hiddenThreadIds: options.hiddenThreadIds ?? [],
      },
      "getNotebookMessages: threads fetched"
    );

    const orderedThreadIds = [
      ...(options.activeThreadId ? [options.activeThreadId] : []),
      ...threadIds.filter((threadId) => threadId !== options.activeThreadId),
    ];

    if (orderedThreadIds.length === 0) {
      logger.info({ notebookId }, "getNotebookMessages: no threads found, returning empty");
      return [];
    }

    const threadMessages: NotebookMessage[][] = [];
    for (const threadId of orderedThreadIds) {
      threadMessages.push(await listNotebookHistoryMessages(client, notebookId, threadId));
    }

    const merged = mergeHistoryMessages(threadMessages, options.hiddenThreadIds ?? [], orderedThreadIds);
    logger.info({ notebookId, messageCount: merged.length }, "getNotebookMessages: merged");
    return merged;
  });

  return messages;
}

export async function askNotebookForResearch(
  notebookId: string,
  prompt: string,
  sourceIds?: string[]
): Promise<ResearchAskResult> {
  try {
    let quotaConsumed = false;
    const result = await runNotebookRequest("generation.chat",
      async (client) => {
        if (!quotaConsumed) {
          const quota = getQuotaStatus();
          if (quota.remaining !== null && quota.remaining <= 0) {
            throw new Error(`Daily quota exceeded (${quota.limit}/day). Try again tomorrow.`);
          }
          consumeQuota();
          quotaConsumed = true;
        }
        return await client.generation.chat(notebookId, prompt, sourceIds?.length ? { sourceIds } : undefined);
      }
    );
    const text = extractChatResponseText(result);

    if (!text) {
      return { success: false, error: extractNotebookChatError(result) };
    }

    return { success: true, answer: text, citations: result.citations || [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("expired") || message.includes("401")) await disposeClient();
    return { success: false, error: message };
  }
}

export async function sendNotebookChatMessage(
  notebookId: string,
  request: NotebookChatRequest
): Promise<NotebookChatResponse> {
  try {
    const reqStart = Date.now();
    let quotaConsumed = false;
    const result = await runNotebookRequest("generation.chat", async (client) => {
      if (!quotaConsumed) {
        const quota = getQuotaStatus();
        if (quota.remaining !== null && quota.remaining <= 0) {
          throw new Error(`Daily quota exceeded (${quota.limit}/day). Try again tomorrow.`);
        }
        consumeQuota();
        quotaConsumed = true;
        const quotaAfter = getQuotaStatus();
        logger.info(
          {
            notebookId,
            promptChars: request.prompt.length,
            hasConversationId: !!request.conversationId,
            quotaUsed: quotaAfter.used,
            quotaLimit: quotaAfter.limit ?? "unlimited",
          },
          "notebooklm: sending chat message"
        );
      }
      return await client.generation.chat(notebookId, request.prompt, {
        sourceIds: request.sourceIds,
        conversationId: request.conversationId,
        conversationHistory: request.conversationHistory,
      });
    });
    const text = extractChatResponseText(result);

    if (!text) {
      throw new Error(extractNotebookChatError(result));
    }

    logger.info(
      { notebookId, responseChars: text.length, durationMs: Date.now() - reqStart },
      "notebooklm: chat message received"
    );

    return {
      text,
      conversationId: result.conversationId,
      messageIds: result.messageIds,
      citations: result.citations || [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("expired") || message.includes("401")) {
      await disposeClient();
    }
    throw err;
  }
}

export async function ensureNotebookAccessible(notebookId: string): Promise<AccessCheckResult> {
  try {
    await runNotebookRequest("notebooks.read", async (client) => {
      await client.notebooks.get(notebookId);
      return null;
    });
    return { accessible: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ notebookId, err }, "ensureNotebookAccessible: notebook.get failed");
    return { accessible: false, error: message };
  }
}

function normalizeAddSourceResult(result: string | AddSourceResult): SourceAddResponse {
  if (typeof result === "string") {
    return { sourceIds: [result], wasChunked: false };
  }

  return {
    sourceIds: result.allSourceIds ?? result.sourceIds ?? [],
    wasChunked: Boolean(result.wasChunked),
  };
}

export async function addSourceFromUrl(
  notebookId: string,
  input: { url: string; title?: string }
): Promise<SourceAddResponse> {
  const sourceId = await runNotebookRequest("sources.write", async (client) => await client.sources.addFromURL(notebookId, input));
  return { sourceIds: [sourceId], wasChunked: false };
}

export async function addSourceFromText(
  notebookId: string,
  input: { title: string; content: string }
): Promise<SourceAddResponse> {
  const result = await runNotebookRequest("sources.write", async (client) => await client.sources.addFromText(notebookId, input));
  return normalizeAddSourceResult(result);
}

export async function addSourceFromFile(
  notebookId: string,
  input: { fileName: string; content: Buffer; mimeType?: string }
): Promise<SourceAddResponse> {
  const result = await runNotebookRequest("sources.write", async (client) => await client.sources.addFromFile(notebookId, input));
  return normalizeAddSourceResult(result);
}

export async function searchWebSources(
  notebookId: string,
  input: SourceSearchInput
): Promise<WebSearchResult> {
  return await runNotebookRequest("sources.search", async (client) => await client.sources.searchWebAndWait(notebookId, {
    query: input.query,
    mode: input.mode === "deep" ? ResearchMode.DEEP : ResearchMode.FAST,
    sourceType: input.sourceType === "drive" ? SearchSourceType.GOOGLE_DRIVE : SearchSourceType.WEB,
  }));
}

export async function addDiscoveredSources(
  notebookId: string,
  input: AddDiscoveredSourcesOptions
): Promise<{ sourceIds: string[] }> {
  const sourceIds = await runNotebookRequest("sources.write", async (client) => await client.sources.addDiscovered(notebookId, input));
  return { sourceIds };
}

export async function getSourceProcessingStatus(notebookId: string): Promise<SourceProcessingStatus> {
  return await runNotebookRequest("sources.read", async (client) => await client.sources.status(notebookId));
}

export async function deleteSource(notebookId: string, sourceId: string): Promise<void> {
  await runNotebookRequest("sources.write", async (client) => await client.sources.delete(notebookId, sourceId));
}

export interface CreateNotebookInput {
  title: string;
}

export async function createNotebook(input: CreateNotebookInput): Promise<NotebookDetail> {
  try {
    const notebook = await runNotebookRequest("notebooks.write", async (client) =>
      await client.notebooks.create({ title: input.title })
    );
    return mapNotebook(notebook);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ input, err }, "createNotebook: sdk.notebooks.create failed");
    throw new Error(`Failed to create notebook: ${message}`);
  }
}

export async function deleteNotebook(notebookId: string): Promise<void> {
  try {
    await runNotebookRequest("notebooks.write", async (client) => {
      await client.notebooks.delete(notebookId);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ notebookId, err }, "deleteNotebook: sdk.notebooks.delete failed");
    throw new Error(`Failed to delete notebook: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Artifact operations
// ---------------------------------------------------------------------------

export { ArtifactType, ArtifactState };
export type { Artifact, CreateArtifactOptions };

export interface CreateArtifactResult {
  artifactId: string;
  state: string;
}

const ARTIFACT_TYPE_MAP: Record<string, ArtifactType> = {
  audio: ArtifactType.AUDIO,
  video: ArtifactType.VIDEO,
  slide_deck: ArtifactType.SLIDE_DECK,
  mind_map: ArtifactType.MIND_MAP,
  report: ArtifactType.REPORT,
  flashcards: ArtifactType.FLASHCARDS,
  quiz: ArtifactType.QUIZ,
  infographic: ArtifactType.INFOGRAPHIC,
};

function resolveArtifactType(type: string): ArtifactType {
  const resolved = ARTIFACT_TYPE_MAP[type.toLowerCase()];
  if (resolved === undefined) {
    throw new Error(`Unknown artifact type: "${type}". Valid types: ${Object.keys(ARTIFACT_TYPE_MAP).join(", ")}`);
  }
  return resolved;
}

function artifactStateLabel(state: ArtifactState | undefined): string {
  switch (state) {
    case ArtifactState.CREATING:
      return "creating";
    case ArtifactState.READY:
      return "ready";
    case ArtifactState.FAILED:
      return "failed";
    default:
      return "unknown";
  }
}

/**
 * Create an artifact in a notebook.
 * Routes to the correct SDK sub-service based on `type` string.
 */
export async function createArtifact(
  notebookId: string,
  type: string,
  options?: CreateArtifactOptions,
): Promise<CreateArtifactResult> {
  const artifactType = resolveArtifactType(type);

  const result = await runNotebookRequest("artifacts.write", async (client) => {
    // different id fields, so we route them separately. All other types go
    // through the generic `artifacts.create` which accepts CreateArtifactOptions.
    switch (artifactType) {
      case ArtifactType.AUDIO:
        {
          const artifacts = await client.artifacts.list(notebookId);
          for (const artifact of artifacts) {
            if (artifact.type === ArtifactType.AUDIO && artifact.artifactId) {
              await client.artifacts.delete(artifact.artifactId, notebookId);
            }
          }
        }
        return await client.artifacts.audio.create(notebookId, options as Parameters<typeof client.artifacts.audio.create>[1]);
      case ArtifactType.VIDEO:
        return await client.artifacts.video.create(notebookId, options as Parameters<typeof client.artifacts.video.create>[1]);
      default:
        return await client.artifacts.create(notebookId, artifactType, options);
    }
  });

  // Audio/Video sub-services return AudioOverview/VideoOverview with different id fields
  const artifactId = (result as Artifact).artifactId
    ?? (result as { audioId?: string }).audioId
    ?? (result as { videoId?: string }).videoId
    ?? "";

  return {
    artifactId,
    state: artifactStateLabel((result as Artifact).state),
  };
}

/**
 * Get a single artifact by ID.
 */
export async function getArtifact(notebookId: string, artifactId: string): Promise<Artifact> {
  return await runNotebookRequest("artifacts.read", async (client) =>
    await client.artifacts.get(artifactId, notebookId) as Artifact
  );
}

/**
 * List all artifacts in a notebook.
 */
export async function listArtifacts(notebookId: string): Promise<Artifact[]> {
  return await runNotebookRequest("artifacts.read", async (client) =>
    await client.artifacts.list(notebookId)
  );
}
