import { eq, sql } from "drizzle-orm";

import db from "./index.js";
import { bookSourceStats } from "./schema.js";

export type BookSourceStatStatus = "success" | "empty" | "failure";

export interface BookSourceStatRecord {
  sourceId: string;
  sourceLabel: string;
  attemptCount: number;
  successCount: number;
  emptyCount: number;
  failureCount: number;
  lastStatus: BookSourceStatStatus;
  lastError: string | null;
  lastLatencyMs: number | null;
  lastSuccessAt: Date | null;
  updatedAt: Date;
}

export async function listBookSourceStats(): Promise<BookSourceStatRecord[]> {
  const rows = await db
    .select()
    .from(bookSourceStats)
    .orderBy(bookSourceStats.sourceId);
  return rows as BookSourceStatRecord[];
}

export async function getBookSourceStat(sourceId: string): Promise<BookSourceStatRecord | null> {
  const rows = await db
    .select()
    .from(bookSourceStats)
    .where(eq(bookSourceStats.sourceId, sourceId))
    .limit(1);

  return (rows[0] as BookSourceStatRecord | undefined) ?? null;
}

export async function recordBookSourceStat(entry: {
  sourceId: string;
  sourceLabel: string;
  status: BookSourceStatStatus;
  latencyMs: number;
  error?: string | null;
}): Promise<void> {
  const now = new Date();
  const values = {
    sourceId: entry.sourceId,
    sourceLabel: entry.sourceLabel,
    attemptCount: 1,
    successCount: entry.status === "success" ? 1 : 0,
    emptyCount: entry.status === "empty" ? 1 : 0,
    failureCount: entry.status === "failure" ? 1 : 0,
    lastStatus: entry.status,
    lastError: entry.status === "failure" ? entry.error?.trim() || null : null,
    lastLatencyMs: Math.max(0, Math.round(entry.latencyMs)),
    lastSuccessAt: entry.status === "success" ? now : null,
    updatedAt: now,
  };

  await db
    .insert(bookSourceStats)
    .values(values)
    .onConflictDoUpdate({
      target: bookSourceStats.sourceId,
      set: {
        sourceLabel: entry.sourceLabel,
        attemptCount: sql`${bookSourceStats.attemptCount} + 1`,
        successCount: sql`${bookSourceStats.successCount} + ${entry.status === "success" ? 1 : 0}`,
        emptyCount: sql`${bookSourceStats.emptyCount} + ${entry.status === "empty" ? 1 : 0}`,
        failureCount: sql`${bookSourceStats.failureCount} + ${entry.status === "failure" ? 1 : 0}`,
        lastStatus: entry.status,
        lastError: entry.status === "failure" ? entry.error?.trim() || null : null,
        lastLatencyMs: Math.max(0, Math.round(entry.latencyMs)),
        lastSuccessAt: entry.status === "success"
          ? now
          : sql`coalesce(${bookSourceStats.lastSuccessAt}, null)`,
        updatedAt: now,
      },
    });
}
