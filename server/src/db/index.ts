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

const BUILTIN_QUICK_READ_PROMPT = `请忽略此前任何对话、提问、回答和中间研究结论，只根据本笔记本当前来源中的文档内容，输出一份中文《书籍简述》。

请你根据当前来源自行识别并填写书名与作者；若信息不足，请明确说明。

请简述《书名》，作者：[作者名]。
要求：
- 核心观点：用1-2句话概括全书主旨
- 内容结构：分3-4个要点说明主要章节或论点
- 关键案例：列举2-3个书中代表性例子
- 适用人群：这本书适合谁读
- 使用 Markdown
- 字数控制在300字以内
- 语言理性、准确、精炼
- 所有内容必须基于笔记本中的文档来源，不得凭空捏造`;

const BUILTIN_DEEP_READING_PROMPT = `请忽略此前任何对话、提问、回答和中间研究结论，只根据本笔记本当前来源中的文档内容，输出一份中文《详细解读》报告。

请按以下结构深度解析一本书籍，总字数控制在5000字以内，确保10分钟内可读完：

【基础信息】
- 书名及英文原版名（如有）
- 作者姓名及背景简介
- 出版时间

【结构与内容】
1. 核心主旨：一句话概括全书思想内核
2. 目录脉络：
   - 全书分几部分、几章，章节间逻辑关系（递进、平行、问题-解决等）
   - 逐章提炼：每章2-3个核心观点 + 1句金句，每章300字以上
3. 独创贡献：列出书中原创概念、模型、工具，并做简要阐释

【价值与意义】
- 对企业的应用价值
- 对个人工作的具体用处
- 局限性及适用边界

【延展阅读】
推荐3-5本同主题相关书籍

写作要求：
- 使用 Markdown
- 每条目不超过200字，多用短句
- 分论点展开，拒绝信息堆砌
- 语言理性、准确、精炼，不发散
- 所有内容必须基于笔记本中的文档来源，不得凭空捏造`;

const BUILTIN_BOOK_MINDMAP_PROMPT = `请忽略此前任何对话、提问、回答和中间研究结论，只根据本笔记本当前来源中的文档内容，输出一份适合转成思维导图的中文结构化摘要。

请按以下结构组织：
- 书名与作者
- 核心主旨
- 核心问题
- 章节结构
- 关键概念
- 论证脉络
- 案例与实践启发

写作要求：
- 使用 Markdown
- 每个部分优先用短段落或短列表
- 信息必须可被后续模型压缩成树状结构
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
          prompt = excluded.prompt,
          updated_at = excluded.updated_at`,
  args: [
    "builtin-book-mindmap",
    "书籍导图",
    "先生成结构化摘要，再转换成 JSON 树导图的阅读产出",
    BUILTIN_BOOK_MINDMAP_PROMPT,
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
          prompt = excluded.prompt,
          updated_at = excluded.updated_at`,
  args: [
    "builtin-deep-reading",
    "详细解读",
    "5000字内的结构化深度解读，覆盖脉络、价值、边界与延展阅读",
    BUILTIN_DEEP_READING_PROMPT,
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
          prompt = excluded.prompt,
          updated_at = excluded.updated_at`,
  args: [
    "builtin-quick-read",
    "书籍简述",
    "300字内概括主旨、结构、案例与适用人群的短版总结",
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
