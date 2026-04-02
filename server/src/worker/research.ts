/**
 * Research orchestrator — drives the full research workflow:
 * 1. Ask NotebookLM to generate research questions
 * 2. Ask each question one-by-one
 * 3. Ask NotebookLM to compile a research report
 *
 * Uses notebooklm-kit SDK (pure HTTP — no browser automation).
 */

import { eq } from "drizzle-orm";
import db from "../db/index.js";
import { researchTasks, questions } from "../db/schema.js";
import { askNotebook, extractNotebookId } from "../notebooklm/index.js";
import logger from "../lib/logger.js";
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

/**
 * Run a full research task.
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

  const { notebookUrl, topic, numQuestions } = task;
  logger.info({ taskId, topic, numQuestions }, "Starting research task");

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
    // === Step 1: Generate research questions ===
    logger.info({ taskId }, "Step 1: Generating research questions");
    await db
      .update(researchTasks)
      .set({ status: "generating_questions" })
      .where(eq(researchTasks.id, taskId));

    const topicContext = topic ? `about "${topic}"` : "";
    const generatePrompt = `Based on the uploaded documents/sources in this notebook, please generate exactly ${numQuestions} in-depth research questions ${topicContext}. These questions should cover different aspects and angles of the material. Format your response as a numbered list (1. Question one, 2. Question two, etc). Only output the numbered list, nothing else.`;

    const generateResult = await askNotebook(notebookId, generatePrompt);

    if (!generateResult.success || !generateResult.answer) {
      logger.error({ taskId, reason: generateResult.error }, "Failed to generate research questions");
      await db
        .update(researchTasks)
        .set({
          status: "error",
          errorMessage:
            generateResult.error || "Failed to generate research questions",
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

    // Update task with actual question count
    await db
      .update(researchTasks)
      .set({
        status: "asking",
        numQuestions: questionList.length,
      })
      .where(eq(researchTasks.id, taskId));

    // === Step 2: Ask each question one-by-one ===
    logger.info({ taskId, questionCount: questionRows.length }, "Step 2: Asking questions");
    for (const qRow of questionRows) {
      // Mark question as in-progress
      await db
        .update(questions)
        .set({ status: "asking" })
        .where(eq(questions.id, qRow.id));

      const result = await askNotebook(notebookId, qRow.questionText);

      if (result.success && result.answer) {
        logger.debug({ taskId, questionId: qRow.id, order: qRow.orderNum }, "Question answered");
        await db
          .update(questions)
          .set({ status: "done", answerText: result.answer })
          .where(eq(questions.id, qRow.id));
      } else {
        logger.error({ taskId, questionId: qRow.id, reason: result.error }, "Failed to get answer for question");
        await db
          .update(questions)
          .set({
            status: "error",
            errorMessage: result.error || "No answer received",
          })
          .where(eq(questions.id, qRow.id));
      }

      // Update progress counter
      await db
        .update(researchTasks)
        .set({
          completedQuestions:
            (
              await db.query.researchTasks.findFirst({
                where: eq(researchTasks.id, taskId),
              })
            )?.completedQuestions! + 1,
        })
        .where(eq(researchTasks.id, taskId));

      // Small delay between questions to be gentle on NotebookLM
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // === Step 3: Compile research report ===
    logger.info({ taskId }, "Step 3: Compiling research report");
    await db
      .update(researchTasks)
      .set({ status: "summarizing" })
      .where(eq(researchTasks.id, taskId));

    const summaryPrompt = `Based on all the sources and documents in this notebook, please compile a comprehensive research report ${topicContext}. The report should include:
1. Executive Summary
2. Key Findings (organized by theme)
3. Detailed Analysis
4. Conclusions and Recommendations

Please be thorough and cite specific information from the sources where possible.`;

    const summaryResult = await askNotebook(notebookId, summaryPrompt);

    if (summaryResult.success && summaryResult.answer) {
      logger.info({ taskId }, "Research task completed successfully");
      await db
        .update(researchTasks)
        .set({
          status: "done",
          report: summaryResult.answer,
          completedAt: new Date(),
        })
        .where(eq(researchTasks.id, taskId));
    } else {
      logger.error({ taskId, reason: summaryResult.error }, "Failed to generate research report");
      await db
        .update(researchTasks)
        .set({
          status: "error",
          errorMessage:
            summaryResult.error || "Failed to generate research report",
        })
        .where(eq(researchTasks.id, taskId));
    }
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
 */
export function enqueueResearch(taskId: string): void {
  logger.info({ taskId }, "Enqueuing research task");
  taskQueue.enqueue(taskId, () => runResearch(taskId));
}
