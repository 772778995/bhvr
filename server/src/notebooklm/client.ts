/**
 * NotebookLM client — wraps notebooklm-kit SDK.
 * Handles authentication via saved cookies from `notebooklm login` CLI,
 * and provides methods for the research workflow.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { NotebookLMClient, SourceType, SourceStatus } from "notebooklm-kit";
import type { Notebook, Source } from "notebooklm-kit";
import { getQuotaStatus, consumeQuota } from "../lib/quota.js";
import logger from "../lib/logger.js";

const STORAGE_STATE_PATH = resolve(homedir(), ".notebooklm", "storage-state.json");

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

export type ResearchAskResult = AskResult;

export interface AccessCheckResult {
  accessible: boolean;
  error?: string;
}

let sdkInstance: NotebookLMClient | null = null;

function loadCookies(): { cookieHeader: string; cookieCount: number } | null {
  if (!existsSync(STORAGE_STATE_PATH)) return null;

  const storageState = JSON.parse(readFileSync(STORAGE_STATE_PATH, "utf-8"));
  const rawCookies = storageState.cookies;
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

async function getClient(): Promise<NotebookLMClient> {
  if (sdkInstance) return sdkInstance;

  const cookieData = loadCookies();
  if (!cookieData) {
    throw new Error('No authentication found. Run "npx notebooklm login" first.');
  }

  const authToken = await fetchAuthToken(cookieData.cookieHeader);
  const client = new NotebookLMClient({ authToken, cookies: cookieData.cookieHeader });

  await client.connect();

  sdkInstance = client;
  return client;
}

export function disposeClient(): void {
  if (sdkInstance) {
    sdkInstance.dispose();
    sdkInstance = null;
  }
}

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

export async function listNotebooks() {
  const client = await getClient();
  return client.notebooks.list();
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

    const client = await getClient();
    consumeQuota();
    const result = await client.generation.chat(notebookId, question);

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
    updatedAt: nb.updatedAt ?? nb.lastAccessed ?? new Date().toISOString(),
  };
}

export async function getNotebookDetail(notebookId: string): Promise<NotebookDetail> {
  const client = await getClient();
  let notebook: Notebook;
  try {
    notebook = await client.notebooks.get(notebookId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("expired") || message.includes("401")) disposeClient();
    logger.warn({ notebookId, err }, "getNotebookDetail: sdk.notebooks.get failed");
    throw new Error(`Failed to fetch notebook detail: ${message}`);
  }
  return mapNotebook(notebook);
}

export async function getNotebookSources(notebookId: string): Promise<NotebookSource[]> {
  const client = await getClient();
  let sources: Source[];
  try {
    sources = await client.sources.list(notebookId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("expired") || message.includes("401")) disposeClient();
    logger.warn({ notebookId, err }, "getNotebookSources: sdk.sources.list failed");
    throw new Error(`Failed to fetch notebook sources: ${message}`);
  }
  return sources.map(mapSource);
}

export async function getNotebookMessages(notebookId: string): Promise<NotebookMessagesResult> {
  logger.debug({ notebookId }, "getNotebookMessages: SDK has no history endpoint; returning degraded empty result");
  return { messages: [], degraded: true };
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

    const client = await getClient();
    consumeQuota();
    const result = await client.generation.chat(notebookId, prompt, sourceIds?.length ? { sourceIds } : undefined);

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

export async function ensureNotebookAccessible(notebookId: string): Promise<AccessCheckResult> {
  let client: NotebookLMClient;
  try {
    client = await getClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { accessible: false, error: message };
  }

  try {
    await client.notebooks.get(notebookId);
    return { accessible: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("expired") || message.includes("401")) disposeClient();
    logger.warn({ notebookId, err }, "ensureNotebookAccessible: notebook.get failed");
    return { accessible: false, error: message };
  }
}
