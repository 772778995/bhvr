import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-openapi";
import { eq, desc } from "drizzle-orm";
import db from "../../db";
import { researchTasks, questions } from "../../db/schema";
import { enqueueResearch } from "../../worker/research";
import { getAuthStatus } from "../../browser/auth";
import { taskQueue } from "../../worker/queue";

const research = new Hono();

const createResearchSchema = z.object({
  notebookUrl: z
    .string()
    .url()
    .refine((url) => url.includes("notebooklm.google.com"), {
      message: "Must be a NotebookLM URL",
    }),
  topic: z.string().optional(),
  numQuestions: z.number().int().min(1).max(100).default(10),
});

// POST /api/research — create and enqueue a research task
research.post("/", async (c) => {
  // Validate auth first
  const authStatus = getAuthStatus();
  if (!authStatus.authenticated) {
    return c.json(
      { error: "Not authenticated. Call POST /api/auth/setup first." },
      401
    );
  }

  let body: z.infer<typeof createResearchSchema>;
  try {
    const raw = await c.req.json();
    body = createResearchSchema.parse(raw);
  } catch (err) {
    return c.json({ error: "Invalid request body", details: err }, 400);
  }

  const taskId = crypto.randomUUID();
  const now = new Date();

  await db.insert(researchTasks).values({
    id: taskId,
    notebookUrl: body.notebookUrl,
    topic: body.topic ?? null,
    numQuestions: body.numQuestions,
    status: "pending",
    completedQuestions: 0,
    createdAt: now,
  });

  // Enqueue for background processing
  enqueueResearch(taskId);

  return c.json(
    {
      id: taskId,
      status: "pending",
      message: "Research task created and queued",
    },
    201
  );
});

// GET /api/research — list all research tasks
research.get("/", async (c) => {
  const tasks = await db.query.researchTasks.findMany({
    orderBy: desc(researchTasks.createdAt),
  });
  return c.json(tasks);
});

// GET /api/research/:id — get task detail with all questions
research.get("/:id", async (c) => {
  const { id } = c.req.param();

  const task = await db.query.researchTasks.findFirst({
    where: eq(researchTasks.id, id),
  });

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const taskQuestions = await db.query.questions.findMany({
    where: eq(questions.taskId, id),
    orderBy: questions.orderNum,
  });

  return c.json({
    ...task,
    questions: taskQuestions,
  });
});

// GET /api/research/:id/status — lightweight progress check
research.get("/:id/status", async (c) => {
  const { id } = c.req.param();

  const task = await db.query.researchTasks.findFirst({
    where: eq(researchTasks.id, id),
    columns: {
      id: true,
      status: true,
      numQuestions: true,
      completedQuestions: true,
      errorMessage: true,
    },
  });

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json({
    ...task,
    queueLength: taskQueue.length,
    queueRunning: taskQueue.isRunning,
  });
});

export default research;
