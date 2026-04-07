type Ok<T> = { ok: true; value: T };
type Err = { ok: false; message: string };
type ParseResult<T> = Ok<T> | Err;

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseUrlBody(
  body: unknown,
): ParseResult<{ url: string; title?: string }> {
  const obj = asObject(body);
  if (!obj) {
    return { ok: false, message: "Invalid request body" };
  }

  const url = asTrimmedString(obj.url);
  const title = asTrimmedString(obj.title);

  if (!url || !isHttpUrl(url)) {
    return { ok: false, message: "Invalid url" };
  }

  return {
    ok: true,
    value: {
      url,
      ...(title ? { title } : {}),
    },
  };
}

export function parseTextBody(
  body: unknown,
): ParseResult<{ title: string; content: string }> {
  const obj = asObject(body);
  if (!obj) {
    return { ok: false, message: "Invalid request body" };
  }

  const title = asTrimmedString(obj.title);
  const content = asTrimmedString(obj.content);

  if (!title) {
    return { ok: false, message: "title is required" };
  }

  if (!content) {
    return { ok: false, message: "content is required" };
  }

  return { ok: true, value: { title, content } };
}

export function parseSearchBody(
  body: unknown,
): ParseResult<{ query: string; sourceType: "web" | "drive"; mode: "fast" | "deep" }> {
  const obj = asObject(body);
  if (!obj) {
    return { ok: false, message: "Invalid request body" };
  }

  const query = asTrimmedString(obj.query);
  const hasSourceType = Object.hasOwn(obj, "sourceType");
  const hasMode = Object.hasOwn(obj, "mode");
  const rawSourceType = hasSourceType ? asTrimmedString(obj.sourceType).toLowerCase() : "";
  const rawMode = hasMode ? asTrimmedString(obj.mode).toLowerCase() : "";

  if (hasSourceType && (rawSourceType !== "web" && rawSourceType !== "drive")) {
    return { ok: false, message: "sourceType must be web or drive" };
  }

  if (hasMode && (rawMode !== "fast" && rawMode !== "deep")) {
    return { ok: false, message: "mode must be fast or deep" };
  }

  const sourceType = rawSourceType === "drive" ? "drive" : "web";
  const mode = rawMode === "deep" ? "deep" : "fast";

  if (!query) {
    return { ok: false, message: "query is required" };
  }

  if (mode === "deep" && sourceType === "drive") {
    return { ok: false, message: "deep mode only supports web" };
  }

  return { ok: true, value: { query, sourceType, mode } };
}

export function parseDiscoveredSourcesBody(
  body: unknown,
): ParseResult<{ sessionId: string; sourceIds: string[] }> {
  const obj = asObject(body);
  if (!obj) {
    return { ok: false, message: "Invalid request body" };
  }

  const sessionId = asTrimmedString(obj.sessionId);
  if (!sessionId) {
    return { ok: false, message: "sessionId is required" };
  }

  if (!Array.isArray(obj.sourceIds)) {
    return { ok: false, message: "sourceIds is required" };
  }

  const sourceIds = obj.sourceIds.map((value) => asTrimmedString(value));
  if (sourceIds.length === 0) {
    return { ok: false, message: "sourceIds must contain at least one id" };
  }

  if (sourceIds.some((value) => !value)) {
    return { ok: false, message: "sourceIds must contain non-empty strings" };
  }

  return { ok: true, value: { sessionId, sourceIds } };
}
