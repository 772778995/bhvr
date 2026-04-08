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

type DiscoveredWebSource = { url: string; title: string; id?: string; type?: string };
type DiscoveredDriveSource = { fileId: string; mimeType: string; title: string; id?: string };

export type ParsedDiscoveredSources = {
  sessionId: string;
  webSources?: DiscoveredWebSource[];
  driveSources?: DiscoveredDriveSource[];
};

export function parseDiscoveredSourcesBody(
  body: unknown,
): ParseResult<ParsedDiscoveredSources> {
  const obj = asObject(body);
  if (!obj) {
    return { ok: false, message: "Invalid request body" };
  }

  const sessionId = asTrimmedString(obj.sessionId);
  if (!sessionId) {
    return { ok: false, message: "sessionId is required" };
  }

  const hasWeb = Object.hasOwn(obj, "webSources");
  const hasDrive = Object.hasOwn(obj, "driveSources");

  if (!hasWeb && !hasDrive) {
    return { ok: false, message: "webSources or driveSources is required" };
  }

  let webSources: DiscoveredWebSource[] | undefined;
  if (hasWeb) {
    if (!Array.isArray(obj.webSources)) {
      return { ok: false, message: "webSources must be an array" };
    }
    const parsed: DiscoveredWebSource[] = [];
    for (const item of obj.webSources) {
      const o = asObject(item);
      if (!o) return { ok: false, message: "webSources items must be objects" };
      const url = asTrimmedString(o.url);
      const title = asTrimmedString(o.title);
      if (!url || !isHttpUrl(url)) return { ok: false, message: "webSources items must have a valid url" };
      if (!title) return { ok: false, message: "webSources items must have a title" };
      const id = asTrimmedString(o.id);
      const type = asTrimmedString(o.type);
      parsed.push({ url, title, ...(id ? { id } : {}), ...(type ? { type } : {}) });
    }
    webSources = parsed;
  }

  let driveSources: DiscoveredDriveSource[] | undefined;
  if (hasDrive) {
    if (!Array.isArray(obj.driveSources)) {
      return { ok: false, message: "driveSources must be an array" };
    }
    const parsed: DiscoveredDriveSource[] = [];
    for (const item of obj.driveSources) {
      const o = asObject(item);
      if (!o) return { ok: false, message: "driveSources items must be objects" };
      const fileId = asTrimmedString(o.fileId);
      const mimeType = asTrimmedString(o.mimeType);
      const title = asTrimmedString(o.title);
      if (!fileId) return { ok: false, message: "driveSources items must have a fileId" };
      if (!mimeType) return { ok: false, message: "driveSources items must have a mimeType" };
      if (!title) return { ok: false, message: "driveSources items must have a title" };
      const id = asTrimmedString(o.id);
      parsed.push({ fileId, mimeType, title, ...(id ? { id } : {}) });
    }
    driveSources = parsed;
  }

  if ((webSources?.length ?? 0) === 0 && (driveSources?.length ?? 0) === 0) {
    return { ok: false, message: "webSources or driveSources must contain at least one item" };
  }

  return {
    ok: true,
    value: {
      sessionId,
      ...(webSources ? { webSources } : {}),
      ...(driveSources ? { driveSources } : {}),
    },
  };
}
