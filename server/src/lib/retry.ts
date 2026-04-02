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
    "forbidden",
    "expired",
    "session expired",
    "invalid session",
    "invalid token",
    "auth",
    "re-authenticate",
    "authentication",
    "400",
    "bad request",
    "404",
    "not found",
    "422",
    "unprocessable",
    "validation error",
    "invalid argument",
  ];
  if (nonRetryableMarkers.some((marker) => normalized.includes(marker))) {
    return false;
  }

  const retryableMarkers = [
    "network",
    "connection",
    "fetch failed",
    "timeout",
    "timed out",
    "socket hang up",
    "connection reset",
    "dns",
    "temporary failure",
    "econnreset",
    "etimedout",
    "eai_again",
    "429",
    "too many requests",
    "500",
    "internal server error",
    "502",
    "503",
    "504",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "temporarily unavailable",
    "rate limit",
  ];

  if (retryableMarkers.some((marker) => normalized.includes(marker))) {
    return true;
  }

  // For unknown errors, default to retryable unless explicitly classified otherwise.
  return true;
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

  if (maxAttempts < 1) {
    throw new Error(`Invalid retry options: maxAttempts must be >= 1 (received ${maxAttempts})`);
  }
  if (baseDelay < 0) {
    throw new Error(`Invalid retry options: baseDelay must be >= 0 (received ${baseDelay})`);
  }
  if (backoffFactor < 1) {
    throw new Error(
      `Invalid retry options: backoffFactor must be >= 1 (received ${backoffFactor})`
    );
  }

  let attempt = 1;
  let lastError: unknown;
  while (attempt <= maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
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

  if (lastError instanceof Error) {
    throw new Error(
      `Retry exhausted after ${maxAttempts} attempts: ${lastError.message}`,
      { cause: lastError }
    );
  }

  throw new Error(`Retry exhausted after ${maxAttempts} attempts`, { cause: lastError });
}

export const retryAsync = retry;

export { getErrorMessage };
