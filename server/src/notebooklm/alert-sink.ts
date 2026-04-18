/**
 * AlertSink factory with injectable dependencies for testability.
 * Production code imports `createAlertSink()`; tests use `buildAlertSink()`.
 */
import type { AlertSink } from "./auth-manager.js";
import type pino from "pino";

type MinLogger = Pick<pino.Logger, "error" | "warn">;
type FetchFn = typeof fetch;

export interface AlertSinkDeps {
  logger: MinLogger;
  fetch: FetchFn;
  /** Webhook request timeout in ms (default 5000) */
  webhookTimeoutMs?: number;
}

/**
 * Build an AlertSink with the given dependencies.
 * Rules:
 *  1. If REAUTH_WEBHOOK_URL is not configured → emit structured alert log.
 *  2. If fetch throws → emit structured alert log.
 *  3. If webhook returns non-2xx → emit structured alert log.
 * In cases 2 and 3 the alert log is the real signal, not a secondary note.
 */
export function buildAlertSink(deps: AlertSinkDeps): AlertSink {
  const { webhookTimeoutMs = 5000 } = deps;

  async function emitAlertLog(accountId: string, reason: string, extra?: Record<string, unknown>): Promise<void> {
    deps.logger.error(
      { event: "reauth_required", accountId, reason, ...extra },
      "AUTH ALERT: NotebookLM authentication requires manual re-login. Use POST /api/auth/reauth to restore."
    );
  }

  return {
    async onReauthRequired(accountId: string): Promise<void> {
      const webhookUrl = process.env.REAUTH_WEBHOOK_URL;

      if (!webhookUrl) {
        await emitAlertLog(accountId, "no_webhook_configured");
        return;
      }

      // Attempt webhook with timeout
      let response: Response | undefined;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), webhookTimeoutMs);
        try {
          response = await deps.fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "reauth_required",
              accountId,
              timestamp: new Date().toISOString(),
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        deps.logger.warn({ accountId, webhookUrl, err }, "reauth alert: webhook POST failed");
        await emitAlertLog(accountId, "webhook_fetch_error");
        return;
      }

      if (!response.ok) {
        deps.logger.warn({ accountId, webhookUrl, status: response.status }, "reauth alert: webhook returned non-2xx");
        await emitAlertLog(accountId, "webhook_non_2xx", { webhookStatus: response.status });
      }
    },
  };
}
