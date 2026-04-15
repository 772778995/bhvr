import { and, desc, eq } from "drizzle-orm";
import db from "./index.js";
import { reportEntries } from "./schema.js";

export type EntryType = "research_report" | "artifact";
export type EntryState = "creating" | "ready" | "failed";

export interface ReportEntryRecord {
  id: string;
  notebookId: string;
  entryType: EntryType;
  title: string | null;
  state: EntryState;
  content: string | null;
  errorMessage: string | null;
  presetId: string | null;
  artifactId: string | null;
  artifactType: string | null;
  contentJson: string | null;
  filePath: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Insert a new research_report entry.
 */
export async function insertReportEntry(record: {
  notebookId: string;
  title: string;
  content: string | null;
  filePath?: string;
  contentJson?: string | null;
  state?: EntryState;
  errorMessage?: string | null;
  presetId?: string | null;
}): Promise<ReportEntryRecord> {
  const rows = await db
    .insert(reportEntries)
    .values({
      notebookId: record.notebookId,
      entryType: "research_report",
      title: record.title,
      state: record.state ?? "ready",
      content: record.content ?? null,
      filePath: record.filePath ?? null,
      contentJson: record.contentJson ?? null,
      errorMessage: record.errorMessage ?? null,
      presetId: record.presetId ?? null,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("insertReportEntry: no row returned");
  return row as unknown as ReportEntryRecord;
}

/**
 * Insert a new artifact entry (typically called when SDK create returns an artifactId).
 */
export async function insertArtifactEntry(record: {
  notebookId: string;
  artifactId: string;
  artifactType: string;
  state?: EntryState;
  title?: string | null;
}): Promise<void> {
  await db
    .insert(reportEntries)
    .values({
      notebookId: record.notebookId,
      entryType: "artifact",
      artifactId: record.artifactId,
      artifactType: record.artifactType,
      state: record.state ?? "creating",
      title: record.title ?? null,
    })
    .onConflictDoNothing();
}

/**
 * Reuse the single local audio slot for a notebook.
 * Audio no longer keeps local history rows because the remote overview is unique.
 */
export async function replaceAudioArtifactEntry(record: {
  notebookId: string;
  artifactId: string;
}): Promise<void> {
  const existingRows = await db
    .select()
    .from(reportEntries)
    .where(and(eq(reportEntries.notebookId, record.notebookId), eq(reportEntries.artifactType, "audio")))
    .orderBy(desc(reportEntries.createdAt));

  const existing = existingRows[0] as unknown as ReportEntryRecord | undefined;

  if (!existing) {
    await insertArtifactEntry({
      notebookId: record.notebookId,
      artifactId: record.artifactId,
      artifactType: "audio",
      state: "creating",
      title: null,
    });
    return;
  }

  await db
    .update(reportEntries)
    .set({
      artifactId: record.artifactId,
      state: "creating",
      title: null,
      contentJson: null,
      filePath: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(reportEntries.id, existing.id));

  if (existingRows.length > 1) {
    const staleIds = existingRows.slice(1).map((row) => row.id);
    for (const staleId of staleIds) {
      await db.delete(reportEntries).where(eq(reportEntries.id, staleId));
    }
  }
}

/**
 * Mark an artifact entry as READY with content.
 * audioData is intentionally excluded — large binary is stored as a file.
 */
export async function markArtifactEntryReady(
  artifactId: string,
  data: {
    title?: string | null;
    contentJson?: string | null;
    filePath?: string | null;
  }
): Promise<void> {
  const updates: Record<string, unknown> = {
    state: "ready",
    contentJson: data.contentJson ?? null,
    filePath: data.filePath ?? null,
    updatedAt: new Date(),
  };
  // Only overwrite title when explicitly provided (not undefined)
  if (data.title !== undefined) {
    updates.title = data.title;
  }
  await db
    .update(reportEntries)
    .set(updates)
    .where(eq(reportEntries.artifactId, artifactId));
}

/**
 * Mark an artifact entry as FAILED.
 */
export async function markArtifactEntryFailed(artifactId: string): Promise<void> {
  await db
    .update(reportEntries)
    .set({ state: "failed", updatedAt: new Date() })
    .where(eq(reportEntries.artifactId, artifactId));
}

export async function markArtifactEntryFailedWithData(
  artifactId: string,
  data: { title?: string | null }
): Promise<void> {
  const updates: Record<string, unknown> = {
    state: "failed",
    updatedAt: new Date(),
  };
  if (data.title !== undefined) {
    updates.title = data.title;
  }
  await db
    .update(reportEntries)
    .set(updates)
    .where(eq(reportEntries.artifactId, artifactId));
}

/**
 * List all entries for a notebook, newest first.
 */
export async function listEntriesByNotebookId(
  notebookId: string
): Promise<ReportEntryRecord[]> {
  const rows = await db
    .select()
    .from(reportEntries)
    .where(eq(reportEntries.notebookId, notebookId))
    .orderBy(desc(reportEntries.createdAt));
  return rows as unknown as ReportEntryRecord[];
}

/**
 * Get a single entry by its local UUID.
 */
export async function getEntryById(id: string): Promise<ReportEntryRecord | null> {
  const rows = await db
    .select()
    .from(reportEntries)
    .where(eq(reportEntries.id, id))
    .limit(1);
  return (rows[0] as unknown as ReportEntryRecord) ?? null;
}

/**
 * Look up an artifact entry by its NLM SDK artifact ID.
 */
export async function getEntryByArtifactId(
  artifactId: string
): Promise<ReportEntryRecord | null> {
  const rows = await db
    .select()
    .from(reportEntries)
    .where(eq(reportEntries.artifactId, artifactId))
    .limit(1);
  return (rows[0] as unknown as ReportEntryRecord) ?? null;
}

export async function getCurrentAudioEntry(notebookId: string): Promise<ReportEntryRecord | null> {
  const rows = await db
    .select()
    .from(reportEntries)
    .where(and(eq(reportEntries.notebookId, notebookId), eq(reportEntries.artifactType, "audio")))
    .orderBy(desc(reportEntries.createdAt))
    .limit(1);
  return (rows[0] as unknown as ReportEntryRecord) ?? null;
}

/**
 * Delete an entry by its local UUID, scoped to a notebook.
 * Returns the deleted row (for file cleanup), or null if not found.
 */
export async function deleteEntryById(
  id: string,
  notebookId?: string
): Promise<ReportEntryRecord | null> {
  const condition = notebookId
    ? and(eq(reportEntries.id, id), eq(reportEntries.notebookId, notebookId))
    : eq(reportEntries.id, id);
  const rows = await db
    .delete(reportEntries)
    .where(condition)
    .returning();
  return (rows[0] as unknown as ReportEntryRecord) ?? null;
}

/**
 * Update error on a report entry (research_report type).
 */
export async function setReportEntryError(
  id: string,
  errorMessage: string
): Promise<void> {
  await db
    .update(reportEntries)
    .set({ state: "failed", errorMessage, updatedAt: new Date() })
    .where(eq(reportEntries.id, id));
}
