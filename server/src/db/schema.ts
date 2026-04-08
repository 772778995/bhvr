import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

export const researchReports = sqliteTable("research_reports", {
  notebookId: text("notebook_id").primaryKey(),
  content: text("content"),
  generatedAt: integer("generated_at", { mode: "timestamp" }),
  errorMessage: text("error_message"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const researchTasks = sqliteTable("research_tasks", {
  id: text("id").primaryKey(),
  notebookUrl: text("notebook_url").notNull(),
  topic: text("topic"),
  status: text("status", {
    enum: ["pending", "generating_questions", "asking", "summarizing", "done", "error"],
  })
    .notNull()
    .default("pending"),
  numQuestions: integer("num_questions").notNull().default(10),
  completedQuestions: integer("completed_questions").notNull().default(0),
  report: text("report"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const questions = sqliteTable("questions", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => researchTasks.id),
  orderNum: integer("order_num").notNull(),
  questionText: text("question_text").notNull(),
  answerText: text("answer_text"),
  status: text("status", {
    enum: ["pending", "asking", "done", "error"],
  })
    .notNull()
    .default("pending"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const notebookSourceStates = sqliteTable(
  "notebook_source_states",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    notebookId: text("notebook_id").notNull(),
    sourceId: text("source_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    notebookSourceUnique: uniqueIndex("notebook_source_unique").on(
      table.notebookId,
      table.sourceId
    ),
  })
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    notebookId: text("notebook_id").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    source: text("source", { enum: ["manual", "research"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    notebookIdIdx: index("chat_messages_notebook_id").on(
      table.notebookId,
      table.createdAt
    ),
  })
);
