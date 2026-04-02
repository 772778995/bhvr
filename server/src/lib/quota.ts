const DAILY_LIMIT = 50;

type QuotaState = {
  date: string;
  used: number;
};

type QuotaStatus = {
  date: string;
  used: number;
  limit: number;
  remaining: number;
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

  return {
    date: state.date,
    used: state.used,
    limit: DAILY_LIMIT,
    remaining: Math.max(DAILY_LIMIT - state.used, 0),
  };
}

export function canConsumeQuota(now: Date = new Date()): boolean {
  return getQuotaStatus(now).remaining > 0;
}

export function consumeQuota(now: Date = new Date()): QuotaStatus {
  rolloverIfNeeded(now);

  if (state.used < DAILY_LIMIT) {
    state.used += 1;
  }

  return getQuotaStatus(now);
}
