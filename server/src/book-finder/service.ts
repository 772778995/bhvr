import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_ENV_NAMES = ["OPENAI_BASE_URL", "OPENAI_TOKEN", "OPENAI_MODEL"] as const;

const FOUNDATION_KEYWORDS = ["入门", "基础", "导论", "原理", "经典", "教程", "handbook", "introduction", "fundamentals", "beginner", "classic"];
const PRACTICE_KEYWORDS = ["企业", "管理", "商业", "案例", "实践", "组织", "领导", "运营", "strategy", "business", "leadership", "practice", "case"];
const LOGIC_KEYWORDS = ["底层", "逻辑", "心理", "思维", "哲学", "历史", "社会", "系统", "logic", "psychology", "philosophy", "systems", "history"];

let loadedEnvTargets = new WeakSet<NodeJS.ProcessEnv>();
const DEFAULT_METADATA_TIMEOUT_MS = 3000;

export interface BookCandidate {
  id: string;
  title: string;
  authors: string[];
  publisher: string;
  publishedYear: string;
  description: string;
  categories: string[];
  isbns: string[];
  averageRating: number | null;
  ratingsCount: number | null;
  ratingSourceLabel: string | null;
  ratingScale: number | null;
  infoLink: string | null;
  previewLink: string | null;
  wereadLink: string | null;
  sourceLabel: string;
}

export interface BookSelection {
  foundationIds: string[];
  practiceIds: string[];
  logicIds: string[];
  topRatedIds: string[];
}

export interface DynamicBookSectionSelection {
  title: string;
  bookIds: string[];
}

export interface BookFinderSection {
  title: string;
  books: BookCandidate[];
}

export interface BookFinderSections {
  sections: BookFinderSection[];
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

interface BookMetadataConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
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

export function sanitizeDynamicBookSelection(
  sections: Array<DynamicBookSectionSelection | null | undefined>,
  candidates: BookCandidate[],
): DynamicBookSectionSelection[] {
  const allowedIds = new Set(candidates.map((candidate) => candidate.id));

  return sections
    .map((section) => {
      const title = section?.title?.trim() ?? "";
      const bookIds = sanitizeIdList(section?.bookIds ?? [], allowedIds);
      return title && bookIds.length > 0 ? { title, bookIds } : null;
    })
    .filter((section): section is DynamicBookSectionSelection => section !== null)
    .slice(0, 3);
}

export function renderBookFinderMarkdown(query: string, sections: BookFinderSections): string {
  const parts = [
    ...sections.sections.flatMap((section, index) => index < sections.sections.length - 1
      ? [renderSection(section.title, section.books), "", ""]
      : [renderSection(section.title, section.books)]),
    ...(sections.sections.length > 0 ? [""] : []),
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
  const searchText = normalizeSearchText(intent.searchText, intent.keywords, query);
  const candidates = await enrichCandidatesWithMetadata(
    dedupeCandidates(await searchOpenLibraryWithFallback(searchText, fetchImpl)).slice(0, 30),
    env,
    fetchImpl,
  );

  if (candidates.length === 0) {
    const emptySections: BookFinderSections = {
      sections: [],
      topRated: [],
    };

    return {
      normalizedQuery: searchText,
      sections: emptySections,
      markdown: [
        "当前没有从公开书目数据源检索到足够可靠的结果。建议缩短关键词、改用主题词，或稍后重试。",
      ].join("\n"),
    };
  }

  const modelSections = await classifyCandidates(searchText, candidates, config, fetchImpl).catch(() => null);
  const sanitizedModelSections = modelSections ? sanitizeDynamicBookSelection(modelSections, candidates) : [];
  const sectionSelections = sanitizedModelSections.length > 0
    ? sanitizedModelSections
    : buildHeuristicSections(searchText, candidates);
  const filledSections = fillDynamicSectionGaps(sectionSelections, candidates);
  const topRatedIds = buildTopRatedIds(candidates);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  const sections: BookFinderSections = {
    sections: filledSections.map((section) => ({
      title: section.title,
      books: mapIdsToCandidates(section.bookIds, candidateById),
    })),
    topRated: mapIdsToCandidates(topRatedIds, candidateById),
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

function readBookMetadataConfig(env: NodeJS.ProcessEnv): BookMetadataConfig | null {
  loadWorkspaceEnv(env);
  const baseUrl = env.BOOK_METADATA_BASE_URL?.trim();
  if (!baseUrl) {
    return null;
  }

  const apiKey = env.BOOK_METADATA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("快速找书 metadata bridge 缺少必要配置：BOOK_METADATA_API_KEY");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/u, ""),
    apiKey,
    timeoutMs: readMetadataTimeoutMs(env.BOOK_METADATA_TIMEOUT_MS),
  };
}

function readMetadataTimeoutMs(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_METADATA_TIMEOUT_MS;
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
    if (!cleaned || cleaned.length < 2 && !/[A-Za-z0-9]/u.test(cleaned)) {
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

async function classifyCandidates(
  query: string,
  candidates: BookCandidate[],
  config: OpenAICompatibleConfig,
  fetchImpl: typeof fetch,
): Promise<DynamicBookSectionSelection[]> {
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
          "请把候选书整理为 2 到 3 个分类。",
          '输出必须是 JSON 对象，字段固定为 sections。',
          'sections 中每个元素都必须包含 title 和 bookIds。',
          "title 必须是简洁分类名，不超过 12 个字。",
          "bookIds 只能使用候选书 ID，每个分类最多返回 5 个 ID。",
        ].join("\n"),
      },
      {
        role: "user",
        content: `用户查询：${query}\n候选书目：${JSON.stringify(payload)}`,
      },
    ],
    fetchImpl,
  );

