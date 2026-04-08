/**
 * NotebookLM gateway — wraps notebooklm-kit SDK operations behind the auth manager.
 */

import { existsSync, readFileSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import type { BrowserContext, Page } from "playwright";
import {
  NotebookLMClient,
  NotebookLMAuthError,
  RefreshClient,
  ResearchMode,
  SearchSourceType,
  SourceType,
  SourceStatus,
} from "notebooklm-kit";
import type { Notebook, Source } from "notebooklm-kit";
import type {
  AddDiscoveredSourcesOptions,
  AddSourceResult,
  SourceProcessingStatus,
  WebSearchResult,
} from "notebooklm-kit";
import { getQuotaStatus, consumeQuota } from "../lib/quota.js";
import logger from "../lib/logger.js";
import {
  authManager,
  configureAuthManager,
  DEFAULT_ACCOUNT_ID,
  type RuntimeClientLike,
} from "./auth-manager.js";
import {
  ensureProfileDirectories,
  getLegacyStorageStatePath,
  getProfilePaths,
  readAuthMeta,
  readStorageState,
  writeAuthMeta,
  writeStorageState,
  type AuthMeta,
  type AuthState,
} from "./auth-profile.js";

const ALLOWED_DOMAINS = [
  ".google.com",
  "notebooklm.google.com",
  ".notebooklm.google.com",
  "accounts.google.com",
  ".googleusercontent.com",
];

const testHooks = {
  importPlaywright: defaultImportPlaywright,
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

export interface NotebookMessagesResult {
  messages: NotebookMessage[];
  degraded: boolean;
}

type NotebookHistoryThreadIdResponse = Array<Array<[string]>>;

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
  conversationHistory?: NotebookChatHistoryItem[];
}

export interface NotebookChatResponse {
  text: string;
  conversationId?: string;
  messageIds?: [string, string];
  citations: unknown[];
}

export type ResearchAskResult = AskResult;

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
  const cookieData = loadCookiesFromProfile(accountId);
  if (!cookieData) return false;
  return cookieData.cookieHeader.includes("SAPISID=");
}

async function fetchAuthToken(cookieHeader: string): Promise<string> {
  const resp = await fetch("https://notebooklm.google.com/", {
    headers: {
      Cookie: cookieHeader,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    redirect: "manual",
  });

  if (resp.status !== 200) {
    const location = resp.headers.get("location") || "";
    if (location.includes("accounts.google.com")) {
      throw new Error('Session expired. Run "npx notebooklm login" to re-authenticate.');
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
  const { chromium } = await testHooks.importPlaywright();
  const paths = getProfilePaths(accountId);
  const context = await chromium.launchPersistentContext(paths.browserUserDataDir, {
    headless: true,
  });

  try {
    const page = await context.newPage();
    await page.goto("https://notebooklm.google.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await verifyNotebookPageAuthenticated(page);

    const storageState = await exportPersistentContextState(context, accountId);
    const cookieData = extractCookieData(storageState);
    if (!cookieData) {
      throw new NotebookRequestAuthError("No valid Google cookies found after refresh");
    }

    const authToken = await fetchAuthToken(cookieData.cookieHeader);
    return { authToken, storageState };
  } finally {
    await context.close();
  }
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

  const cookieData = loadCookiesFromProfile(accountId);
  if (!cookieData) {
    throw new AuthRequiredError('No authentication found. Run "npx notebooklm login" first.');
  }

  const authToken = await fetchAuthToken(cookieData.cookieHeader);
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
});

export async function disposeClient(): Promise<void> {
  await authManager.invalidateAuthClient(DEFAULT_ACCOUNT_ID);
}

export const __testOnly = {
  get importPlaywright() {
    return testHooks.importPlaywright;
  },
  set importPlaywright(value: typeof defaultImportPlaywright) {
    testHooks.importPlaywright = value;
  },
  silentRefreshForTests: silentRefresh,
};

export async function getAuthStatus(): Promise<AuthStatus> {
  await ensureDefaultProfileInitialized();
  return await authManager.getAuthProfileStatus(DEFAULT_ACCOUNT_ID);
}

async function getClient(): Promise<NotebookLMClient> {
  const client = await authManager.getAuthenticatedSdkClient(DEFAULT_ACCOUNT_ID);
  return client as NotebookLMClient;
}

async function runNotebookRequest<T>(operation: (client: NotebookLMClient) => Promise<T>): Promise<T> {
  const client = await getClient();

  try {
    return await operation(client);
  } catch (error) {
    if (!isRecognizedAuthFailure(error)) {
      throw error;
    }

    await authManager.invalidateAuthClient(DEFAULT_ACCOUNT_ID);

    if (!canAttemptSilentRefresh(DEFAULT_ACCOUNT_ID)) {
      throw new NotebookRequestAuthError(error instanceof Error ? error.message : String(error));
    }

    const status = await authManager.refreshAuthProfile(DEFAULT_ACCOUNT_ID, "request-retry");
    if (status.status !== "ready") {
      throw new NotebookRequestAuthError(status.error ?? "Notebook authentication is unavailable");
    }

    const retryClient = await getClient();
    try {
      return await operation(retryClient);
    } catch (retryError) {
      if (isRecognizedAuthFailure(retryError)) {
        throw new NotebookRequestAuthError(retryError instanceof Error ? retryError.message : String(retryError));
      }

      throw retryError;
    }
  }
}

export async function listNotebooks(): Promise<NotebookDetail[]> {
  const notebooks = await runNotebookRequest(async (client) => await client.notebooks.list());
  return notebooks.map(mapNotebook);
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
    const quota = getQuotaStatus();
    if (quota.remaining <= 0) {
      return { success: false, error: `Daily quota exceeded (${quota.limit}/day). Try again tomorrow.` };
    }

    consumeQuota();
    const result = await runNotebookRequest(async (client) => await client.generation.chat(notebookId, question));

    if (!result?.text) {
      return { success: false, error: "Empty response from NotebookLM" };
    }

    return { success: true, answer: result.text, citations: result.citations || [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("expired") || message.includes("401")) {
      disposeClient();
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
    const notebook = await runNotebookRequest(async (client) => await client.notebooks.get(notebookId));
    return mapNotebook(notebook);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ notebookId, err }, "getNotebookDetail: sdk.notebooks.get failed");
    throw new Error(`Failed to fetch notebook detail: ${message}`);
  }
}

export async function getNotebookSources(notebookId: string): Promise<NotebookSource[]> {
  try {
    const sources = await runNotebookRequest(async (client) => await client.sources.list(notebookId));
    return sources.map(mapSource);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ notebookId, err }, "getNotebookSources: sdk.sources.list failed");
    throw new Error(`Failed to fetch notebook sources: ${message}`);
  }
}

