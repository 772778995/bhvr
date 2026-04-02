/**
 * Research orchestrator — drives the full research workflow:
 * 1. Ask NotebookLM to generate research questions
 * 2. Ask each question one-by-one
 * 3. Ask NotebookLM to compile a research report
 *
 * Supports resuming from the middle on recovery (skips completed steps/questions).
 * Uses notebooklm-kit SDK (pure HTTP — no browser automation).
 */

import { eq, asc } from "drizzle-orm";
import db from "../db/index.js";
import { researchTasks, questions } from "../db/schema.js";
import { askNotebook, extractNotebookId } from "../notebooklm/index.js";
import logger from "../lib/logger.js";
import { retryAsync, isRetryableError, getErrorMessage } from "../lib/retry.js";
import { taskQueue } from "./queue.js";

/**
 * Parse a numbered list of questions from NotebookLM's response.
 * Handles formats like "1. Question text" or "1) Question text".
 */
function parseQuestionList(text: string): string[] {
  const lines = text.split("\n");
  const parsed: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match: "1. text", "1) text", "- text", "• text", "**1.** text"
    const match = trimmed.match(
      /^(?:\*{0,2}\d+[\.\)]\*{0,2}\s*|[-•]\s*)(.+)/
    );
    if (match?.[1]) {
      const q = match[1].trim();
      if (q.length > 10) {
        // Skip very short lines (likely not real questions)
        parsed.push(q);
      }
    }
  }

  return parsed;
}

async function askNotebookWithRetry(
  taskId: string,
  notebookId: string,
  prompt: string,
  context: { step: "generate_questions" | "ask_question" | "summary"; questionId?: string; orderNum?: number }
): Promise<{ success: true; answer: string; citations?: unknown[] }> {
  return retryAsync(
    async () => {
      const result = await askNotebook(notebookId, prompt);
      if (!result.success || !result.answer) {
        throw new Error(result.error || "No answer received");
      }
      return {
        success: true,
        answer: result.answer,
        citations: result.citations,
      };
    },
    {
      maxAttempts: 3,
      baseDelay: 3000,
      backoffFactor: 2,
      isRetryable: (error) => isRetryableError(getErrorMessage(error)),
      onRetry: ({ attempt, nextAttempt, delayMs, error }) => {
        const reason = getErrorMessage(error);
        logger.warn(
          {
            taskId,
            step: context.step,
            questionId: context.questionId,
            orderNum: context.orderNum,
            attempt,
            nextAttempt,
            delayMs,
            reason,
          },
          "NotebookLM request failed, retrying"
        );
      },
    }
  );
}

/**
 * Ask a list of questions sequentially, skipping those already answered.
 * Updates the task's completedQuestions counter after each successful answer.
 */
