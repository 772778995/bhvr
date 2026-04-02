/**
 * Task recovery — on server restart, find interrupted tasks and re-enqueue them.
 *
 * Recovery strategy by status:
 * - pending            → re-enqueue from the beginning
 * - generating_questions → questions may be incomplete, re-enqueue from the beginning
 * - asking             → keep answered questions (status=done), resume from first pending/asking/error question
 * - summarizing        → all questions answered, just re-generate the report
 */

import { not, inArray } from "drizzle-orm";
import db from "../db/index.js";
import { researchTasks } from "../db/schema.js";
import { enqueueResearch } from "./research.js";
import logger from "../lib/logger.js";

const TERMINAL_STATUSES = ["done", "error"] as const;

/**
 * Query the database for any tasks that were interrupted mid-flight
 * and re-enqueue them for processing.
 */
export async function recoverInterruptedTasks(): Promise<void> {
  const interrupted = await db
    .select()
    .from(researchTasks)
    .where(not(inArray(researchTasks.status, [...TERMINAL_STATUSES])));

  if (interrupted.length === 0) {
    logger.info("No interrupted tasks to recover");
    return;
  }

  logger.info(
    { count: interrupted.length, tasks: interrupted.map((t) => ({ id: t.id, status: t.status })) },
    "Recovering interrupted tasks"
  );

  for (const task of interrupted) {
    logger.info(
      { taskId: task.id, status: task.status },
      "Re-enqueuing interrupted task"
    );
    enqueueResearch(task.id, { deduplicate: true });
  }
}