export async function getNotebookMessages(notebookId: string): Promise<NotebookMessagesResult> {
  try {
    const messages = await runNotebookRequest(async (client) => {
      const threadIds = await listNotebookHistoryThreadIds(client, notebookId);
      const latestThreadId = threadIds[0];

      if (!latestThreadId) {
        return [];
      }

      return await listNotebookHistoryMessages(client, notebookId, latestThreadId);
    });

    return { messages, degraded: false };
  } catch (err) {
    logger.warn({ notebookId, err }, "getNotebookMessages: direct history read failed; returning degraded empty result");
    return { messages: [], degraded: true };
  }
}

export async function askNotebookForResearch(
  notebookId: string,
  prompt: string,
  sourceIds?: string[]
): Promise<ResearchAskResult> {
  try {
    const quota = getQuotaStatus();
    if (quota.remaining <= 0) {
      return { success: false, error: `Daily quota exceeded (${quota.limit}/day). Try again tomorrow.` };
    }

    consumeQuota();
    const result = await runNotebookRequest(
      async (client) => await client.generation.chat(notebookId, prompt, sourceIds?.length ? { sourceIds } : undefined)
    );

    if (!result?.text) {
      return { success: false, error: "Empty response from NotebookLM" };
    }

    return { success: true, answer: result.text, citations: result.citations || [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("expired") || message.includes("401")) disposeClient();
    return { success: false, error: message };
  }
}

export async function sendNotebookChatMessage(
  notebookId: string,
  request: NotebookChatRequest
): Promise<NotebookChatResponse> {
  try {
    const quota = getQuotaStatus();
    if (quota.remaining <= 0) {
      throw new Error(`Daily quota exceeded (${quota.limit}/day). Try again tomorrow.`);
    }

    consumeQuota();
    const result = await runNotebookRequest(async (client) => await client.generation.chat(notebookId, request.prompt, {
      sourceIds: request.sourceIds,
      conversationId: request.conversationId,
      conversationHistory: request.conversationHistory,
    }));

    if (!result?.text) {
      throw new Error("Empty response from NotebookLM");
    }

    return {
      text: result.text,
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
    await runNotebookRequest(async (client) => {
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
  const sourceId = await runNotebookRequest(async (client) => await client.sources.addFromURL(notebookId, input));
  return { sourceIds: [sourceId], wasChunked: false };
}

export async function addSourceFromText(
  notebookId: string,
  input: { title: string; content: string }
): Promise<SourceAddResponse> {
  const result = await runNotebookRequest(async (client) => await client.sources.addFromText(notebookId, input));
  return normalizeAddSourceResult(result);
}

export async function addSourceFromFile(
  notebookId: string,
  input: { fileName: string; content: Buffer; mimeType?: string }
): Promise<SourceAddResponse> {
  const result = await runNotebookRequest(async (client) => await client.sources.addFromFile(notebookId, input));
  return normalizeAddSourceResult(result);
}

export async function searchWebSources(
  notebookId: string,
  input: SourceSearchInput
): Promise<WebSearchResult> {
  return await runNotebookRequest(async (client) => await client.sources.searchWebAndWait(notebookId, {
    query: input.query,
    mode: input.mode === "deep" ? ResearchMode.DEEP : ResearchMode.FAST,
    sourceType: input.sourceType === "drive" ? SearchSourceType.GOOGLE_DRIVE : SearchSourceType.WEB,
  }));
}

export async function addDiscoveredSources(
  notebookId: string,
  input: AddDiscoveredSourcesOptions
): Promise<{ sourceIds: string[] }> {
  const sourceIds = await runNotebookRequest(async (client) => await client.sources.addDiscovered(notebookId, input));
  return { sourceIds };
}

export async function getSourceProcessingStatus(notebookId: string): Promise<SourceProcessingStatus> {
  return await runNotebookRequest(async (client) => await client.sources.status(notebookId));
}

export interface CreateNotebookInput {
  title: string;
}

export async function createNotebook(input: CreateNotebookInput): Promise<NotebookDetail> {
  try {
    const notebook = await runNotebookRequest(async (client) =>
      await client.notebooks.create({ title: input.title })
    );
    return mapNotebook(notebook);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ input, err }, "createNotebook: sdk.notebooks.create failed");
    throw new Error(`Failed to create notebook: ${message}`);
  }
}
