type Ok<T> = { ok: true; value: T };
type Err = { ok: false; message: string };
type ParseResult<T> = Ok<T> | Err;

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
  const obj = (body ?? {}) as Record<string, unknown>;
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
  const obj = (body ?? {}) as Record<string, unknown>;
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
  const obj = (body ?? {}) as Record<string, unknown>;
  const query = asTrimmedString(obj.query);
  const sourceType =
    asTrimmedString(obj.sourceType).toLowerCase() === "drive" ? "drive" : "web";
  const mode = asTrimmedString(obj.mode).toLowerCase() === "deep" ? "deep" : "fast";

  if (!query) {
    return { ok: false, message: "query is required" };
  }

  if (mode === "deep" && sourceType === "drive") {
    return { ok: false, message: "deep mode only supports web" };
  }

  return { ok: true, value: { query, sourceType, mode } };
}
