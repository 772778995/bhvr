import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = resolve(process.env.DATABASE_PATH || "../data/notebooklm.db");
mkdirSync(dirname(DB_PATH), { recursive: true });
const sqlite = new Database(DB_PATH, { create: true });

sqlite.exec("PRAGMA journal_mode = WAL;");

sqlite.exec(`
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

console.log("Database migrated successfully at", DB_PATH);
sqlite.close();
