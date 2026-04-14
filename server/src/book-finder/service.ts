import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { bookSourceAdapters } from "./adapters.js";
import type {
  BookCandidate,
  BookFinderIntent,
  BookFinderResult,
  BookFinderSearchOptions,
  BookSourceAdapter,
  BookSourceSearchContext,
} from "./types.js";

export type {
  BookCandidate,
  BookFinderResult,
  BookFinderSearchOptions,
} from "./types.js";

const REQUIRED_ENV_NAMES = ["OPENAI_BASE_URL", "OPENAI_TOKEN", "OPENAI_MODEL"] as const;

let loadedEnvTargets = new WeakSet<NodeJS.ProcessEnv>();

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

export function listMissingBookFinderConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  loadWorkspaceEnv(env);
  return REQUIRED_ENV_NAMES.filter((name) => !env[name]?.trim());
}

export function renderBookFinderMarkdown(query: string, results: BookCandidate[]): string {
  void query;

  return results
    .flatMap((book, index) => {
      const block = renderBookBlock(index + 1, book);
      return index < results.length - 1 ? [...block, "---", ""] : block;
    })
    .join("\n")
    .trim();
}

export async function findBooksForQuery(
  query: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  options: BookFinderSearchOptions = {},
): Promise<BookFinderResult> {
  const config = readBookFinderConfig(env);
  const intent = await parseIntent(query, config, fetchImpl).catch(() => buildFallbackIntent(query));
  const normalizedQuery = normalizeSearchText(intent.searchText, intent.keywords, query);
  const languagePreference = decideLanguagePreference(normalizedQuery, intent.languagePreference);
  const context: BookSourceSearchContext = {
    normalizedQuery,
    languagePreference,
    fetchImpl,
  };

  const supportedAdapters = bookSourceAdapters.filter((adapter) => {
    return adapter.supports({
      normalizedQuery,
      languagePreference,
    });
  });

  const recordSourceStat = options.recordSourceStat ?? (async () => {});
  const searchedCandidates = await Promise.all(supportedAdapters.map(async (adapter) => {
    const startedAt = Date.now();

    try {
      const candidates = await adapter.search(context);
      await safelyRecordSourceStat(recordSourceStat, {
        sourceId: adapter.id,
        sourceLabel: adapter.label,
        status: candidates.length > 0 ? "success" : "empty",
        latencyMs: Date.now() - startedAt,
      });
      return candidates;
    } catch (error) {
      await safelyRecordSourceStat(recordSourceStat, {
        sourceId: adapter.id,
        sourceLabel: adapter.label,
        status: "failure",
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return [] satisfies BookCandidate[];
    }
  }));

  const candidates = rankCandidates(dedupeCandidates(searchedCandidates.flat()), normalizedQuery).slice(0, 10);

  if (candidates.length === 0) {
    return {
      normalizedQuery,
      results: [],
      markdown: "当前没有从公开书目数据源检索到足够可靠的结果。建议缩短关键词、改用主题词，或稍后重试。",
    };
  }

  return {
    normalizedQuery,
    results: candidates,
    markdown: renderBookFinderMarkdown(normalizedQuery, candidates),
  };
}

async function safelyRecordSourceStat(
  recordSourceStat: NonNullable<BookFinderSearchOptions["recordSourceStat"]>,
  entry: {
    sourceId: string;
    sourceLabel: string;
    status: "success" | "empty" | "failure";
    latencyMs: number;
    error?: string | null;
  },
): Promise<void> {
  try {
    await recordSourceStat(entry);
  } catch {
    // Source statistics are telemetry. They must not change search results.
  }
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

export function resetWorkspaceEnvCacheForTests(): void {
  loadedEnvTargets = new WeakSet<NodeJS.ProcessEnv>();
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

function readBookFinderConfig(env: NodeJS.ProcessEnv): OpenAICompatibleConfig {
  const missing = listMissingBookFinderConfig(env);
  if (missing.length > 0) {
    throw new Error(`快速找书缺少必要配置：${missing.join(", ")}`);
  }

  return {
    baseUrl: env.OPENAI_BASE_URL!.trim().replace(/\/$/u, ""),
    token: env.OPENAI_TOKEN!.trim(),
    model: env.OPENAI_MODEL!.trim(),
  };
}

async function parseIntent(
  query: string,
  config: OpenAICompatibleConfig,
  fetchImpl: typeof fetch,
): Promise<BookFinderIntent> {
  const responseText = await requestModelJson(
    config,
    [
      {
        role: "system",
        content: [
          "你是一个图书检索助手，只负责把用户需求压缩成检索词。",
          "输出必须是 JSON 对象，不要添加代码块。",
          '字段固定为 searchText、keywords、languagePreference。',
          'languagePreference 只能是 "zh"、"en" 或 "any"。',
        ].join("\n"),
      },
      {
        role: "user",
        content: `用户需求：${query}`,
      },
    ],
    fetchImpl,
  );

  const parsed = parseJsonObject<Partial<BookFinderIntent>>(responseText);
  const searchText = typeof parsed.searchText === "string" && parsed.searchText.trim()
    ? parsed.searchText.trim()
    : query.trim();
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8)
    : [];
  const languagePreference = parsed.languagePreference === "zh" || parsed.languagePreference === "en"
    ? parsed.languagePreference
    : "any";

  return {
    searchText,
    keywords,
    languagePreference,
  };
}

function buildFallbackIntent(query: string): BookFinderIntent {
  const normalizedTokens = normalizeSearchTokens(query.split(/[\s,，、]+/u).filter(Boolean));

  return {
    searchText: normalizedTokens.join(" ") || query.trim().replace(/\s+/gu, " "),
    keywords: normalizedTokens.slice(0, 6),
    languagePreference: "any",
  };
}

function normalizeSearchText(searchText: string | undefined, keywords: string[], originalQuery: string): string {
  const normalizedTokens = normalizeSearchTokens([
    ...keywords,
    ...(searchText ? searchText.split(/[\s,，、]+/u) : []),
  ]);

  if (normalizedTokens.length > 0) {
    return normalizedTokens.join(" ");
  }

  return originalQuery.trim().replace(/\s+/gu, " ");
}

function normalizeSearchTokens(tokens: string[]): string[] {
  const stopwords = [
    "帮我",
    "找",
    "一下",
    "一些",
    "和",
    "相关",
    "有关",
    "关于",
    "书",
    "书籍",
    "图书",
    "方面",
    "的",
    "请",
    "推荐",
    "有没有",
  ];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const token of tokens) {
    const trimmed = token.trim().replace(/[？?！!。；;,，]/gu, "");
    if (!trimmed) {
      continue;
    }

    const cleaned = stopwords.reduce((current, word) => current.replaceAll(word, ""), trimmed).trim();
    if (!cleaned || (cleaned.length < 2 && !/[A-Za-z0-9]/u.test(cleaned))) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(cleaned);
  }

  return normalized.slice(0, 6);
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

function decideLanguagePreference(searchText: string, preference: BookFinderIntent["languagePreference"]): "zh" | "en" {
  if (preference === "zh" || preference === "en") {
    return preference;
  }

  if (/[\u4E00-\u9FFF]/u.test(searchText)) {
    return "zh";
  }

  return /[A-Za-z]/u.test(searchText) ? "en" : "zh";
}

function dedupeCandidates(candidates: BookCandidate[]): BookCandidate[] {
  const byKey = new Map<string, BookCandidate>();

  for (const candidate of candidates) {
    const key = `${normalizeKey(candidate.title)}::${normalizeKey(candidate.authors[0] ?? "")}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }

    if (scoreCandidateQuality(candidate) > scoreCandidateQuality(existing)) {
      byKey.set(key, candidate);
    }
  }

  return [...byKey.values()];
}

function rankCandidates(candidates: BookCandidate[], query: string): BookCandidate[] {
  return [...candidates].sort((left, right) => scoreRank(right, query) - scoreRank(left, query));
}

function scoreRank(candidate: BookCandidate, query: string): number {
  const normalizedQuery = normalizeKey(query);
  const titleScore = computeLooseMatchScore(normalizedQuery, normalizeKey(candidate.title)) * 50;
  const authorScore = computeLooseMatchScore(normalizedQuery, normalizeKey(candidate.authors.join(" "))) * 10;
  return titleScore + authorScore + scoreCandidateQuality(candidate);
}

function scoreCandidateQuality(candidate: BookCandidate): number {
  return candidate.sourceReliability
    + (candidate.description && candidate.description !== "未提供" ? 8 : 0)
    + (candidate.categories.length > 0 ? 4 : 0)
    + (candidate.isbns.length > 0 ? 4 : 0)
    + (candidate.previewLink ? 2 : 0)
    + (candidate.infoLink ? 1 : 0)
    + (candidate.averageRating ?? 0) * 2
    + (candidate.ratingsCount ?? 0) * 0.01;
}

function computeLooseMatchScore(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if (left.includes(right) || right.includes(left)) {
    return 0.85;
  }

  const leftTokens = left.split(/\s+/u).filter(Boolean);
  const rightTokens = right.split(/\s+/u).filter(Boolean);
  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return overlap / Math.max(leftTokens.length, rightTokens.length, 1);
}

function renderBookBlock(index: number, book: BookCandidate): string[] {
  const authors = book.authors.length > 0 ? book.authors.join("、") : "未提供";
  const categories = book.categories.length > 0 ? book.categories.join("、") : "未提供";

  return [
    `${index}. **《${book.title}》**`,
    `- 作者：${authors}`,
    `- 出版社：${book.publisher}`,
    `- 出版年份：${book.publishedYear}`,
    `- 主要内容：${truncateText(book.description || `${book.title} 暂无公开摘要。`, 110)}`,
    `- 特色：${truncateText(buildFeatureCopy(book, categories), 110)}`,
    `- 链接：${buildBookLinks(book)}`,
    ...buildBookRatings(book),
  ];
}

function buildBookLinks(book: BookCandidate): string {
  const links: string[] = [];

  if (book.infoLink) {
    links.push(`[${book.sourceLabel}](${book.infoLink})`);
  }

  if (book.previewLink) {
    links.push(`[公开获取](${book.previewLink})`);
  }

  return links.length > 0 ? links.join(" | ") : "暂无公开链接";
}

function buildBookRatings(book: BookCandidate): string[] {
  if (book.averageRating !== null) {
    const sourceLabel = book.ratingSourceLabel ?? book.sourceLabel;
    const ratingScale = book.ratingScale ?? 10;
    return [`- 【${sourceLabel}】评分：${book.averageRating}/${ratingScale}${book.ratingsCount ? `（${book.ratingsCount} 条评价）` : ""}`];
  }

  return [];
}

function buildFeatureCopy(book: BookCandidate, categories: string): string {
  const fragments = [
    categories !== "未提供" ? `主题覆盖 ${categories}` : null,
    book.isbns.length > 0 ? `含 ISBN ${book.isbns[0]}` : null,
    book.previewLink ? "提供公开获取入口" : null,
    `来自 ${book.sourceLabel}`,
  ].filter((item): item is string => Boolean(item));

  return fragments.length > 0 ? fragments.join("，") : `${book.title} 的公开元数据较完整，适合继续核查。`;
}

function truncateText(value: string, limit: number): string {
  const normalized = normalizeSummary(value);
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function normalizeSummary(value: string | null | undefined): string {
  if (!value) {
    return "未提供";
  }

  return value
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim() || "未提供";
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, " ").trim();
}
