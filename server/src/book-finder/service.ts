import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_ENV_NAMES = ["OPENAI_BASE_URL", "OPENAI_TOKEN", "OPENAI_MODEL"] as const;

const FOUNDATION_KEYWORDS = ["入门", "基础", "导论", "原理", "经典", "教程", "handbook", "introduction", "fundamentals", "beginner", "classic"];
const PRACTICE_KEYWORDS = ["企业", "管理", "商业", "案例", "实践", "组织", "领导", "运营", "strategy", "business", "leadership", "practice", "case"];
const LOGIC_KEYWORDS = ["底层", "逻辑", "心理", "思维", "哲学", "历史", "社会", "系统", "logic", "psychology", "philosophy", "systems", "history"];

let loadedEnvTargets = new WeakSet<NodeJS.ProcessEnv>();

export interface BookCandidate {
  id: string;
  title: string;
  authors: string[];
  publisher: string;
  publishedYear: string;
  description: string;
  categories: string[];
  averageRating: number | null;
  ratingsCount: number | null;
  infoLink: string | null;
  previewLink: string | null;
  sourceLabel: string;
}

export interface BookSelection {
  foundationIds: string[];
  practiceIds: string[];
  logicIds: string[];
  topRatedIds: string[];
}

export interface BookFinderSections {
  foundation: BookCandidate[];
  practice: BookCandidate[];
  logic: BookCandidate[];
  topRated: BookCandidate[];
}

interface BookFinderIntent {
  searchText: string;
  keywords: string[];
  languagePreference: "zh" | "en" | "any";
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

export interface BookFinderResult {
  normalizedQuery: string;
  sections: BookFinderSections;
  markdown: string;
}

export function listMissingBookFinderConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  loadWorkspaceEnv(env);
  return REQUIRED_ENV_NAMES.filter((name) => !env[name]?.trim());
}

export function sanitizeBookSelection(selection: BookSelection, candidates: BookCandidate[]): BookSelection {
  const allowedIds = new Set(candidates.map((candidate) => candidate.id));
  return {
    foundationIds: sanitizeIdList(selection.foundationIds, allowedIds),
    practiceIds: sanitizeIdList(selection.practiceIds, allowedIds),
    logicIds: sanitizeIdList(selection.logicIds, allowedIds),
    topRatedIds: sanitizeIdList(selection.topRatedIds, allowedIds),
  };
}

export function renderBookFinderMarkdown(query: string, sections: BookFinderSections): string {
  const parts = [
    "# 快速找书结果",
    "",
    `检索主题：${query}`,
    "",
    "说明：以下书目信息来自公开书目数据源；微信读书可读性、评分和入口链接当前未核验，缺失字段不会由模型补写。",
    "",
    renderSection("1. 基础教材与经典类", sections.foundation),
    "",
    renderSection("2. 行业与企业实践类", sections.practice),
    "",
    renderSection("3. 底层逻辑与延展类", sections.logic),
    "",
    renderTopRatedSection(sections.topRated),
  ];

  return parts.join("\n").trim();
}

