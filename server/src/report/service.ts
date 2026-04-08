import { eq, desc } from "drizzle-orm";
import db from "../db/index.js";
import { researchReports } from "../db/schema.js";
import type { ResearchReport } from "./schema.js";

/**
 * Generate a default report title using the current server time.
 * Format: "研究报告 YYYY-MM-DD HH:mm"
 */
function defaultTitle(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `研究报告 ${y}-${m}-${d} ${hh}:${mm}`;
}

/**
 * List all reports for a notebook, ordered by generated_at DESC.
 */
export async function listReportsByNotebookId(
  notebookId: string
): Promise<ResearchReport[]> {
  return await db
    .select()
    .from(researchReports)
    .where(eq(researchReports.notebookId, notebookId))
    .orderBy(desc(researchReports.generatedAt));
}

/**
 * Get a single report by its ID.
 */
export async function getReportById(
  id: string
): Promise<ResearchReport | null> {
  const rows = await db
    .select()
    .from(researchReports)
    .where(eq(researchReports.id, id))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Create a new report for a notebook.
 */
export async function createReport(
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
      title: defaultTitle(),
      content,
      generatedAt: resolved,
      errorMessage: null,
      updatedAt: now,
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error(`createReport: no row returned for notebookId=${notebookId}`);
  }
  return row;
}

/**
 * Delete a report by its ID.
 * Returns true if a row was deleted, false if the report didn't exist.
 */
export async function deleteReportById(id: string): Promise<boolean> {
  const rows = await db
    .delete(researchReports)
    .where(eq(researchReports.id, id))
    .returning();

  return rows.length > 0;
}

/**
 * Record an error against the most recent report for a notebook.
 * If no report exists, creates a new empty report record with the error.
 */
export async function setReportError(
  notebookId: string,
  errorMessage: string
): Promise<ResearchReport> {
  const now = new Date();

  // Try to find the latest report for this notebook
  const latest = await db
    .select()
    .from(researchReports)
    .where(eq(researchReports.notebookId, notebookId))
    .orderBy(desc(researchReports.generatedAt))
    .limit(1);

  if (latest[0]) {
    // Update existing latest report
    const rows = await db
      .update(researchReports)
      .set({ errorMessage, updatedAt: now })
      .where(eq(researchReports.id, latest[0].id))
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error(`setReportError: no row returned for notebookId=${notebookId}`);
    }
    return row;
  }

  // No existing report — create a new empty one with the error
  const rows = await db
    .insert(researchReports)
    .values({
      notebookId,
      title: defaultTitle(),
      content: null,
      generatedAt: null,
      errorMessage,
      updatedAt: now,
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error(`setReportError: no row returned for notebookId=${notebookId}`);
  }
  return row;
}

/**
 * Clear the error field on the most recent report for a notebook.
 * Returns null if no report exists.
 */
export async function clearReportError(
  notebookId: string
): Promise<ResearchReport | null> {
  const now = new Date();

  const latest = await db
    .select()
    .from(researchReports)
    .where(eq(researchReports.notebookId, notebookId))
    .orderBy(desc(researchReports.generatedAt))
    .limit(1);

  if (!latest[0]) return null;

  const rows = await db
    .update(researchReports)
    .set({ errorMessage: null, updatedAt: now })
    .where(eq(researchReports.id, latest[0].id))
    .returning();

  return rows[0] ?? null;
}
