import { desc, eq } from "drizzle-orm";
import db from "./index.js";
import { artifacts } from "./schema.js";

export interface ArtifactRecord {
  id: string;
  notebookId: string;
  artifactId: string;
  artifactType: string;
  state: string;
  title: string | null;
  contentJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Insert a new artifact record (typically called right after SDK create).
 * If the artifactId already exists (race condition), the insert is silently ignored.
 */
export async function insertArtifact(record: {
  notebookId: string;
  artifactId: string;
  artifactType: string;
  state?: string;
}): Promise<void> {
  await db
    .insert(artifacts)
    .values({
      notebookId: record.notebookId,
      artifactId: record.artifactId,
      artifactType: record.artifactType,
      state: record.state ?? "creating",
    })
    .onConflictDoNothing();
}

/**
 * Look up a persisted artifact by its NLM SDK artifact ID.
 */
export async function getArtifactByArtifactId(
  artifactId: string
): Promise<ArtifactRecord | null> {
  const rows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.artifactId, artifactId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Mark an artifact as READY and store its full content.
 */
export async function markArtifactReady(
  artifactId: string,
  data: { title?: string | null; contentJson?: string | null }
): Promise<void> {
  await db
    .update(artifacts)
    .set({
      state: "ready",
      title: data.title ?? null,
      contentJson: data.contentJson ?? null,
      updatedAt: new Date(),
    })
    .where(eq(artifacts.artifactId, artifactId));
}

/**
 * Mark an artifact as FAILED.
 */
export async function markArtifactFailed(artifactId: string): Promise<void> {
  await db
    .update(artifacts)
    .set({ state: "failed", updatedAt: new Date() })
    .where(eq(artifacts.artifactId, artifactId));
}

/**
 * List all persisted artifacts for a notebook, newest first.
 */
export async function listArtifactsByNotebookId(
  notebookId: string
): Promise<ArtifactRecord[]> {
  return await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.notebookId, notebookId))
    .orderBy(desc(artifacts.createdAt));
}
