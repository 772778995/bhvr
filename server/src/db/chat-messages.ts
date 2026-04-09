import { asc, eq, sql } from "drizzle-orm";
import { db } from "./index.js";
import { chatMessages } from "./schema.js";

export interface ChatMessageRecord {
  id: string;
  notebookId: string;
  role: "user" | "assistant";
  content: string;
  source: "manual" | "research";
  createdAt: Date;
}

export async function insertChatMessage(
  record: Omit<ChatMessageRecord, "createdAt">
): Promise<void> {
  await db.insert(chatMessages).values({
    id: record.id,
    notebookId: record.notebookId,
    role: record.role,
    content: record.content,
    source: record.source,
  });
}

export async function listChatMessages(
  notebookId: string
): Promise<ChatMessageRecord[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.notebookId, notebookId))
    .orderBy(asc(chatMessages.createdAt));

  return rows.map((row) => ({
    id: row.id,
    notebookId: row.notebookId,
    role: row.role,
    content: row.content,
    source: row.source,
    createdAt: row.createdAt,
  }));
}

/** Returns the number of chat messages for a notebook, optionally filtered by source. */
export async function countChatMessages(
  notebookId: string,
  source?: "manual" | "research"
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(chatMessages)
    .where(
      source
        ? sql`${chatMessages.notebookId} = ${notebookId} AND ${chatMessages.source} = ${source}`
        : eq(chatMessages.notebookId, notebookId)
    );
  return Number(rows[0]?.count ?? 0);
}
