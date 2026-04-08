import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import * as schema from "./schema.js";
import { dirname } from "node:path";
import { resolveDatabasePath } from "./path.js";
import logger from "../lib/logger.js";

const DB_PATH = resolveDatabasePath();
mkdirSync(dirname(DB_PATH), { recursive: true });

const client = createClient({
  url: `file:${DB_PATH}`,
});

await client.execute("PRAGMA journal_mode = WAL;");
await client.executeMultiple(`
  CREATE TABLE IF NOT EXISTS research_tasks (
    id TEXT PRIMARY KEY,
    notebook_url TEXT NOT NULL,
    topic TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    num_questions INTEGER NOT NULL DEFAULT 10,
    completed_questions INTEGER NOT NULL DEFAULT 0,
    report TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES research_tasks(id),
    order_num INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    answer_text TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notebook_source_states (
    id TEXT PRIMARY KEY NOT NULL,
    notebook_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS notebook_source_unique
  ON notebook_source_states (notebook_id, source_id);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY NOT NULL,
    notebook_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS chat_messages_notebook_id
  ON chat_messages (notebook_id, created_at ASC);
`);

// Migrate research_reports: old schema had notebook_id as PK, new schema has id as PK
const tableInfo = await client.execute(
  "PRAGMA table_info(research_reports)"
);
const hasIdColumn = tableInfo.rows.some((row) => row.name === "id");

if (!hasIdColumn && tableInfo.rows.length > 0) {
  // Old table exists — migrate data
  logger.info("Migrating research_reports from single-report to multi-report schema");
  const oldRows = await client.execute("SELECT * FROM research_reports");
  await client.execute("DROP TABLE research_reports");
  await client.executeMultiple(`
    CREATE TABLE research_reports (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      generated_at INTEGER,
      error_message TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reports_notebook
    ON research_reports (notebook_id);
  `);

  for (const row of oldRows.rows) {
    const id = crypto.randomUUID();
    const notebookId = row.notebook_id as string;
    const content = row.content as string | null;
    const generatedAt = row.generated_at as number | null;
    const errorMessage = row.error_message as string | null;
    const updatedAt = row.updated_at as number;
    const title = "研究报告（已迁移）";

    await client.execute({
      sql: `INSERT INTO research_reports (id, notebook_id, title, content, generated_at, error_message, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, notebookId, title, content, generatedAt, errorMessage, updatedAt],
    });
  }

  logger.info({ migratedCount: oldRows.rows.length }, "research_reports migration complete");
} else if (tableInfo.rows.length === 0) {
  // Table doesn't exist yet — create fresh
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS research_reports (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      generated_at INTEGER,
      error_message TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reports_notebook
    ON research_reports (notebook_id);
  `);
}
// else: table already has 'id' column — new schema, nothing to do

logger.debug({ path: DB_PATH }, "Database ensured successfully");

export const db = drizzle(client, { schema });
export default db;
