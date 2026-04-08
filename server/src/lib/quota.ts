/**
 * Optional daily quota tracker for NotebookLM API calls.
 *
 * By default there is NO limit — the quota is unlimited.
 * Set the DAILY_QUOTA_LIMIT environment variable to an integer to impose a
 * per-day cap (resets at midnight UTC). A value of 0 also means unlimited.
 *
 * Example: DAILY_QUOTA_LIMIT=50 limits to 50 calls per day.
 */

const _raw = process.env.DAILY_QUOTA_LIMIT;
const DAILY_LIMIT: number | null =
  _raw && parseInt(_raw, 10) > 0 ? parseInt(_raw, 10) : null; // null = unlimited

type QuotaState = {
  date: string;
  used: number;
};

export type QuotaStatus = {
  date: string;
  used: number;
  /** Daily limit, or null when unlimited. */
  limit: number | null;
  /** Remaining calls today, or null when unlimited. */
  remaining: number | null;
};

let state: QuotaState = {
  date: currentDateKey(),
  used: 0,
};

function currentDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function rolloverIfNeeded(now: Date = new Date()): void {
  const date = currentDateKey(now);
  if (state.date !== date) {
    state = { date, used: 0 };
  }
}

export function getQuotaStatus(now: Date = new Date()): QuotaStatus {
  rolloverIfNeeded(now);

  const remaining =
    DAILY_LIMIT !== null ? Math.max(DAILY_LIMIT - state.used, 0) : null;

  return {
    date: state.date,
    used: state.used,
    limit: DAILY_LIMIT,
    remaining,
  };
}

export function canConsumeQuota(now: Date = new Date()): boolean {
  if (DAILY_LIMIT === null) return true; // unlimited
  return getQuotaStatus(now).remaining! > 0;
}

export function consumeQuota(now: Date = new Date()): QuotaStatus {
  rolloverIfNeeded(now);
  state.used += 1;
  return getQuotaStatus(now);
}
