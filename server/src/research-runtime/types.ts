/**
 * Runtime types for the in-memory notebook research state machine.
 *
 * These types describe the live execution state of an auto-research run
 * for a single notebook. They are never persisted to the database; only
 * the final compiled report is written to the DB.
 */

// ── Status ────────────────────────────────────────────────────────────────────

/**
 * Top-level lifecycle of a research run.
 *
 * idle       – no run has been started for this notebook yet (or the last run
 *              ended and the entry was reset).
 * running    – the orchestrator is actively making progress.
 * failed     – the orchestrator stopped due to an unrecoverable error.
 * completed  – all turns finished successfully.
 */
export type ResearchStatus = "idle" | "running" | "failed" | "completed" | "stopped";

/**
 * Fine-grained step within a running (or just-finished) research loop.
 *
 * idle                – no run has ever been started; used only in synthetic
 *                       snapshots returned when no entry exists in the registry.
 * starting            – orchestrator has been invoked; pre-flight checks running.
 * generating_question – orchestrator is composing or deriving the next question.
 * waiting_answer      – a question has been sent to NotebookLM; awaiting response.
 * refreshing_messages – optional step where the orchestrator signals the client
 *                       that notebook messages should be re-fetched.
 * completed           – all turns completed without error.
 * failed              – the loop was aborted; see lastError on the state object.
 */
export type ResearchStep =
  | "idle"
  | "starting"
  | "generating_question"
  | "waiting_answer"
  | "refreshing_messages"
  | "completed"
  | "stopped"
  | "failed";

// ── State snapshot ────────────────────────────────────────────────────────────

/**
 * Full snapshot of a notebook's current research run.
 * Consumers (SSE subscribers, HTTP GET) always receive a copy of this object.
 */
export interface ResearchRuntimeState {
  /** NotebookLM notebook ID this state belongs to. */
  notebookId: string;

  /** Lifecycle status. */
  status: ResearchStatus;

  /** Current granular step (meaningful when status is "running"). */
  step: ResearchStep;

  /** Number of turns that have completed successfully so far. */
  completedCount: number;

  /** Optional target count for bounded runs; omitted for continuous research. */
  targetCount?: number;

  /** Active NotebookLM conversation id, when known. */
  activeConversationId?: string;

  /** Hidden internal NotebookLM conversation ids, e.g. planner threads. */
  hiddenConversationIds?: string[];

  /** ISO timestamp when this state entry was last mutated. */
  updatedAt: string;

  /** Human-readable error message when status is "failed". */
  lastError?: string;
}

// ── Events ────────────────────────────────────────────────────────────────────

/**
 * Discriminated event union emitted by the registry to SSE subscribers.
 *
 * Each event carries the full current state snapshot so that clients can
 * always reconstruct the latest view from a single message, regardless of
 * missed previous events.
 */
export type ResearchEventType =
  | "snapshot"       // initial or requested state dump
  | "step_changed"   // step or status transitioned
  | "progress"       // completedCount incremented
  | "error"          // run failed
  | "completed"      // run finished all turns
  | "stopped"        // run stopped by user
  | "heartbeat";     // keep-alive (no state change)

export interface ResearchRuntimeEvent {
  /** Event type. Used as the SSE `event:` field. */
  type: ResearchEventType;

  /** ISO timestamp. */
  timestamp: string;

  /**
   * Current state snapshot at the time of emission.
   * Undefined only for heartbeat events.
   */
  payload?: ResearchRuntimeState;
}

// ── Registry subscriber ───────────────────────────────────────────────────────

/**
 * Callback signature for runtime state subscribers.
 * The registry calls this whenever state changes.
 */
export type RuntimeStateListener = (event: ResearchRuntimeEvent) => void;

// ── Ask function contract (injectable) ───────────────────────────────────────

/**
 * Contract for the "ask NotebookLM" capability the orchestrator depends on.
 * Injected at call-time to keep the orchestrator decoupled from the gateway
 * singleton and to allow easy testing with stubs.
 */
export interface AskFn {
  (notebookId: string, question: string): Promise<AskFnResult>;
}

export interface AskFnResult {
  success: boolean;
  answer?: string;
  error?: string;
  conversationId?: string;
}

export interface ResearchDriverQuestionResult {
  success: boolean;
  question?: string;
  error?: string;
  plannerConversationId?: string;
}

export interface ResearchDriverAnswerResult {
  success: boolean;
  answer?: string;
  error?: string;
  conversationId?: string;
}

export interface ResearchDriver {
  nextQuestion(notebookId: string): Promise<ResearchDriverQuestionResult>;
  askQuestion(notebookId: string, question: string): Promise<ResearchDriverAnswerResult>;
  getHiddenConversationIds(): string[];
}

// ── Orchestrator options ──────────────────────────────────────────────────────

export interface OrchestratorOptions {
  /** Number of research turns to execute. If omitted, run continuously until stopped or failed. */
  targetCount?: number;

  /**
   * Delay in milliseconds between consecutive turns.
   * Keeps the load on NotebookLM gentle. Defaults to 2000.
   */
  turnDelayMs?: number;
}
