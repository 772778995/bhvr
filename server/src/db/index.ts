import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import * as schema from "./schema.js";
import { dirname, resolve } from "node:path";
import { resolveDatabasePath } from "./path.js";
import { resolveFilesDir } from "../lib/files-dir.js";
import logger from "../lib/logger.js";

const DB_PATH = resolveDatabasePath();
mkdirSync(dirname(DB_PATH), { recursive: true });

// Ensure data/files/ directory exists (used for audio/PDF/markdown artifact storage)
const filesDir = resolveFilesDir();
mkdirSync(filesDir, { recursive: true });

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

  CREATE TABLE IF NOT EXISTS book_source_stats (
    source_id TEXT PRIMARY KEY NOT NULL,
    source_label TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    empty_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_status TEXT NOT NULL DEFAULT 'failure',
    last_error TEXT,
    last_latency_ms INTEGER,
    last_success_at INTEGER,
    updated_at INTEGER NOT NULL
  );

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

  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'creating',
    title TEXT,
    content_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_artifact_id
  ON artifacts (artifact_id);

  CREATE INDEX IF NOT EXISTS idx_artifacts_notebook
  ON artifacts (notebook_id);

  CREATE TABLE IF NOT EXISTS summary_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    prompt TEXT NOT NULL,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS report_entries (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    title TEXT,
    state TEXT NOT NULL DEFAULT 'ready',
    content TEXT,
    error_message TEXT,
    artifact_id TEXT,
    artifact_type TEXT,
    content_json TEXT,
    file_path TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_report_entries_notebook
  ON report_entries (notebook_id);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_report_entries_artifact_id
  ON report_entries (artifact_id) WHERE artifact_id IS NOT NULL;
`);

// Add preset_id column to research_tasks if it doesn't exist yet (idempotent migration)
const researchTasksInfo = await client.execute("PRAGMA table_info(research_tasks)");
const hasPresetIdColumn = researchTasksInfo.rows.some((row) => row.name === "preset_id");
if (!hasPresetIdColumn) {
  await client.execute("ALTER TABLE research_tasks ADD COLUMN preset_id TEXT REFERENCES summary_presets(id)");
  logger.info("Added preset_id column to research_tasks");
}

// Seed built-in presets (upsert — safe to run on every startup)
const now = Date.now();

const BUILTIN_RESEARCH_REPORT_PROMPT = `请基于该笔记本中的所有来源和此前对话内容，撰写一份系统性中文研究报告。

结构要求：
1. 执行摘要（200-300字）：概述研究背景、核心发现和关键结论
2. 研究方法与数据来源：简述所用来源类型及覆盖范围
3. 核心发现（按主题组织，每个主题需有：）
   - 主要发现陈述
   - 支撑证据与数据（引用具体来源内容）
   - 不同来源间的交叉验证或分歧
4. 深度分析
   - 因果关系与机制分析
   - 趋势与模式识别
   - 局限性与证据空白
5. 结论与建议
   - 核心结论（基于证据的确定性程度分级）
   - 具体可行的建议
   - 后续研究方向

格式要求：
- 使用 Markdown 格式
- 关键数据和引用使用引用块（>）标记来源
- 重要发现使用粗体标注
- 尽量详尽，不要省略细节`;

const BUILTIN_QUICK_READ_PROMPT = `请忽略此前任何对话、提问、回答和中间研究结论，只根据本笔记本当前来源中的文档内容，按照以下框架输出一份书籍解读报告：

1. 基础信息
- 书名
- 英文原版名称（如有）
- 作者（名字及简要介绍）
- 出版时间

2. 结构与内容（快速掌握全书脉络）
- 核心主旨与思想
- 目录脉络（分几个部分，多少章节，章节的逻辑关系；列出每个章节的主要内容和观点，最重要的2-3个内容或观点，以及章节的金句，每个章节不少于300字）
- 独创的概念、模型、方法（概念做解释，模型、工具做适度展开）
- 思维导图（文字版，体现全书结构）

3. 价值与意义（回到组织和工作层面）
- 这本书对读者所在组织的意义
- 对工作有什么用
- 局限性与适用条件

4. 延展阅读（与本书内容主题相关的书籍推荐）

要求：
- 每个条目不超过200字，总体产出文字不超过5000字
- 内容不要堆积，要分论点展开，要用短句子，精辟且易读
- 语言风格要理性、准确，不要随意、发散
- 所有内容必须基于笔记本中的文档来源，不得凭空捏造`;

await client.execute({
  sql: `INSERT INTO summary_presets (id, name, description, prompt, is_builtin, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          prompt = excluded.prompt,
          updated_at = excluded.updated_at`,
  args: [
    "builtin-research-report",
    "生成研究报告",
    "系统性研究报告，含执行摘要、核心发现和结论建议",
    BUILTIN_RESEARCH_REPORT_PROMPT,
    now,
    now,
  ],
});

await client.execute({
  sql: `INSERT INTO summary_presets (id, name, description, prompt, is_builtin, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          updated_at = excluded.updated_at`,
  args: [
    "builtin-quick-read",
    "快速读书",
    "书籍解读框架：基础信息、结构脉络、价值意义、延展阅读",
    BUILTIN_QUICK_READ_PROMPT,
    now,
    now,
  ],
});

logger.debug("Built-in summary presets ensured");

const reportEntriesInfo = await client.execute("PRAGMA table_info(report_entries)");
const hasReportEntryPresetIdColumn = reportEntriesInfo.rows.some((row) => row.name === "preset_id");

if (!hasReportEntryPresetIdColumn && reportEntriesInfo.rows.length > 0) {
  await client.execute("ALTER TABLE report_entries ADD COLUMN preset_id TEXT");
}

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

// One-time migration: seed report_entries from existing research_reports and artifacts
// Uses INSERT OR IGNORE so it is safe to run on every startup.
{
  const entriesInfo = await client.execute("PRAGMA table_info(report_entries)");
  if (entriesInfo.rows.length > 0) {
    // Migrate research_reports → report_entries
    await client.execute(`
      INSERT OR IGNORE INTO report_entries (id, notebook_id, entry_type, title, state, content, error_message, created_at, updated_at)
      SELECT id, notebook_id, 'research_report', title,
             CASE WHEN error_message IS NOT NULL THEN 'failed' ELSE 'ready' END,
             content, error_message,
             COALESCE(generated_at, updated_at), updated_at
      FROM research_reports
    `);

    // Migrate artifacts → report_entries
    await client.execute(`
      INSERT OR IGNORE INTO report_entries (id, notebook_id, entry_type, title, state, artifact_id, artifact_type, content_json, created_at, updated_at)
      SELECT id, notebook_id, 'artifact', title, state, artifact_id, artifact_type, content_json, created_at, updated_at
      FROM artifacts
    `);

    logger.debug("report_entries one-time migration from legacy tables complete");
  }
}

// One-time migration: move research_report content from DB to .md files
{
  const staleRows = await client.execute(
    "SELECT id, content FROM report_entries WHERE entry_type = 'research_report' AND content IS NOT NULL AND file_path IS NULL"
  );
  let migratedCount = 0;
  for (const row of staleRows.rows) {
    const id = String(row.id);
    const content = String(row.content);
    const filename = `report-${id}.md`;
    const fullPath = resolve(filesDir, filename);
    try {
      await writeFile(fullPath, content, "utf-8");
      await client.execute({
        sql: "UPDATE report_entries SET file_path = ?, content = NULL WHERE id = ?",
        args: [filename, id],
      });
      migratedCount++;
    } catch (err) {
      logger.warn({ err, entryId: id }, "failed to migrate report_entry content to file, skipping");
    }
  }
  if (migratedCount > 0) {
    logger.info({ count: migratedCount }, "migrated report_entries content to .md files");
  }
}

logger.debug({ path: DB_PATH }, "Database ensured successfully");

export const db = drizzle(client, { schema });
export default db;
