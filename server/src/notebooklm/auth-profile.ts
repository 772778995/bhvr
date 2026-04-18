import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

  // For the default account only: honour NOTEBOOKLM_STORAGE_STATE_PATH so that
  // ALL read/write paths (readStorageState, writeStorageState, legacy migration,
  // etc.) consistently use the same custom location in Docker/headless scenarios.
  const storageStatePath =
    accountId === DEFAULT_ACCOUNT_ID && process.env.NOTEBOOKLM_STORAGE_STATE_PATH
      ? process.env.NOTEBOOKLM_STORAGE_STATE_PATH
      : join(baseDir, "storage-state.json");

  return {
    baseDir,
    browserUserDataDir: join(baseDir, "browser-user-data"),
    storageStatePath,
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
  // Custom storageStatePath may live outside the profile base dir — ensure its parent exists.
  mkdirSync(dirname(storageStatePath), { recursive: true });
  writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Docker / env-var storage state injection helpers
// ---------------------------------------------------------------------------

/**
 * Returns the effective storage state path for the default account.
 * Delegates to getProfilePaths so the env-var override is centralised there.
 */
export function getDefaultStorageStatePath(): string {
  return getProfilePaths(DEFAULT_ACCOUNT_ID).storageStatePath;
}

/**
 * Reads NOTEBOOKLM_STORAGE_STATE_JSON_B64 from the environment and, if set,
 * writes the decoded JSON to `targetPath` — but only when the target file does
 * not already exist (to avoid clobbering a refreshed session on restart).
 *
 * Throws a descriptive error if the env value is not valid base64 or not valid
 * JSON.
 */
export function prepareStorageStateFromEnv(targetPath: string): void {
  const b64 = process.env.NOTEBOOKLM_STORAGE_STATE_JSON_B64;
  if (!b64) {
    return;
  }

  if (existsSync(targetPath)) {
    // Do not overwrite an already-present file (e.g. after a session refresh).
    return;
  }

  // Validate base64: Buffer.from with base64 is lenient — re-encode and compare.
  let decoded: string;
  try {
    const buf = Buffer.from(b64, "base64");
    // Re-encode and compare to detect non-base64 characters (strict check).
    if (buf.toString("base64") !== b64.replace(/\s/g, "")) {
      throw new Error("re-encode mismatch");
    }
    decoded = buf.toString("utf-8");
  } catch {
    throw new Error(
      "Invalid base64 in NOTEBOOKLM_STORAGE_STATE_JSON_B64: content is not valid base64"
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error(
      "Invalid JSON in NOTEBOOKLM_STORAGE_STATE_JSON_B64: decoded content is not valid JSON"
    );
  }

  // Ensure the parent directory exists before writing.
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(parsed, null, 2));
}
