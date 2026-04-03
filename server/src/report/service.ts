import { eq } from "drizzle-orm";
import db from "../db/index.js";
import { researchReports } from "../db/schema.js";
import type { ResearchReport } from "./schema.js";

/**
 * Retrieve the current report for a notebook, or null if none exists.
 */
export async function getReportByNotebookId(
  notebookId: string
): Promise<ResearchReport | null> {
  const rows = await db
    .select()
    .from(researchReports)
    .where(eq(researchReports.notebookId, notebookId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Insert or replace the report for a notebook.
 * Clears any previous error on the row.
 */
export async function upsertReport(
  notebookId: string,
  content: string,
  generatedAt?: Date
): Promise<ResearchReport> {
  const now = new Date();
  const resolved = generatedAt ?? now;

  const rows = await db
    .insert(researchReports)
    .values({
      notebookId,
      content,
      generatedAt: resolved,
      errorMessage: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: researchReports.notebookId,
      set: {
        content,
        generatedAt: resolved,
        errorMessage: null,
        updatedAt: now,
      },
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error(`upsertReport: no row returned for notebookId=${notebookId}`);
  }
  return row;
}

/**
 * Record an error against a notebook's report slot.
 * Preserves existing content (if any) so callers can still read the last
 * successful report while the error is visible.
 */
export async function setReportError(
  notebookId: string,
  errorMessage: string
): Promise<ResearchReport> {
  const now = new Date();

  const rows = await db
    .insert(researchReports)
    .values({
      notebookId,
      content: null,
      generatedAt: null,
      errorMessage,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: researchReports.notebookId,
      set: {
        errorMessage,
        updatedAt: now,
      },
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error(`setReportError: no row returned for notebookId=${notebookId}`);
  }
  return row;
}

/**
 * Clear the error field on a notebook's report row.
 * No-ops gracefully if the row does not yet exist (returns null).
 */
export async function clearReportError(
  notebookId: string
): Promise<ResearchReport | null> {
  const now = new Date();

  const rows = await db
    .update(researchReports)
    .set({ errorMessage: null, updatedAt: now })
    .where(eq(researchReports.notebookId, notebookId))
    .returning();

  return rows[0] ?? null;
}