  const parsed = parseJsonObject<Partial<{ sections: Array<Partial<DynamicBookSectionSelection>> }>>(responseText);
  return (parsed.sections ?? []).map((section) => ({
    title: typeof section.title === "string" ? section.title : "",
    bookIds: normalizeStringArray(section.bookIds),
  }));
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
      isbn?: string[];
    }>;
  };

  return (payload.docs ?? [])
    .map((doc) => normalizeOpenLibraryCandidate(doc))
    .filter((candidate): candidate is BookCandidate => candidate !== null);
}

async function searchOpenLibraryWithFallback(query: string, fetchImpl: typeof fetch): Promise<BookCandidate[]> {
  try {
    return await searchOpenLibrary(query, fetchImpl);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("HTTP 422")) {
      throw error;
    }

    const relaxedQuery = buildRelaxedSearchQuery(query);
    if (!relaxedQuery || relaxedQuery === query) {
      return [];
    }

    return await searchOpenLibrary(relaxedQuery, fetchImpl).catch(() => []);
  }
}

function buildRelaxedSearchQuery(query: string): string {
  const tokens = query.split(/[\s,，、]+/u).filter(Boolean);
  return tokens.find((token) => /[A-Za-z0-9]/u.test(token) || token.length >= 4) ?? tokens[0] ?? "";
}

function normalizeOpenLibraryCandidate(doc: {
  key?: string;
  title?: string;
  author_name?: string[];
  publisher?: string[];
  first_publish_year?: number;
  subject?: string[];
  isbn?: string[];
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
    isbns: normalizeIsbnList(doc.isbn),
    averageRating: null,
    ratingsCount: null,
    ratingSourceLabel: null,
    ratingScale: null,
    infoLink: `https://openlibrary.org${doc.key}`,
    previewLink: null,
    wereadLink: null,
    sourceLabel: "Open Library",
  };
}