export async function findBooksForQuery(
  query: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<BookFinderResult> {
  const config = readBookFinderConfig(env);
  const intent = await parseIntent(query, config, fetchImpl).catch(() => buildFallbackIntent(query));
  const searchText = intent.searchText || query.trim();
  const candidates = dedupeCandidates([
    ...(await searchGoogleBooks(searchText, fetchImpl)),
    ...(await searchOpenLibrary(searchText, fetchImpl)),
  ]).slice(0, 30);

  if (candidates.length === 0) {
    const emptySections: BookFinderSections = {
      foundation: [],
      practice: [],
      logic: [],
      topRated: [],
    };

    return {
      normalizedQuery: searchText,
      sections: emptySections,
      markdown: [
        "# 快速找书结果",
        "",
        `检索主题：${searchText}`,
        "",
        "当前没有从公开书目数据源检索到足够可靠的结果。建议缩短关键词、改用主题词，或稍后重试。",
      ].join("\n"),
    };
  }

  const modelSelection = await classifyCandidates(searchText, candidates, config, fetchImpl).catch(() => null);
  const sanitizedSelection = sanitizeBookSelection(
    modelSelection ?? buildHeuristicSelection(candidates),
    candidates,
  );
  const filledSelection = fillSelectionGaps(sanitizedSelection, candidates);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  const sections: BookFinderSections = {
    foundation: mapIdsToCandidates(filledSelection.foundationIds, candidateById),
    practice: mapIdsToCandidates(filledSelection.practiceIds, candidateById),
    logic: mapIdsToCandidates(filledSelection.logicIds, candidateById),
    topRated: mapIdsToCandidates(filledSelection.topRatedIds, candidateById),
  };

  return {
    normalizedQuery: searchText,
    sections,
    markdown: renderBookFinderMarkdown(searchText, sections),
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

    const [, key, rawValue] = match;
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
  return {
    searchText: query.trim().replace(/\s+/gu, " "),
    keywords: query.split(/[\s,，、]+/u).filter(Boolean).slice(0, 6),
    languagePreference: "any",
  };
}

async function classifyCandidates(
  query: string,
  candidates: BookCandidate[],
  config: OpenAICompatibleConfig,
  fetchImpl: typeof fetch,
): Promise<BookSelection> {
  const payload = candidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    authors: candidate.authors,
    publisher: candidate.publisher,
    year: candidate.publishedYear,
    categories: candidate.categories,
    description: truncateText(candidate.description, 100),
  }));

  const responseText = await requestModelJson(
    config,
    [
      {
        role: "system",
        content: [
          "你是图书候选分类器。只能使用提供的候选书 ID，不允许创造新 ID。",
          "请把候选书分别归到基础教材与经典类、行业与企业实践类、底层逻辑与延展类。",
          '输出必须是 JSON 对象，字段固定为 foundationIds、practiceIds、logicIds。',
          "每个字段最多返回 5 个 ID。",
        ].join("\n"),
      },
      {
        role: "user",
        content: `用户查询：${query}\n候选书目：${JSON.stringify(payload)}`,
      },
    ],
    fetchImpl,
  );

  const parsed = parseJsonObject<Partial<BookSelection>>(responseText);
  return {
    foundationIds: normalizeStringArray(parsed.foundationIds),
    practiceIds: normalizeStringArray(parsed.practiceIds),
    logicIds: normalizeStringArray(parsed.logicIds),
    topRatedIds: [],
  };
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

async function searchGoogleBooks(query: string, fetchImpl: typeof fetch): Promise<BookCandidate[]> {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "20");
  url.searchParams.set("printType", "books");

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Google Books request failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as {
    items?: Array<{
      id?: string;
      volumeInfo?: {
        title?: string;
        authors?: string[];
        publisher?: string;
        publishedDate?: string;
        description?: string;
        categories?: string[];
        averageRating?: number;
        ratingsCount?: number;
        infoLink?: string;
        previewLink?: string;
      };
    }>;
  };

  return (payload.items ?? [])
    .map((item) => normalizeGoogleCandidate(item))
    .filter((candidate): candidate is BookCandidate => candidate !== null);
}

function normalizeGoogleCandidate(item: {
  id?: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    categories?: string[];
    averageRating?: number;
    ratingsCount?: number;
    infoLink?: string;
    previewLink?: string;
  };
}): BookCandidate | null {
  const volumeInfo = item.volumeInfo;
  const title = volumeInfo?.title?.trim();
  if (!item.id || !title) {
    return null;
  }

  return {
    id: `google:${item.id}`,
    title,
    authors: normalizeStringArray(volumeInfo.authors),
    publisher: volumeInfo.publisher?.trim() ?? "未提供",
    publishedYear: extractYear(volumeInfo.publishedDate),
    description: normalizeSummary(volumeInfo.description),
    categories: normalizeStringArray(volumeInfo.categories),
    averageRating: typeof volumeInfo.averageRating === "number" ? volumeInfo.averageRating : null,
    ratingsCount: typeof volumeInfo.ratingsCount === "number" ? volumeInfo.ratingsCount : null,
    infoLink: volumeInfo.infoLink?.trim() ?? null,
    previewLink: volumeInfo.previewLink?.trim() ?? null,
    sourceLabel: "Google Books",
  };
}

