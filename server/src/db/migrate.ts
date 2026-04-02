import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../lib/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(
  __dirname,
  process.env.DATABASE_PATH || "../../../data/notebooklm.db"
);
mkdirSync(dirname(DB_PATH), { recursive: true });

const client = createClient({ url: `file:${DB_PATH}` });

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
`);

logger.info({ path: DB_PATH }, "Database migrated successfully");
client.close();
