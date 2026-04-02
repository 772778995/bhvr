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

  const httpStatusCodes = Array.from(
    normalized.matchAll(/(?:http|status|response)\D{0,24}(\d{3})/g),
    (match) => Number(match[1])
  ).filter((code) => Number.isInteger(code));

  const nonRetryableMarkers = [
    "unauthorized",
    "forbidden",
    "authentication failed",
    "session expired",
    "invalid session",
    "invalid token",
    "re-authenticate",
    "bad request",
    "not found",
    "unprocessable",
    "unprocessable entity",
    "validation error",
    "invalid argument",
    "missing required",
    "malformed",
  ];
  if (nonRetryableMarkers.some((marker) => normalized.includes(marker))) {
    return false;
  }

  if (httpStatusCodes.some((statusCode) => statusCode === 401 || statusCode === 403)) {
    return false;
  }

  if (httpStatusCodes.some((statusCode) => statusCode === 408 || statusCode === 429 || statusCode >= 500)) {
    return true;
  }

  if (httpStatusCodes.some((statusCode) => statusCode >= 400 && statusCode < 500)) {
    return false;
  }

  const retryableMarkers = [
    "network",
    "network error",
    "connection",
    "fetch failed",
    "failed to fetch",
    "timeout",
    "timed out",
    "socket hang up",
    "connection reset",
    "connection refused",
    "dns",
    "dns lookup",
    "temporary failure",
    "temporary network",
    "temporarily unavailable",
    "econnreset",
    "econnrefused",
    "etimedout",
    "eai_again",
    "too many requests",
    "rate limit exceeded",
    "internal server error",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
  ];

  if (retryableMarkers.some((marker) => normalized.includes(marker))) {
    return true;
  }

  return false;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelay = DEFAULT_BASE_DELAY_MS,
    backoffFactor = DEFAULT_BACKOFF_FACTOR,
    isRetryable = (error) => isRetryableError(getErrorMessage(error)),
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
