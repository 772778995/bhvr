import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { notebookSourceStates } from "../db/schema.js";
import type { NotebookSource } from "../notebooklm/client.js";

export interface SourceWithState extends NotebookSource {
  enabled: boolean;
}

export function mergeSourceStates(
  sources: NotebookSource[],
  enabledMap: Map<string, boolean>
): SourceWithState[] {
  return sources.map((s) => ({
    ...s,
    enabled: enabledMap.get(s.id) ?? true,
  }));
}

export function listEnabledSourceIds(
  sources: Array<{ id: string; enabled: boolean }>
): string[] {
  return sources.filter((s) => s.enabled).map((s) => s.id);
}

export async function listSourceStateMap(
  notebookId: string
): Promise<Map<string, boolean>> {
  const rows = await db
    .select({
      sourceId: notebookSourceStates.sourceId,
      enabled: notebookSourceStates.enabled,
    })
    .from(notebookSourceStates)
    .where(eq(notebookSourceStates.notebookId, notebookId));

  return new Map(rows.map((r) => [r.sourceId, r.enabled]));
}

export async function deleteSourceState(
  notebookId: string,
  sourceId: string
): Promise<void> {
  await db
    .delete(notebookSourceStates)
    .where(
      and(
        eq(notebookSourceStates.notebookId, notebookId),
        eq(notebookSourceStates.sourceId, sourceId)
      )
    );
}

export async function setSourceEnabled(
  notebookId: string,
  sourceId: string,
  enabled: boolean
): Promise<void> {
  const existing = await db
    .select({ id: notebookSourceStates.id })
    .from(notebookSourceStates)
    .where(
      and(
        eq(notebookSourceStates.notebookId, notebookId),
        eq(notebookSourceStates.sourceId, sourceId)
      )
    )
    .limit(1);

  if (existing[0]?.id) {
    await db
      .update(notebookSourceStates)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(notebookSourceStates.id, existing[0].id));
    return;
  }

  await db.insert(notebookSourceStates).values({
    notebookId,
    sourceId,
    enabled,
  });
}