async function askQuestions(
  taskId: string,
  notebookId: string,
  questionRows: Array<{ id: string; orderNum: number; questionText: string; status: string }>
): Promise<void> {
  for (const qRow of questionRows) {
    // Skip already-completed questions
    if (qRow.status === "done") {
      logger.debug({ taskId, questionId: qRow.id, order: qRow.orderNum }, "Skipping already-answered question");
      continue;
    }

    // Mark question as in-progress
    await db
      .update(questions)
      .set({ status: "asking" })
      .where(eq(questions.id, qRow.id));

    try {
      const result = await askNotebookWithRetry(taskId, notebookId, qRow.questionText, {
        step: "ask_question",
        questionId: qRow.id,
        orderNum: qRow.orderNum,
      });

      logger.debug({ taskId, questionId: qRow.id, order: qRow.orderNum }, "Question answered");
      await db
        .update(questions)
        .set({ status: "done", answerText: result.answer })
        .where(eq(questions.id, qRow.id));

      // Only increment progress counter on success
      const currentTask = await db.query.researchTasks.findFirst({
        where: eq(researchTasks.id, taskId),
      });
      await db
        .update(researchTasks)
        .set({ completedQuestions: (currentTask?.completedQuestions ?? 0) + 1 })
        .where(eq(researchTasks.id, taskId));
    } catch (error) {
      const message = getErrorMessage(error);
      logger.error({ taskId, questionId: qRow.id, reason: message }, "Failed to get answer for question");
      await db
        .update(questions)
        .set({
          status: "error",
          errorMessage: message,
        })
        .where(eq(questions.id, qRow.id));
    }

    // Small delay between questions to be gentle on NotebookLM
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/**
 * Compile the final research report (Step 3).
 */
async function compileSummary(
  taskId: string,
  notebookId: string,
  topic: string | null
): Promise<void> {
  logger.info({ taskId }, "Step 3: Compiling research report");
  await db
    .update(researchTasks)
    .set({ status: "summarizing" })
    .where(eq(researchTasks.id, taskId));

  const topicContext = topic ? `about "${topic}"` : "";
  const summaryPrompt = `Based on all the sources and documents in this notebook, please compile a comprehensive research report ${topicContext}. The report should include:
1. Executive Summary
2. Key Findings (organized by theme)
3. Detailed Analysis
4. Conclusions and Recommendations

Please be thorough and cite specific information from the sources where possible.`;

  try {
    const summaryResult = await askNotebookWithRetry(taskId, notebookId, summaryPrompt, {
      step: "summary",
    });

    logger.info({ taskId }, "Research task completed successfully");
    await db
      .update(researchTasks)
      .set({
        status: "done",
        report: summaryResult.answer,
        completedAt: new Date(),
      })
      .where(eq(researchTasks.id, taskId));
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error({ taskId, reason: message }, "Failed to generate research report");
    await db
      .update(researchTasks)
      .set({
        status: "error",
        errorMessage: message,
      })
      .where(eq(researchTasks.id, taskId));
  }
}

/**
 * Run a research task, supporting resume from any stage.
 *
 * Recovery strategy:
 * - pending / generating_questions → start from Step 1 (generate questions)
 * - asking → skip to Step 2, resume from first unanswered question
 * - summarizing → skip to Step 3 (compile report)
 *
 * Called by the task queue — should not throw (handles errors internally).
 */
async function runResearch(taskId: string): Promise<void> {
  const task = await db.query.researchTasks.findFirst({
    where: eq(researchTasks.id, taskId),
  });

  if (!task) {
    logger.warn({ taskId }, "Research task not found, skipping");
    return;
  }

  const { notebookUrl, topic, numQuestions, status } = task;
  logger.info({ taskId, topic, numQuestions, status }, "Starting research task");

  // Extract notebook ID from URL
  let notebookId: string;
  try {
    notebookId = extractNotebookId(notebookUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ taskId, err }, "Failed to extract notebook ID");
    await db
      .update(researchTasks)
      .set({ status: "error", errorMessage: message })
      .where(eq(researchTasks.id, taskId));
    return;
  }

  try {
    // Determine where to resume based on current status
    const shouldGenerateQuestions = status === "pending" || status === "generating_questions";
    const shouldAskQuestions = shouldGenerateQuestions || status === "asking";
    // summarizing → skip straight to Step 3

    // === Step 1: Generate research questions (skip if resuming from asking/summarizing) ===
    if (shouldGenerateQuestions) {
      logger.info({ taskId }, "Step 1: Generating research questions");
      await db
        .update(researchTasks)
        .set({ status: "generating_questions" })
        .where(eq(researchTasks.id, taskId));

      const topicContext = topic ? `about "${topic}"` : "";
      const generatePrompt = `Based on the uploaded documents/sources in this notebook, please generate exactly ${numQuestions} in-depth research questions ${topicContext}. These questions should cover different aspects and angles of the material. Format your response as a numbered list (1. Question one, 2. Question two, etc). Only output the numbered list, nothing else.`;

      let generateResult: Awaited<ReturnType<typeof askNotebookWithRetry>>;
      try {
        generateResult = await askNotebookWithRetry(taskId, notebookId, generatePrompt, {
          step: "generate_questions",
        });
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ taskId, reason: message }, "Failed to generate research questions");
        await db
          .update(researchTasks)
          .set({
            status: "error",
            errorMessage: message,
          })
          .where(eq(researchTasks.id, taskId));
        return;
      }

      // Parse the question list
      const questionList = parseQuestionList(generateResult.answer);
      if (questionList.length === 0) {
        logger.error({ taskId }, "Could not parse any questions from response");
        await db
          .update(researchTasks)
          .set({
            status: "error",
            errorMessage: `Could not parse questions from response. Raw response: ${generateResult.answer.substring(0, 500)}`,
          })
          .where(eq(researchTasks.id, taskId));
        return;
      }

      // If recovering from generating_questions, clean up any partial questions from previous attempt
      if (status === "generating_questions") {
        const existingQuestions = await db.query.questions.findMany({
          where: eq(questions.taskId, taskId),
        });
        if (existingQuestions.length > 0) {
          logger.info({ taskId, count: existingQuestions.length }, "Cleaning up partial questions from previous attempt");
          await db.delete(questions).where(eq(questions.taskId, taskId));
        }
      }

      // Insert questions into DB
      const questionRows = questionList.map((q, i) => ({
        id: crypto.randomUUID(),
        taskId,
        orderNum: i + 1,
        questionText: q,
        status: "pending" as const,
        createdAt: new Date(),
      }));

      await db.insert(questions).values(questionRows);
      logger.info({ taskId, questionCount: questionList.length }, "Questions generated and stored");

      // Update task with actual question count and advance status
      await db
        .update(researchTasks)
        .set({
          status: "asking",
          numQuestions: questionList.length,
          completedQuestions: 0,
        })
        .where(eq(researchTasks.id, taskId));
    }

    // === Step 2: Ask each question one-by-one ===
    if (shouldAskQuestions) {
      // Load questions from DB (supports both fresh and resumed runs)
      const existingQuestions = await db.query.questions.findMany({
        where: eq(questions.taskId, taskId),
        orderBy: [asc(questions.orderNum)],
      });

      if (existingQuestions.length === 0) {
        logger.error({ taskId }, "No questions found for asking step");
        await db
          .update(researchTasks)
          .set({ status: "error", errorMessage: "No questions found in DB for asking step" })
          .where(eq(researchTasks.id, taskId));
        return;
      }

      const doneCount = existingQuestions.filter((q) => q.status === "done").length;
      const remainingCount = existingQuestions.length - doneCount;
      logger.info(
        { taskId, total: existingQuestions.length, done: doneCount, remaining: remainingCount },
        "Step 2: Asking questions"
      );

      // Recalculate completedQuestions from actual done count (fixes drift on resume)
      await db
        .update(researchTasks)
        .set({ status: "asking", completedQuestions: doneCount })
        .where(eq(researchTasks.id, taskId));

      await askQuestions(taskId, notebookId, existingQuestions);

      // Check how many questions actually succeeded before compiling
      const answeredQuestions = await db.query.questions.findMany({
        where: eq(questions.taskId, taskId),
      });
      const successCount = answeredQuestions.filter((q) => q.status === "done").length;
      const failedCount = answeredQuestions.filter((q) => q.status === "error").length;

      if (successCount === 0) {
        logger.error({ taskId, failedCount }, "All questions failed — cannot compile report");
        await db
          .update(researchTasks)
          .set({ status: "error", errorMessage: `All ${failedCount} questions failed, no answers to compile` })
          .where(eq(researchTasks.id, taskId));
        return;
      }

      if (failedCount > 0) {
        logger.warn(
          { taskId, successCount, failedCount },
          "Some questions failed — proceeding with partial report"
        );
      }
    }

    // === Step 3: Compile research report ===
    await compileSummary(taskId, notebookId, topic);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ taskId, err }, "Research task failed with unexpected error");
    await db
      .update(researchTasks)
      .set({ status: "error", errorMessage: message })
      .where(eq(researchTasks.id, taskId));
  }
}

/**
 * Enqueue a research task for processing.
 * If `deduplicate` is true, skips enqueuing when the task ID is already in the queue.
 */
export function enqueueResearch(taskId: string, { deduplicate = false } = {}): void {
  if (deduplicate) {
    const enqueued = taskQueue.enqueueIfNotPresent(taskId, () => runResearch(taskId));
    if (!enqueued) {
      logger.info({ taskId }, "Task already in queue, skipping");
      return;
    }
  } else {
    taskQueue.enqueue(taskId, () => runResearch(taskId));
  }
  logger.info({ taskId }, "Enqueuing research task");
}
