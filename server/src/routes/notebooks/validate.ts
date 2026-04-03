/**
 * Notebook ID parsing and validation helpers.
 *
 * NotebookLM notebook IDs are hex UUIDs (lowercase, with hyphens) as returned
 * by the notebooklm-kit SDK (field: `projectId`).  They can also appear as the
 * path segment after `/notebook/` in a NotebookLM URL.
 *
 * These helpers are intentionally pure (no I/O, no SDK dependency) so they can
 * be used in any route handler without side-effects.
 */

// ── Regex ─────────────────────────────────────────────────────────────────────

/**
 * Accepts a raw UUID-shaped notebook ID.
 * Example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 */
const NOTEBOOK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Matches the notebook segment from a full NotebookLM URL.
 * Example: "https://notebooklm.google.com/notebook/a1b2c3d4-..."
 */
const NOTEBOOK_URL_RE = /notebook\/([0-9a-f-]{32,})/i;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ParseIdSuccess = { ok: true; id: string };
export type ParseIdFailure = { ok: false; reason: string };
export type ParseIdResult = ParseIdSuccess | ParseIdFailure;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return `true` when `value` matches the expected UUID format for a notebook ID.
 */
export function isValidNotebookId(value: string): boolean {
  return NOTEBOOK_ID_RE.test(value.trim());
}

/**
 * Parse a raw notebook ID from a route parameter or query string value.
 *
 * Accepts:
 *  - A plain UUID-format notebook ID.
 *  - A full NotebookLM URL (extracts the ID segment automatically).
 *
 * Returns a discriminated `ParseIdResult` so callers can distinguish success
 * from failure without catching exceptions.
 *
 * @example
 * ```ts
 * const result = parseNotebookId(c.req.param("id"));
 * if (!result.ok) return c.json({ success: false, message: result.reason }, 400);
 * // result.id is the cleaned notebook ID
 * ```
 */
export function parseNotebookId(raw: string | undefined | null): ParseIdResult {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, reason: "Notebook ID is required" };
  }

  const trimmed = raw.trim();

  // Check whether the caller passed a full URL
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const urlMatch = trimmed.match(NOTEBOOK_URL_RE);
    if (!urlMatch?.[1]) {
      return {
        ok: false,
        reason: "Could not extract a notebook ID from the provided URL",
      };
    }
    const extracted = urlMatch[1];
    if (!isValidNotebookId(extracted)) {
      return {
        ok: false,
        reason: `Extracted segment "${extracted}" is not a valid notebook ID`,
      };
    }
    return { ok: true, id: extracted.toLowerCase() };
  }

  // Plain ID path
  if (!isValidNotebookId(trimmed)) {
    return {
      ok: false,
      reason: `"${trimmed}" is not a valid notebook ID (expected UUID format)`,
    };
  }

  return { ok: true, id: trimmed.toLowerCase() };
}

/**
 * Convenience wrapper: parse and return the ID string directly, or `null` on
 * failure.  Useful for simple guards that don't need a reason string.
 *
 * @example
 * ```ts
 * const id = parseNotebookIdOrNull(c.req.param("id"));
 * if (!id) return c.json(invalidNotebookIdResponse(), 400);
 * ```
 */
export function parseNotebookIdOrNull(
  raw: string | undefined | null
): string | null {
  const result = parseNotebookId(raw);
  return result.ok ? result.id : null;
}
