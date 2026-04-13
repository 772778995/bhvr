/**
 * Research orchestrator — drives the 20-turn auto-research loop for a single
 * notebook, updating the in-memory registry at each step.
 *
 * Design:
 * - The orchestrator is invoked from a route handler but immediately returns
 *   (fire-and-forget via an unawaited async call). The HTTP request resolves
 *   with 202 while the loop runs in the background.
 * - The `askFn` dependency is injected so the orchestrator is not tightly
 *   coupled to the gateway singleton; this also makes it easy to test.
 * - All state updates go through the registry so SSE subscribers receive
 *   real-time progress events.
 */

import logger from "../lib/logger.js";
import { insertChatMessage } from "../db/chat-messages.js";
import * as registry from "./registry.js";
import type { OrchestratorOptions, ResearchDriver } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TURN_DELAY_MS = 2000;

// ── Question generation ───────────────────────────────────────────────────────

/**
 * Build the prompt sent to NotebookLM to generate research questions.
 * Returns a single prompt that asks for a numbered list of `count` questions.
 */
function buildQuestionGenerationPrompt(count: number): string {
  return (
    `请根据本笔记本中的来源和文档，生成恰好 ${count} 个有深度的研究问题，` +
    `覆盖材料的不同方面和角度。` +
    `请以编号列表格式回复（1. 问题一，2. 问题二，以此类推）。` +
    `只输出编号列表，不要输出其他内容。`
  );
}

function buildFallbackQuestions(count: number): string[] {
  const templates = [
    "这份资料最核心的研究问题是什么？请给出完整分析与依据。",
    "这些来源中最关键的结论、观点或事实分别是什么？",
    "不同来源之间有哪些一致、冲突或互补之处？",
    "如果从背景、现状、趋势三个维度分析，这个主题应如何拆解？",
    "这项主题背后的主要驱动因素、约束条件和风险分别是什么？",
    "有哪些容易被忽略但实际影响较大的细节或边缘案例？",
    "如果要向非专业读者解释，这个主题最重要的三个认识是什么？",
    "当前材料支持哪些结论，又有哪些结论仍然证据不足？",
    "从实践应用角度看，这些内容最值得采取的行动建议是什么？",
    "如果继续深入研究，下一个最值得追问的问题是什么？",
  ];

  return Array.from({ length: count }, (_, index) => {
    const base = templates[index % templates.length] ?? templates[0]!;
    return count <= templates.length ? base : `${base}（第 ${index + 1} 轮）`;
  });
}

function getFallbackQuestion(index: number): string {
  return buildFallbackQuestions(index + 1)[index] ?? buildFallbackQuestions(1)[0]!;
}

/**
 * Parse a numbered list out of NotebookLM's plain-text response.
 * Accepts formats: "1. text", "1) text", "- text", "• text", "**1.** text".
 */
function parseQuestionList(text: string): string[] {
  const lines = text.split("\n");
  const parsed: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:\*{0,2}\d+[\.\)]\*{0,2}\s*|[-•]\s*)(.+)/);
    if (match?.[1]) {
      const q = match[1].trim();
      if (q.length > 10) {
        parsed.push(q);
      }
    }
  }

  return parsed;
}

/**
 * Small helper that resolves after `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Core loop ─────────────────────────────────────────────────────────────────

/**
 * Run the 20-turn research loop for a notebook.
 *
 * This function is intentionally `async` and should be called without `await`
 * from the route handler so it runs in the background.
 *
 * Steps:
 * 1. Mark the runtime as starting.
 * 2. Ask NotebookLM to generate `targetCount` research questions.
 * 3. For each question, emit step events and ask NotebookLM.
 * 4. Mark the runtime as completed (or failed on error).
 *
 * @param notebookId - The NotebookLM notebook project ID.
 * @param askFn      - Injected function that performs a single chat turn.
 * @param options    - Tunable parameters (target turn count, inter-turn delay).
 */
