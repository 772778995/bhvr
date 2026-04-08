import { asc, eq } from "drizzle-orm";
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
