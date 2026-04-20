import {
  DEFAULT_ACCOUNT_ID,
  type AuthMeta,
  type AuthState,
  readAuthMeta,
  writeAuthMeta,
  writeStorageState,
} from "./auth-profile.js";

export interface RuntimeClientLike {
  dispose(): void;
}

export interface RefreshResult {
  authToken: string;
  storageState: unknown;
}

export interface RefreshAssessment {
  status: Extract<AuthState, "ready" | "expired" | "reauth_required" | "error">;
  error?: string;
}

export interface AuthManagerDependencies {
  now(): Date;
  createRuntimeClient(accountId: string): Promise<RuntimeClientLike>;
  silentRefresh(accountId: string, reason: string): Promise<RefreshResult>;
  validateProfile(accountId: string): Promise<RefreshAssessment>;
  disposeRuntimeClient(client: RuntimeClientLike): Promise<void>;
}

/**
 * Alert sink for auth state transitions. Called when reauth is needed.
 */
export interface AlertSink {
  onReauthRequired(accountId: string): Promise<void>;
}

export interface AuthManager {
  getAuthProfileStatus(accountId: string): Promise<AuthMeta>;
  initAuthProfile(accountId: string): Promise<AuthMeta>;
  refreshAuthProfile(accountId: string, reason: string): Promise<AuthMeta>;
  invalidateAuthClient(accountId: string): Promise<void>;
  getAuthenticatedSdkClient(accountId: string): Promise<RuntimeClientLike>;
  startAuthHealthMonitor(accountId: string): { stop(): void };
  /** Reset the failure counter so the next refreshAuthProfile is not short-circuited. */
  resetFailureCount(accountId: string): void;
}

interface RuntimeState {
  client?: RuntimeClientLike;
  refreshPromise?: Promise<AuthMeta>;
  failureCount: number;
}

const DEFAULT_REFRESH_FAILURE_THRESHOLD = 3;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 10 * 60 * 1000;

function toIso(now: Date): string {
  return now.toISOString();
}

function persistMeta(accountId: string, meta: AuthMeta): AuthMeta {
  writeAuthMeta(accountId, meta);
  return meta;
}

function requiresReauthentication(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("re-login")
    || message.includes("re-authenticate")
    || message.includes("manual login")
    || message.includes("challenge")
    || message.includes("2FA");
}

function isRecoverableAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("HTTP 302")
    || message.includes("auth token")
    || message.includes("authentication")
    || message.includes("expired")
    || message.includes("unsupported");
}

