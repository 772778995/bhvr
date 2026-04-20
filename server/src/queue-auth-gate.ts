import { DEFAULT_ACCOUNT_ID, getAuthStatus } from "./notebooklm/index.js";
import type { AuthGate } from "./worker/queue.js";

export function createQueueAuthGate(): AuthGate {
  return {
    isReauthRequired: async () => {
      const status = await getAuthStatus();
      return status.status === "reauth_required";
    },
  };
}
