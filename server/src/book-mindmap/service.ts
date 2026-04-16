import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_ENV_NAMES = ["OPENAI_BASE_URL", "OPENAI_TOKEN", "OPENAI_MODEL"] as const;

let loadedEnvTargets = new WeakSet<NodeJS.ProcessEnv>();

export interface MermaidMindmapPayload {
  kind: "mermaid_mindmap";
  version: 1;
  code: string;
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
): Promise<MermaidMindmapPayload> {
  const config = readOpenAIConfig(env);
  const responseText = await requestModelJson(
    config,
    [
      {
        role: "system",
        content: [
          "你负责把书籍结构化摘要压缩成 Mermaid mindmap 代码。",
          "输出只包含 Mermaid 代码本身，不要代码块标记（不要```），不要任何解释。",
          "格式范例：",
          "mindmap",
          "  root((书名))",
          "    核心主旨",
          "      具体观点",
          "    章节结构",
          "      第一章",
          "      第二章",
          "约束：缩进用两个空格，节点文字简短，最多 4 层深度，children 最多 8 个。",
        ].join("\n"),
      },
      {
        role: "user",
        content: `请把下面这份书籍结构化摘要转成 Mermaid mindmap 代码：\n\n${summaryMarkdown}`,
      },
    ],
    fetchImpl,
  );

  return parseMermaidMindmapPayload(responseText);
}

export function parseMermaidMindmapPayload(rawCode: string): MermaidMindmapPayload {
  const extracted = extractMermaidCode(rawCode);
  const sanitized = sanitizeMermaidMindmapCode(extracted);
  if (!sanitized.startsWith("mindmap")) {
    const preview = extracted.trim().slice(0, 50);
    throw new Error(`Mermaid mindmap code must start with 'mindmap', got: ${preview}`);
  }
  return { kind: "mermaid_mindmap", version: 1, code: sanitized };
}

function extractMermaidCode(value: string): string {
  const fenced = value.match(/```(?:mermaid)?\n?([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    return fenced[1];
  }
  return value;
}

/**
 * Cleans LLM-generated Mermaid mindmap code so the Mermaid parser can accept it.
 *
 * Mermaid's mindmap PEG grammar is sensitive to:
 * - Blank lines between nodes (causes parse errors)
 * - Tab characters (Mermaid expects space indentation)
 * - Trailing non-indented lines after the mindmap block (LLM explanations)
 *
 * This function:
 * 1. Finds the "mindmap" header line (skipping any LLM preamble before it)
 * 2. Removes all blank lines
 * 3. Converts tab indentation to 2-space indentation
 * 4. Stops at the first non-indented line after the header (strips LLM postamble)
 */
function sanitizeMermaidMindmapCode(raw: string): string {
  const lines = raw.split(/\r?\n/u);
  const result: string[] = [];
  let pastHeader = false;

  for (const line of lines) {
    // Normalize tabs → 2 spaces per tab stop
    const normalized = line.replace(/\t/gu, "  ");
    const trimmed = normalized.trim();

    // Skip blank lines regardless of position
    if (!trimmed) {
      continue;
    }

    if (!pastHeader) {
      // Scan for the "mindmap" keyword, skipping any LLM preamble
      if (trimmed === "mindmap") {
        pastHeader = true;
        result.push("mindmap");
      }
      continue;
    }

    // After the "mindmap" header, every valid node line must be indented.
    // A non-indented non-blank line signals LLM postamble — stop here.
    if (!normalized.startsWith(" ")) {
      break;
    }

    result.push(normalized);
  }

  return result.join("\n");
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