export function createAuthManager(deps: AuthManagerDependencies, alertSink?: AlertSink): AuthManager {
  const stateByAccount = new Map<string, RuntimeState>();
  // Track which accounts have already had a reauth_required alert fired
  const reauthAlertFired = new Set<string>();

  function getRuntimeState(accountId: string): RuntimeState {
    const existing = stateByAccount.get(accountId);
    if (existing) return existing;

    const created: RuntimeState = { failureCount: 0 };
    stateByAccount.set(accountId, created);
    return created;
  }

  async function writeStatus(accountId: string, status: AuthState, error?: string, includeRefresh = false): Promise<AuthMeta> {
    const now = toIso(deps.now());
    const meta = persistMeta(accountId, {
      accountId,
      status,
      lastCheckedAt: now,
      ...(includeRefresh ? { lastRefreshedAt: now } : {}),
      ...(error ? { error } : {}),
    });

    // Fire alert exactly once when transitioning into reauth_required
    if (status === "reauth_required" && !reauthAlertFired.has(accountId)) {
      reauthAlertFired.add(accountId);
      if (alertSink) {
        alertSink.onReauthRequired(accountId).catch(() => {
          // swallow alert errors – never let alert failure break the main flow
        });
      }
    } else if (status !== "reauth_required") {
      // Clear the flag so future reauth_required transitions alert again
      reauthAlertFired.delete(accountId);
    }

    return meta;
  }

  async function invalidateAuthClient(accountId: string): Promise<void> {
    const runtime = getRuntimeState(accountId);
    if (!runtime.client) return;

    // Clear the cached client reference so new callers get a fresh one.
    // Do NOT dispose the old client here: parallel requests may still be using
    // it, and dispose() mutates shared SDK state (initialized flag, refresh
    // manager). The old client will be GC-ed once all in-flight callers finish.
    runtime.client = undefined;
  }

  async function refreshInternal(accountId: string, reason: string): Promise<AuthMeta> {
    const runtime = getRuntimeState(accountId);
    if (runtime.failureCount >= DEFAULT_REFRESH_FAILURE_THRESHOLD) {
      return await writeStatus(accountId, "reauth_required", "Authentication refresh failed repeatedly");
    }

    await writeStatus(accountId, "refreshing");

    try {
      const refreshed = await deps.silentRefresh(accountId, reason);
      writeStorageState(accountId, refreshed.storageState);

      const validation = await deps.validateProfile(accountId);
      if (validation.status !== "ready") {
        runtime.failureCount += 1;
        if (runtime.failureCount >= DEFAULT_REFRESH_FAILURE_THRESHOLD) {
          return await writeStatus(accountId, "reauth_required", validation.error ?? "Authentication refresh requires manual login");
        }

        return await writeStatus(accountId, validation.status, validation.error);
      }

      runtime.failureCount = 0;
      await invalidateAuthClient(accountId);

      return await writeStatus(accountId, "ready", undefined, true);
    } catch (error) {
      runtime.failureCount += 1;
      if (requiresReauthentication(error)) {
        runtime.failureCount = DEFAULT_REFRESH_FAILURE_THRESHOLD;
        return await writeStatus(accountId, "reauth_required", error instanceof Error ? error.message : String(error));
      }

      if (runtime.failureCount >= DEFAULT_REFRESH_FAILURE_THRESHOLD) {
        return await writeStatus(accountId, "reauth_required", error instanceof Error ? error.message : String(error));
      }

      return await writeStatus(accountId, "expired", error instanceof Error ? error.message : String(error));
    }
  }

  return {
    async getAuthProfileStatus(accountId) {
      const persisted = readAuthMeta(accountId);
      return persisted.ok ? persisted.value : persisted.error;
    },

    async initAuthProfile(accountId) {
      return persistMeta(accountId, {
        accountId,
        status: "missing",
      });
    },

    async refreshAuthProfile(accountId, reason) {
      const runtime = getRuntimeState(accountId);
      if (runtime.refreshPromise) {
        return await runtime.refreshPromise;
      }

      runtime.refreshPromise = refreshInternal(accountId, reason).finally(() => {
        runtime.refreshPromise = undefined;
      });

      return await runtime.refreshPromise;
    },

    async invalidateAuthClient(accountId) {
      await invalidateAuthClient(accountId);
    },

    async getAuthenticatedSdkClient(accountId) {
      const runtime = getRuntimeState(accountId);
      if (runtime.client) {
        return runtime.client;
      }

      let client: RuntimeClientLike;
      try {
        client = await deps.createRuntimeClient(accountId);
      } catch (error) {
        if (requiresReauthentication(error) || !isRecoverableAuthFailure(error)) {
          throw error;
        }

        const status = await this.refreshAuthProfile(accountId, "runtime-create");
        if (status.status !== "ready") {
          throw error;
        }

        client = await deps.createRuntimeClient(accountId);
      }

      runtime.client = client;

      const persisted = readAuthMeta(accountId);
      if (persisted.ok && persisted.value.status !== "ready") {
        await writeStatus(accountId, "ready", undefined, Boolean(persisted.value.lastRefreshedAt));
      }

      return client;
    },

    resetFailureCount(accountId) {
      getRuntimeState(accountId).failureCount = 0;
    },

    startAuthHealthMonitor(accountId) {
      const timer = setInterval(() => {
        void this.refreshAuthProfile(accountId, "health-check");
      }, DEFAULT_HEALTH_CHECK_INTERVAL_MS);

      return {
        stop() {
          clearInterval(timer);
        },
      };
    },
  };
}

const defaultDependencies: AuthManagerDependencies = {
  now: () => new Date(),
  createRuntimeClient: async () => {
    throw new Error("Auth manager runtime client factory not configured");
  },
  silentRefresh: async () => {
    throw new Error("Auth manager refresh flow not configured");
  },
  validateProfile: async () => ({ status: "error", error: "Auth manager validation not configured" }),
  disposeRuntimeClient: async (client) => {
    client.dispose();
  },
};

export let authManager = createAuthManager(defaultDependencies);

export function configureAuthManager(dependencies: AuthManagerDependencies, alertSink?: AlertSink): AuthManager {
  authManager = createAuthManager(dependencies, alertSink);
  return authManager;
}

export { DEFAULT_ACCOUNT_ID };
