import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_ENV_NAMES = ["OPENAI_BASE_URL", "OPENAI_TOKEN", "OPENAI_MODEL"] as const;
const MAX_DEPTH = 4;
const MAX_CHILDREN = 8;
const MAX_LABEL_LENGTH = 48;
const MAX_NOTE_LENGTH = 160;

let loadedEnvTargets = new WeakSet<NodeJS.ProcessEnv>();

export interface BookMindmapNode {
  label: string;
  note?: string;
  children: BookMindmapNode[];
}

export interface BookMindmapPayload {
  kind: "book_mindmap";
  version: 1;
  title: string;
  root: BookMindmapNode;
}

interface OpenAICompatibleConfig {
  baseUrl: string;
  token: string;
  model: string;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

export async function buildBookMindmapFromSummary(
  summaryMarkdown: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<BookMindmapPayload> {
  const config = readOpenAIConfig(env);
  const responseText = await requestModelJson(
    config,
    [
      {
        role: "system",
        content: [
          "你负责把书籍结构化摘要压缩成受约束 JSON 树。",
          "输出必须是 JSON 对象，不要添加代码块。",
          '顶层字段固定为 title、root。',
          'root 和每个子节点只能包含 label、note、children。',
          '最终结构会被包成 kind=book_mindmap、version=1。',
          "label 必须简短，note 最多一句解释。",
          `children 最多 ${MAX_CHILDREN} 个，树深最多 ${MAX_DEPTH} 层。`,
        ].join("\n"),
      },
      {
        role: "user",
        content: `请把下面这份书籍结构化摘要转成导图 JSON 树：\n\n${summaryMarkdown}`,
      },
    ],
    fetchImpl,
  );

  return normalizeBookMindmapPayload(parseJsonObject<Partial<BookMindmapPayload>>(responseText));
}

export function normalizeBookMindmapPayload(value: Partial<BookMindmapPayload>): BookMindmapPayload {
  const title = sanitizeText(value.title, MAX_LABEL_LENGTH) ?? sanitizeText(value.root?.label, MAX_LABEL_LENGTH) ?? "未命名书籍";
  const root = normalizeNode(value.root, 1);

  if (!root) {
    throw new Error("书籍导图 JSON 缺少有效根节点");
  }

  return {
    kind: "book_mindmap",
    version: 1,
    title,
    root,
  };
}

function normalizeNode(value: unknown, depth: number): BookMindmapNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const label = sanitizeText(record.label, MAX_LABEL_LENGTH);
  if (!label) {
    return null;
  }

  const note = sanitizeText(record.note, MAX_NOTE_LENGTH);
  if (depth >= MAX_DEPTH) {
    return note ? { label, note, children: [] } : { label, children: [] };
  }

  const rawChildren = Array.isArray(record.children) ? record.children : [];
  const children = rawChildren
    .slice(0, MAX_CHILDREN)
    .map((child) => normalizeNode(child, depth + 1))
    .filter((child): child is BookMindmapNode => Boolean(child));

  return note ? { label, note, children } : { label, children };
}

function sanitizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length > limit ? normalized.slice(0, limit).trimEnd() : normalized;
}

function readOpenAIConfig(env: NodeJS.ProcessEnv): OpenAICompatibleConfig {
  if (env === process.env) {
    loadWorkspaceEnv(env);
  }
  const missing = REQUIRED_ENV_NAMES.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error("书籍导图依赖 OPENAI_BASE_URL / OPENAI_TOKEN / OPENAI_MODEL 配置");
  }

  return {
    baseUrl: env.OPENAI_BASE_URL!.trim().replace(/\/$/u, ""),
    token: env.OPENAI_TOKEN!.trim(),
    model: env.OPENAI_MODEL!.trim(),
  };
}

function loadWorkspaceEnv(env: NodeJS.ProcessEnv): void {
  if (loadedEnvTargets.has(env)) {
    return;
  }

  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", ".env"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    applyEnvFile(candidate, env);
    loadedEnvTargets.add(env);
    return;
  }

  loadedEnvTargets.add(env);
}

function applyEnvFile(filePath: string, env: NodeJS.ProcessEnv): void {
  const contents = readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) {
      continue;
    }

    const [, key = "", rawValue = ""] = match;
    if (env[key] !== undefined) {
      continue;
    }

    env[key] = stripWrappingQuotes(rawValue.trim());
  }
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

async function requestModelJson(
  config: OpenAICompatibleConfig,
  messages: Array<{ role: "system" | "user"; content: string }>,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI compatible request failed: HTTP ${response.status}${text ? ` ${text}` : ""}`);
  }

  const payload = await response.json() as OpenAIChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const merged = content.map((item) => item.text ?? "").join("\n").trim();
    if (merged) {
      return merged;
    }
  }

  throw new Error("OpenAI compatible response missing message content");
}

function parseJsonObject<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    const extracted = extractFirstJsonObject(value);
    return JSON.parse(extracted) as T;
  }
}

function extractFirstJsonObject(value: string): string {
  const start = value.indexOf("{");
  if (start < 0) {
    throw new Error("Model response did not contain JSON");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  throw new Error("Model response JSON was incomplete");
}