export async function runAutoResearch(
  notebookId: string,
  driver: ResearchDriver,
  options: OrchestratorOptions = {}
): Promise<void> {
  const targetCount = options.targetCount;
  const turnDelayMs = options.turnDelayMs ?? DEFAULT_TURN_DELAY_MS;

  logger.info({ notebookId, targetCount }, "orchestrator: starting auto-research loop");

  // Step 1: transition to running/starting
  try {
    registry.start(notebookId, targetCount);
  } catch (err) {
    // start() throws if already running — this is a guard, caller should have checked
    logger.warn({ notebookId, err }, "orchestrator: start() rejected (already running?)");
    return;
  }

  for (let i = 0; targetCount === undefined || i < targetCount; i++) {
    if (registry.shouldStop(notebookId)) {
      registry.stop(notebookId);
      logger.info({ notebookId, completedCount: registry.get(notebookId)?.completedCount ?? 0 }, "orchestrator: auto-research stopped by request");
      return;
    }

    registry.update(notebookId, { step: "generating_question" });

    const turnStart = Date.now();
    let question: string;
    try {
      const nextQuestion = await driver.nextQuestion(notebookId);
      if (!nextQuestion.success || !nextQuestion.question) {
        question = getFallbackQuestion(i);
        logger.warn(
          { notebookId, turn: i + 1, error: nextQuestion.error },
          "orchestrator: planner returned no question, using fallback question"
        );
      } else {
        question = nextQuestion.question;
        logger.info(
          { notebookId, turn: i + 1, question: question.slice(0, 120) },
          "orchestrator: question generated"
        );
        registry.update(notebookId, {
          hiddenConversationIds: driver.getHiddenConversationIds(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ notebookId, turn: i + 1, err }, "orchestrator: next-question generation failed");
      registry.fail(notebookId, message);
      return;
    }

    logger.info({ notebookId, turn: i + 1 }, "orchestrator: asking question");

    registry.update(notebookId, { step: "waiting_answer" });

    try {
      const result = await driver.askQuestion(notebookId, question);

      if (!result.success) {
        // Non-fatal: log and continue with next question.
        // Do NOT increment completedCount — only successful turns count.
        logger.warn(
          { notebookId, turn: i + 1, error: result.error },
          "orchestrator: question failed (non-fatal, continuing)"
        );
        registry.update(notebookId, { step: "refreshing_messages" });
      } else {
        const turnMs = Date.now() - turnStart;
        logger.info(
          { notebookId, turn: i + 1, answerChars: result.answer?.length ?? 0, turnMs },
          "orchestrator: answer received"
        );
        const currentState = registry.get(notebookId);
        const newCount = (currentState?.completedCount ?? 0) + 1;

        // Persist Q&A to DB so SSE-triggered refreshMessages() picks them up.
        // Non-fatal: a failed write must not interrupt the research loop.
        try {
          await insertChatMessage({
            id: crypto.randomUUID(),
            notebookId,
            role: "user",
            content: question,
            source: "research",
          });
          await insertChatMessage({
            id: crypto.randomUUID(),
            notebookId,
            role: "assistant",
            content: result.answer ?? "",
            source: "research",
          });
        } catch (dbErr) {
          logger.warn({ notebookId, turn: i + 1, err: dbErr }, "orchestrator: failed to persist Q&A to DB (non-fatal)");
        }

        registry.update(notebookId, {
          step: "refreshing_messages",
          completedCount: newCount,
          ...(result.conversationId ? { activeConversationId: result.conversationId } : {}),
          hiddenConversationIds: driver.getHiddenConversationIds(),
        });

        // Feed the Q&A summary back to the planner so it can generate
        // progressively deeper, non-repetitive follow-up questions.
        try {
          const answer = result.answer ?? "";
          const summary = `上一轮研究：\n问题：${question}\n回答摘要：${answer.substring(0, 200)}${answer.length > 200 ? "…" : ""}`;
          await driver.feedContext(summary);
        } catch (feedErr) {
          logger.warn({ notebookId, turn: i + 1, err: feedErr }, "orchestrator: feedContext failed (non-fatal)");
        }

        if (registry.shouldStop(notebookId)) {
          registry.stop(notebookId);
          logger.info({ notebookId, completedCount: registry.get(notebookId)?.completedCount ?? 0 }, "orchestrator: auto-research stopped by request");
          return;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ notebookId, turn: i + 1, err }, "orchestrator: unexpected error during turn");
      registry.fail(notebookId, message);
      return;
    }

    // Delay between turns to avoid hammering NotebookLM
    if (targetCount === undefined || i < targetCount - 1) {
      await sleep(turnDelayMs);
    }
  }

  registry.complete(notebookId);
  logger.info(
    { notebookId, completedCount: registry.get(notebookId)?.completedCount ?? 0 },
    "orchestrator: auto-research completed"
  );
}

/**
 * Check whether a research run is currently active for the given notebook.
 * Route handlers use this to return 409 instead of starting a duplicate run.
 */
export function isRunning(notebookId: string): boolean {
  return registry.get(notebookId)?.status === "running";
}
