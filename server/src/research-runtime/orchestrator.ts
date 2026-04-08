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
import * as registry from "./registry.js";
import type { AskFn, OrchestratorOptions } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TARGET_COUNT = 20;
const DEFAULT_TURN_DELAY_MS = 2000;

// ── Question generation ───────────────────────────────────────────────────────

/**
 * Build the prompt sent to NotebookLM to generate research questions.
 * Returns a single prompt that asks for a numbered list of `count` questions.
 */
function buildQuestionGenerationPrompt(count: number): string {
  return (
    `Based on the sources and documents in this notebook, please generate exactly ${count} ` +
    `in-depth research questions that cover different aspects and angles of the material. ` +
    `Format your response as a numbered list (1. Question one, 2. Question two, etc.). ` +
    `Only output the numbered list, nothing else.`
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
  askFn: AskFn,
  options: OrchestratorOptions = {}
): Promise<void> {
  const targetCount = options.targetCount ?? DEFAULT_TARGET_COUNT;
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

  // Step 2: generate questions
  registry.update(notebookId, { step: "generating_question" });

  let questions: string[];

  try {
    const genPrompt = buildQuestionGenerationPrompt(targetCount);
    const genResult = await askFn(notebookId, genPrompt);

    if (!genResult.success || !genResult.answer) {
      throw new Error(genResult.error ?? "Empty response from NotebookLM during question generation");
    }

    questions = parseQuestionList(genResult.answer);

    if (questions.length === 0) {
      throw new Error(
        `Could not parse any questions from NotebookLM response. ` +
          `Raw: ${genResult.answer.substring(0, 300)}`
      );
    }

    logger.info({ notebookId, count: questions.length }, "orchestrator: questions parsed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ notebookId, err }, "orchestrator: question generation failed, falling back to built-in prompts");
    questions = buildFallbackQuestions(targetCount);
    registry.update(notebookId, { step: "waiting_answer" });
    logger.info({ notebookId, count: questions.length, fallback: true, reason: message }, "orchestrator: using fallback questions");
  }

  // Clamp to targetCount in case NotebookLM returned more
  const turns = questions.slice(0, targetCount);

  // Step 3: ask each question
  for (let i = 0; i < turns.length; i++) {
    const question = turns[i] as string;

    logger.debug({ notebookId, turn: i + 1, total: turns.length }, "orchestrator: asking question");

    registry.update(notebookId, { step: "waiting_answer" });

    try {
      const result = await askFn(notebookId, question);

      if (!result.success) {
        // Non-fatal: log and continue with next question.
        // Do NOT increment completedCount — only successful turns count.
        logger.warn(
          { notebookId, turn: i + 1, error: result.error },
          "orchestrator: question failed (non-fatal, continuing)"
        );
        registry.update(notebookId, { step: "refreshing_messages" });
      } else {
        logger.debug({ notebookId, turn: i + 1 }, "orchestrator: answer received");
        const currentState = registry.get(notebookId);
        const newCount = (currentState?.completedCount ?? 0) + 1;
        registry.update(notebookId, {
          step: "refreshing_messages",
          completedCount: newCount,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ notebookId, turn: i + 1, err }, "orchestrator: unexpected error during turn");
      registry.fail(notebookId, message);
      return;
    }

    // Delay between turns to avoid hammering NotebookLM
    if (i < turns.length - 1) {
      await sleep(turnDelayMs);
    }
  }

  // Step 4: all turns done
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
