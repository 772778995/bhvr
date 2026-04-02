export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  backoffFactor?: number;
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (context: {
    attempt: number;
    nextAttempt: number;
    delayMs: number;
    error: unknown;
  }) => void | Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 3000;
const DEFAULT_BACKOFF_FACTOR = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isRetryableError(message: string): boolean {
  const normalized = message.toLowerCase();

  const nonRetryableMarkers = [
    "401",
    "unauthorized",
    "expired",
    "re-authenticate",
    "authentication",
  ];
  if (nonRetryableMarkers.some((marker) => normalized.includes(marker))) {
    return false;
  }

  const retryableMarkers = [
    "network",
    "fetch failed",
    "timeout",
    "timed out",
    "socket hang up",
    "connection reset",
    "econnreset",
    "etimedout",
    "eai_again",
    "429",
    "500",
    "502",
    "503",
    "504",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "temporarily unavailable",
    "rate limit",
  ];

  return retryableMarkers.some((marker) => normalized.includes(marker));
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelay = DEFAULT_BASE_DELAY_MS,
    backoffFactor = DEFAULT_BACKOFF_FACTOR,
    isRetryable = () => true,
    onRetry,
  } = options;

  let attempt = 1;
  while (attempt <= maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      const shouldRetry = attempt < maxAttempts && isRetryable(error);
      if (!shouldRetry) {
        throw error;
      }

      const delayMs = Math.round(baseDelay * backoffFactor ** (attempt - 1));
      if (onRetry) {
        await onRetry({
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          error,
        });
      }

      await sleep(delayMs);
      attempt += 1;
    }
  }

  throw new Error("Retry failed");
}

export const retryAsync = retry;

export { getErrorMessage };
