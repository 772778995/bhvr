import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_ACCOUNT_ID = "default";

export type AuthState = "missing" | "ready" | "refreshing" | "expired" | "reauth_required" | "error";

export interface AuthMeta {
  accountId: string;
  status: AuthState;
  lastCheckedAt?: string;
  lastRefreshedAt?: string;
  error?: string;
}

export interface ProfilePaths {
  baseDir: string;
  browserUserDataDir: string;
  storageStatePath: string;
  authMetaPath: string;
}

export type ReadAuthMetaResult = { ok: true; value: AuthMeta } | { ok: false; error: AuthMeta };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isAuthState(value: unknown): value is AuthState {
  return value === "missing"
    || value === "ready"
    || value === "refreshing"
    || value === "expired"
    || value === "reauth_required"
    || value === "error";
}

function parseAuthMeta(accountId: string, input: unknown): ReadAuthMetaResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: { accountId, status: "error", error: "Invalid auth metadata" },
    };
  }

  const value = input.accountId;
  const status = input.status;
  const lastCheckedAt = input.lastCheckedAt;
  const lastRefreshedAt = input.lastRefreshedAt;
  const error = input.error;

  if (value !== accountId || !isAuthState(status) || !isOptionalString(lastCheckedAt) || !isOptionalString(lastRefreshedAt) || !isOptionalString(error)) {
    return {
      ok: false,
      error: { accountId, status: "error", error: "Invalid auth metadata" },
    };
  }

  return {
    ok: true,
    value: {
      accountId,
      status,
      ...(lastCheckedAt ? { lastCheckedAt } : {}),
      ...(lastRefreshedAt ? { lastRefreshedAt } : {}),
      ...(error ? { error } : {}),
    },
  };
}

export function getProfilePaths(accountId: string): ProfilePaths {
  const baseDir = join(homedir(), ".notebooklm", "profiles", accountId);

  return {
    baseDir,
    browserUserDataDir: join(baseDir, "browser-user-data"),
    storageStatePath: join(baseDir, "storage-state.json"),
    authMetaPath: join(baseDir, "auth-meta.json"),
  };
}

export function ensureProfileDirectories(accountId: string): ProfilePaths {
  const paths = getProfilePaths(accountId);
  mkdirSync(paths.browserUserDataDir, { recursive: true });
  return paths;
}

export function getLegacyStorageStatePath(): string {
  return join(homedir(), ".notebooklm", "storage-state.json");
}

export function readAuthMeta(accountId: string): ReadAuthMetaResult {
  const { authMetaPath } = getProfilePaths(accountId);
  if (!existsSync(authMetaPath)) {
    return { ok: true, value: { accountId, status: "missing" } };
  }

  try {
    return parseAuthMeta(accountId, JSON.parse(readFileSync(authMetaPath, "utf-8")));
  } catch {
    return {
      ok: false,
      error: { accountId, status: "error", error: "Invalid auth metadata" },
    };
  }
}

export function writeAuthMeta(accountId: string, meta: AuthMeta): { ok: true } {
  const { authMetaPath } = ensureProfileDirectories(accountId);
  writeFileSync(authMetaPath, JSON.stringify({ ...meta, accountId }, null, 2));
  return { ok: true };
}

export function readStorageState(accountId: string): { ok: true; value: unknown } | { ok: true; value: null } {
  const { storageStatePath } = getProfilePaths(accountId);
  if (!existsSync(storageStatePath)) {
    return { ok: true, value: null };
  }

  return { ok: true, value: JSON.parse(readFileSync(storageStatePath, "utf-8")) };
}

export function writeStorageState(accountId: string, storageState: unknown): { ok: true } {
  const { storageStatePath } = ensureProfileDirectories(accountId);
  writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2));
  return { ok: true };
}