async function searchOpenLibrary(query: string, fetchImpl: typeof fetch): Promise<BookCandidate[]> {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Open Library request failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as {
    docs?: Array<{
      key?: string;
      title?: string;
      author_name?: string[];
      publisher?: string[];
      first_publish_year?: number;
      subject?: string[];
    }>;
  };

  return (payload.docs ?? [])
    .map((doc) => normalizeOpenLibraryCandidate(doc))
    .filter((candidate): candidate is BookCandidate => candidate !== null);
}

function normalizeOpenLibraryCandidate(doc: {
  key?: string;
  title?: string;
  author_name?: string[];
  publisher?: string[];
  first_publish_year?: number;
  subject?: string[];
}): BookCandidate | null {
  const title = doc.title?.trim();
  if (!doc.key || !title) {
    return null;
  }

  return {
    id: `openlibrary:${doc.key}`,
    title,
    authors: normalizeStringArray(doc.author_name),
    publisher: doc.publisher?.[0]?.trim() ?? "未提供",
    publishedYear: typeof doc.first_publish_year === "number" ? String(doc.first_publish_year) : "未提供",
    description: "Open Library 搜索结果未提供摘要。",
    categories: normalizeStringArray(doc.subject).slice(0, 6),
    averageRating: null,
    ratingsCount: null,
    infoLink: `https://openlibrary.org${doc.key}`,
    previewLink: null,
    sourceLabel: "Open Library",
  };
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

function scoreCandidateQuality(candidate: BookCandidate): number {
  return (candidate.averageRating ?? 0) * 20
    + (candidate.ratingsCount ?? 0) * 0.01
    + (candidate.description ? 5 : 0)
    + (candidate.previewLink ? 2 : 0)
    + (candidate.infoLink ? 1 : 0);
}

function buildHeuristicSelection(candidates: BookCandidate[]): BookSelection {
  const usedIds = new Set<string>();
  const foundationIds = selectIdsByKeywords(candidates, FOUNDATION_KEYWORDS, usedIds, 5);
  const practiceIds = selectIdsByKeywords(candidates, PRACTICE_KEYWORDS, usedIds, 5);
  const logicIds = selectIdsByKeywords(candidates, LOGIC_KEYWORDS, usedIds, 5);

  return {
    foundationIds,
    practiceIds,
    logicIds,
    topRatedIds: buildTopRatedIds(candidates),
  };
}

function fillSelectionGaps(selection: BookSelection, candidates: BookCandidate[]): BookSelection {
  const usedIds = new Set<string>();
  const foundationIds = fillIds(selection.foundationIds, candidates, usedIds, 5);
  const practiceIds = fillIds(selection.practiceIds, candidates, usedIds, 5);
  const logicIds = fillIds(selection.logicIds, candidates, usedIds, 5);
  const topRatedIds = selection.topRatedIds.length > 0 ? selection.topRatedIds : buildTopRatedIds(candidates);

  return {
    foundationIds,
    practiceIds,
    logicIds,
    topRatedIds,
  };
}

function fillIds(existingIds: string[], candidates: BookCandidate[], usedIds: Set<string>, limit: number): string[] {
  const filled: string[] = [];

  for (const id of existingIds) {
    if (usedIds.has(id)) {
      continue;
    }
    filled.push(id);
    usedIds.add(id);
    if (filled.length >= limit) {
      return filled;
    }
  }

  for (const candidate of candidates) {
    if (usedIds.has(candidate.id)) {
      continue;
    }
    filled.push(candidate.id);
    usedIds.add(candidate.id);
    if (filled.length >= limit) {
      return filled;
    }
  }

  return filled;
}

function buildTopRatedIds(candidates: BookCandidate[]): string[] {
  return candidates
    .filter((candidate) => candidate.averageRating !== null)
    .sort((left, right) => {
      if ((right.averageRating ?? 0) !== (left.averageRating ?? 0)) {
        return (right.averageRating ?? 0) - (left.averageRating ?? 0);
      }
      return (right.ratingsCount ?? 0) - (left.ratingsCount ?? 0);
    })
    .slice(0, 10)
    .map((candidate) => candidate.id);
}

function selectIdsByKeywords(candidates: BookCandidate[], keywords: string[], usedIds: Set<string>, limit: number): string[] {
  return candidates
    .map((candidate) => ({
      id: candidate.id,
      score: keywordScore(candidate, keywords),
      rating: candidate.averageRating ?? 0,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.rating - left.rating;
    })
    .map((entry) => entry.id)
    .filter((id) => !usedIds.has(id))
    .slice(0, limit)
    .map((id) => {
      usedIds.add(id);
      return id;
    });
}

function keywordScore(candidate: BookCandidate, keywords: string[]): number {
  const haystack = [candidate.title, candidate.publisher, candidate.description, ...candidate.categories, ...candidate.authors]
    .join(" ")
    .toLowerCase();

  return keywords.reduce((score, keyword) => score + (haystack.includes(keyword.toLowerCase()) ? 2 : 0), 0);
}

function mapIdsToCandidates(ids: string[], candidateById: Map<string, BookCandidate>): BookCandidate[] {
  return ids
    .map((id) => candidateById.get(id) ?? null)
    .filter((candidate): candidate is BookCandidate => candidate !== null);
}

function renderSection(title: string, books: BookCandidate[]): string {
  if (books.length === 0) {
    return [`## ${title}`, "", "当前公开书目结果不足，暂无可稳定核验的推荐。"].join("\n");
  }

  return [
    `## ${title}`,
    "",
    ...books.flatMap((book, index) => {
      const block = renderBookBlock(index + 1, book);
      return index < books.length - 1 ? [...block, "---", ""] : block;
    }),
  ].join("\n");
}

function renderTopRatedSection(books: BookCandidate[]): string {
  const header = "## 4. 已核验评分最高的书目";
  if (books.length === 0) {
    return [header, "", "当前公开评分数据不足，无法给出可靠排名。"].join("\n");
  }

  return [
    header,
    "",
    ...books.map((book, index) => `${index + 1}. 《${book.title}》${book.infoLink ? `：${book.infoLink}` : ""}`),
  ].join("\n");
}

function renderBookBlock(index: number, book: BookCandidate): string[] {
  const authors = book.authors.length > 0 ? book.authors.join("、") : "未提供";
  const categories = book.categories.length > 0 ? book.categories.join("、") : "未提供";
  const rating = book.averageRating !== null
    ? `${book.sourceLabel} 评分 ${book.averageRating}/5${book.ratingsCount ? `（${book.ratingsCount} 条评价）` : ""}`
    : `${book.sourceLabel} 未提供公开评分`;

  return [
    `${index}. **《${book.title}》**`,
    `- 作者：${authors}`,
    `- 出版社：${book.publisher}`,
    `- 出版年份：${book.publishedYear}`,
    `- 主要内容：${truncateText(book.description || `${book.title} 暂无公开摘要。`, 110)}`,
    `- 特色：${truncateText(buildFeatureCopy(book, categories), 110)}`,
    `- 线上平台与评分：${rating}；微信读书：未核验`,
  ];
}

function buildFeatureCopy(book: BookCandidate, categories: string): string {
  const fragments = [
    categories !== "未提供" ? `主题覆盖 ${categories}` : null,
    book.previewLink ? "提供公开预览入口" : null,
    book.averageRating !== null ? "公开评分信息较完整" : null,
    book.sourceLabel === "Open Library" ? "适合作为补充书目线索" : null,
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
    .trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeIdList(ids: string[], allowedIds: Set<string>): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];

  for (const id of ids) {
    if (!allowedIds.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    sanitized.push(id);
  }

  return sanitized;
}

function extractYear(value: string | undefined): string {
  if (!value) {
    return "未提供";
  }

  const match = value.match(/(19|20)\d{2}/u);
  return match?.[0] ?? value;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, " ").trim();
}