async function enrichCandidatesWithMetadata(
  candidates: BookCandidate[],
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<BookCandidate[]> {
  const config = readBookMetadataConfig(env);
  if (!config) {
    return candidates;
  }

  return Promise.all(candidates.map(async (candidate) => {
    try {
      return await enrichCandidateWithMetadata(candidate, config, fetchImpl);
    } catch {
      return candidate;
    }
  }));
}

async function enrichCandidateWithMetadata(
  candidate: BookCandidate,
  config: BookMetadataConfig,
  fetchImpl: typeof fetch,
): Promise<BookCandidate> {
  if (candidate.isbns.length === 0) {
    return candidate;
  }

  for (const isbn of candidate.isbns) {
    const metadata = await requestBookMetadataByIsbn(isbn, config, fetchImpl);
    if (!metadata) {
      continue;
    }

    const wereadLink = normalizeOptionalUrl(metadata.weread_url) ?? candidate.wereadLink;
    const description = normalizeSummary(metadata.weread_intro ?? metadata.douban_intro ?? candidate.description);

    return {
      ...candidate,
      title: metadata.title?.trim() || candidate.title,
      authors: metadata.author?.trim() ? [metadata.author.trim()] : candidate.authors,
      publisher: metadata.publisher?.trim() || candidate.publisher,
      publishedYear: metadata.published?.trim() ? extractYear(metadata.published) : candidate.publishedYear,
      description,
      averageRating: typeof metadata.douban_rating === "number" ? metadata.douban_rating : candidate.averageRating,
      ratingSourceLabel: typeof metadata.douban_rating === "number" ? "豆瓣" : candidate.ratingSourceLabel,
      ratingScale: typeof metadata.douban_rating === "number" ? 10 : candidate.ratingScale,
      infoLink: wereadLink ?? candidate.infoLink,
      wereadLink,
    };
  }

  return candidate;
}

async function requestBookMetadataByIsbn(
  isbn: string,
  config: BookMetadataConfig,
  fetchImpl: typeof fetch,
): Promise<{
  title?: string;
  author?: string;
  publisher?: string;
  published?: string;
  douban_rating?: number;
  douban_intro?: string;
  weread_intro?: string;
  weread_url?: string;
} | null> {
  const url = new URL(buildMetadataEndpoint(config.baseUrl));
  url.searchParams.set("isbn", isbn);

  const response = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  }, config.timeoutMs, fetchImpl).catch(() => null);
  if (!response || !response.ok) {
    return null;
  }

  const payload = await response.json() as {
    code?: number;
    data?: {
      title?: string;
      author?: string;
      publisher?: string;
      published?: string;
      douban_rating?: number;
      douban_intro?: string;
      weread_intro?: string;
      weread_url?: string;
    };
  };

  if (payload.code !== 200 || !payload.data) {
    return null;
  }

  return payload.data;
}

async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildMetadataEndpoint(baseUrl: string): string {
  return /\/metadata$/u.test(baseUrl) ? baseUrl : `${baseUrl}/metadata`;
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
    + (candidate.wereadLink ? 2 : 0)
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

function buildHeuristicSections(searchText: string, candidates: BookCandidate[]): DynamicBookSectionSelection[] {
  const selection = buildHeuristicSelection(candidates);
  const topic = buildFallbackTopicLabel(searchText);
  return [
    { title: `${topic}入门与经典`, bookIds: selection.foundationIds },
    { title: `${topic}实践与案例`, bookIds: selection.practiceIds },
    { title: `${topic}思想与延展`, bookIds: selection.logicIds },
  ].filter((section) => section.bookIds.length > 0);
}

function buildFallbackTopicLabel(searchText: string): string {
  const normalized = normalizeSummary(searchText)
    .replace(/[：:]/gu, " ")
    .replace(/[，,、/\\|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (!normalized) {
    return "相关书目";
  }

  return normalized.length > 8 ? `${normalized.slice(0, 7)}…` : normalized;
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

function fillDynamicSectionGaps(
  sections: DynamicBookSectionSelection[],
  candidates: BookCandidate[],
): DynamicBookSectionSelection[] {
  const usedIds = new Set<string>();

  return sections.map((section) => ({
    title: section.title,
    bookIds: fillIds(section.bookIds, candidates, usedIds, 5),
  }));
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
  const ratingSourceLabel = book.ratingSourceLabel ?? book.sourceLabel;
  const ratingScale = book.ratingScale ?? 5;
  const rating = book.averageRating !== null
    ? `${ratingSourceLabel} 评分 ${book.averageRating}/${ratingScale}${book.ratingsCount ? `（${book.ratingsCount} 条评价）` : ""}`
    : "暂无公开评分";
  const wereadStatus = book.wereadLink ? book.wereadLink : "暂无数据";

  return [
    `${index}. **《${book.title}》**`,
    `- 作者：${authors}`,
    `- 出版社：${book.publisher}`,
    `- 出版年份：${book.publishedYear}`,
    `- 主要内容：${truncateText(book.description || `${book.title} 暂无公开摘要。`, 110)}`,
    `- 特色：${truncateText(buildFeatureCopy(book, categories), 110)}`,
    `- 线上平台与评分：${rating}`,
    `- 微信读书：${wereadStatus}`,
  ];
}

function buildFeatureCopy(book: BookCandidate, categories: string): string {
  const fragments = [
    categories !== "未提供" ? `主题覆盖 ${categories}` : null,
    book.previewLink ? "提供公开预览入口" : null,
    book.averageRating !== null ? "公开评分信息较完整" : null,
    book.wereadLink ? "提供微信读书入口" : null,
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

function normalizeIsbnList(value: unknown): string[] {
  return normalizeStringArray(value)
    .map((item) => item.replace(/[^0-9Xx]/gu, ""))
    .filter((item) => item.length === 10 || item.length === 13);
}

function normalizeOptionalUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
