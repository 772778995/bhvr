import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_ENV_NAMES = ["OPENAI_BASE_URL", "OPENAI_TOKEN", "OPENAI_MODEL"] as const;

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
  wereadRecommendationScore: number | null;
  wereadRecommendationCount: number | null;
  sourceLabel: string;
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

interface DoubanSubjectSuggestItem {
  id?: string | number;
  type?: string;
  title?: string;
  url?: string;
  author_name?: string;
  year?: string;
}

interface DoubanSubjectSearchItem {
  id?: number;
  title?: string;
  url?: string;
  abstract?: string;
  rating?: {
    value?: number;
    count?: number;
  };
}

interface WeReadSearchBookInfo {
  bookId?: string;
  title?: string;
  author?: string;
  publisher?: string;
  intro?: string;
  newRating?: number;
  newRatingCount?: number;
}

interface WeReadHtmlEntry {
  href: string;
  title: string;
  author: string;
  description: string;
}

export interface BookFinderResult {
  normalizedQuery: string;
  results: BookCandidate[];
  markdown: string;
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
): Promise<BookFinderResult> {
  const config = readBookFinderConfig(env);
  const intent = await parseIntent(query, config, fetchImpl).catch(() => buildFallbackIntent(query));
  const searchText = normalizeSearchText(intent.searchText, intent.keywords, query);
  const preferredLanguage = decideLanguagePreference(searchText, intent.languagePreference);
  const searchedCandidates = preferredLanguage === "zh"
    ? await searchChineseBooks(searchText, fetchImpl)
    : await searchOpenLibraryWithFallback(searchText, fetchImpl);
  const candidates = await enrichCandidatesWithMetadata(
    dedupeCandidates(searchedCandidates).slice(0, 30),
    env,
    fetchImpl,
  );

  if (candidates.length === 0) {
    return {
      normalizedQuery: searchText,
      results: [],
      markdown: [
        "当前没有从公开书目数据源检索到足够可靠的结果。建议缩短关键词、改用主题词，或稍后重试。",
      ].join("\n"),
    };
  }

  const results = candidates.slice(0, 10);

  return {
    normalizedQuery: searchText,
    results,
    markdown: renderBookFinderMarkdown(searchText, results),
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
    wereadRecommendationScore: null,
    wereadRecommendationCount: null,
    sourceLabel: "Open Library",
  };
}

async function enrichCandidatesWithMetadata(
  candidates: BookCandidate[],
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<BookCandidate[]> {
  const config = readBookMetadataConfig(env);

  return Promise.all(candidates.map(async (candidate) => {
    try {
      const metadataEnriched = config
        ? await enrichCandidateWithMetadata(candidate, config, fetchImpl)
        : candidate;

      if (metadataEnriched.sourceLabel !== "豆瓣") {
        return metadataEnriched;
      }

      return await enrichCandidateWithWeReadSearch(metadataEnriched, fetchImpl);
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
      infoLink: candidate.infoLink,
      wereadLink,
      wereadRecommendationScore: candidate.wereadRecommendationScore,
      wereadRecommendationCount: candidate.wereadRecommendationCount,
    };
  }

  return candidate;
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

async function searchChineseBooks(query: string, fetchImpl: typeof fetch): Promise<BookCandidate[]> {
  const [suggested, searched] = await Promise.all([
    searchDoubanSuggest(query, fetchImpl).catch(() => []),
    searchDoubanSubjectSearch(query, fetchImpl).catch(() => []),
  ]);

  const candidates = dedupeCandidates([...suggested, ...searched]);
  if (candidates.length === 0) {
    return [];
  }

  return dedupeCandidates(await hydrateDoubanCandidates(candidates, fetchImpl));
}

async function searchDoubanSuggest(query: string, fetchImpl: typeof fetch): Promise<BookCandidate[]> {
  const url = new URL("https://book.douban.com/j/subject_suggest");
  url.searchParams.set("q", query);

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Douban suggest request failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as DoubanSubjectSuggestItem[];
  return payload
    .map((item) => normalizeDoubanSuggestCandidate(item))
    .filter((candidate): candidate is BookCandidate => candidate !== null);
}

async function searchDoubanSubjectSearch(query: string, fetchImpl: typeof fetch): Promise<BookCandidate[]> {
  const url = new URL("https://search.douban.com/book/subject_search");
  url.searchParams.set("search_text", query);

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Douban subject search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const dataText = html.match(/window\.__DATA__\s*=\s*(\{[\s\S]*?\})\s*;/u)?.[1];
  if (!dataText) {
    return [];
  }

  const parsed = parseJsonObject<{ items?: DoubanSubjectSearchItem[] }>(dataText);
  return (parsed.items ?? [])
    .map((item) => normalizeDoubanSearchCandidate(item))
    .filter((candidate): candidate is BookCandidate => candidate !== null);
}

function normalizeDoubanSuggestCandidate(item: DoubanSubjectSuggestItem): BookCandidate | null {
  const subjectId = normalizeDoubanSubjectId(item.id);
  const title = item.title?.trim();
  if (!subjectId || !title || item.type !== "b") {
    return null;
  }

  return buildDoubanCandidate({
    subjectId,
    title,
    authors: splitAuthors(item.author_name),
    publishedYear: item.year?.trim() || "未提供",
    infoLink: normalizeDoubanSubjectUrl(item.url, subjectId),
  });
}

function normalizeDoubanSearchCandidate(item: DoubanSubjectSearchItem): BookCandidate | null {
  const subjectId = normalizeDoubanSubjectId(item.id);
  const title = item.title?.trim();
  if (!subjectId || !title) {
    return null;
  }

  const abstractParts = splitDoubanAbstract(item.abstract);
  return buildDoubanCandidate({
    subjectId,
    title: title.replace(/\s*:\s*/gu, "："),
    authors: abstractParts.authors,
    publisher: abstractParts.publisher,
    publishedYear: abstractParts.publishedYear,
    averageRating: normalizeDoubanRating(item.rating?.value),
    ratingsCount: normalizePositiveInteger(item.rating?.count),
    infoLink: normalizeDoubanSubjectUrl(item.url, subjectId),
  });
}

function buildDoubanCandidate(options: {
  subjectId: string;
  title: string;
  authors?: string[];
  publisher?: string;
  publishedYear?: string;
  description?: string;
  averageRating?: number | null;
  ratingsCount?: number | null;
  infoLink?: string | null;
  isbns?: string[];
}): BookCandidate {
  return {
    id: `douban:${options.subjectId}`,
    title: options.title,
    authors: options.authors ?? [],
    publisher: options.publisher?.trim() || "未提供",
    publishedYear: options.publishedYear?.trim() || "未提供",
    description: normalizeSummary(options.description ?? "豆瓣搜索结果未提供摘要。"),
    categories: [],
    isbns: options.isbns ?? [],
    averageRating: options.averageRating ?? null,
    ratingsCount: options.ratingsCount ?? null,
    ratingSourceLabel: options.averageRating !== null && options.averageRating !== undefined ? "豆瓣" : null,
    ratingScale: options.averageRating !== null && options.averageRating !== undefined ? 10 : null,
    infoLink: options.infoLink ?? `https://book.douban.com/subject/${options.subjectId}/`,
    previewLink: null,
    wereadLink: null,
    wereadRecommendationScore: null,
    wereadRecommendationCount: null,
    sourceLabel: "豆瓣",
  };
}

function normalizeDoubanSubjectId(value: string | number | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^\d+$/u.test(trimmed) ? trimmed : null;
}

function normalizeDoubanSubjectUrl(value: string | undefined, subjectId: string): string {
  const trimmed = value?.trim();
  return trimmed || `https://book.douban.com/subject/${subjectId}/`;
}

function splitAuthors(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[\/／]|\s{2,}|、|,/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitDoubanAbstract(value: string | undefined): {
  authors: string[];
  publisher: string;
  publishedYear: string;
} {
  const parts = (value ?? "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    authors: splitAuthors(parts[0]),
    publisher: parts[1] ?? "未提供",
    publishedYear: parts[2] ?? "未提供",
  };
}

function normalizeDoubanRating(value: number | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

async function hydrateDoubanCandidates(candidates: BookCandidate[], fetchImpl: typeof fetch): Promise<BookCandidate[]> {
  return Promise.all(candidates.map(async (candidate) => {
    try {
      return await hydrateDoubanCandidate(candidate, fetchImpl);
    } catch {
      return candidate;
    }
  }));
}

async function hydrateDoubanCandidate(candidate: BookCandidate, fetchImpl: typeof fetch): Promise<BookCandidate> {
  if (candidate.sourceLabel !== "豆瓣" || !candidate.infoLink) {
    return candidate;
  }

  const response = await fetchImpl(candidate.infoLink);
  if (!response.ok) {
    throw new Error(`Douban detail request failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const title = extractDoubanTitle(html) ?? candidate.title;
  const subtitle = extractDoubanSubtitle(html);
  const info = parseDoubanInfo(html);
  const averageRating = parseDoubanAverageRating(html) ?? candidate.averageRating;
  const ratingsCount = parseDoubanRatingsCount(html) ?? candidate.ratingsCount;
  const description = parseDoubanDescription(html) ?? candidate.description;
  const authors = info.author.length > 0 ? info.author : candidate.authors;
  const isbns = info.isbn.length > 0 ? info.isbn : candidate.isbns;

  return {
    ...candidate,
    title,
    authors,
    publisher: info.publisher || candidate.publisher,
    publishedYear: info.publishedYear || candidate.publishedYear,
    description,
    isbns,
    averageRating,
    ratingsCount,
    ratingSourceLabel: averageRating !== null ? "豆瓣" : candidate.ratingSourceLabel,
    ratingScale: averageRating !== null ? 10 : candidate.ratingScale,
  };
}

function extractDoubanTitle(html: string): string | null {
  return decodeHtmlEntities(
    html.match(/<span\s+property="v:itemreviewed">([\s\S]*?)<\/span>/u)?.[1]?.trim() ?? "",
  ) || null;
}

function extractDoubanSubtitle(html: string): string | null {
  return decodeHtmlEntities(
    html.match(/<span\s+property="v:subtitle">([\s\S]*?)<\/span>/u)?.[1]?.trim() ?? "",
  ) || null;
}

function parseDoubanInfo(html: string): {
  author: string[];
  publisher: string;
  publishedYear: string;
  isbn: string[];
} {
  const infoBlock = html.match(/<div id="info"(?:\s+class="[^"]*")?>([\s\S]*?)<\/div>/u)?.[1] ?? "";
  const authorBlock = infoBlock.match(/作者<\/span>\s*:\s*([\s\S]*?)<br\/?\s*>/u)?.[1] ?? "";
  const authors = [...authorBlock.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gu)]
    .map((match) => decodeHtmlEntities(stripHtml(match[1] ?? "")))
    .filter(Boolean);

  const publisher = decodeHtmlEntities(stripHtml(infoBlock.match(/出版社:<\/span>\s*([\s\S]*?)<br\/?\s*>/u)?.[1] ?? "")) || "未提供";
  const publishedYear = decodeHtmlEntities(stripHtml(infoBlock.match(/出版年:<\/span>\s*([\s\S]*?)<br\/?\s*>/u)?.[1] ?? "")) || "未提供";
  const isbnText = decodeHtmlEntities(stripHtml(infoBlock.match(/ISBN:<\/span>\s*([\s\S]*?)<br\/?\s*>/u)?.[1] ?? ""));

  return {
    author: authors,
    publisher,
    publishedYear,
    isbn: normalizeIsbnList(isbnText ? [isbnText] : []),
  };
}

function parseDoubanAverageRating(html: string): number | null {
  const value = decodeHtmlEntities(stripHtml(html.match(/<strong class="ll rating_num\s*" property="v:average">([\s\S]*?)<\/strong>/u)?.[1] ?? ""));
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDoubanRatingsCount(html: string): number | null {
  const value = decodeHtmlEntities(stripHtml(html.match(/<span property="v:votes">([\s\S]*?)<\/span>/u)?.[1] ?? ""));
  return normalizePositiveInteger(Number.parseInt(value, 10));
}

function parseDoubanDescription(html: string): string | null {
  const expanded = html.match(/<div id="link-report">[\s\S]*?<span class="all hidden">([\s\S]*?)<\/span>/u)?.[1];
  const short = html.match(/<div id="link-report">[\s\S]*?<span class="short">([\s\S]*?)<\/span>/u)?.[1];
  const content = expanded ?? short;
  if (!content) {
    return null;
  }

  const paragraphs = [...content.matchAll(/<p>([\s\S]*?)<\/p>/gu)]
    .map((match) => normalizeSummary(decodeHtmlEntities(stripHtml(match[1] ?? ""))))
    .filter((text) => text && text !== "(展开全部)");
  return paragraphs.length > 0 ? paragraphs.join(" ") : null;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/gu, " ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gu, " ")
    .replace(/&middot;/gu, "·")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">");
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

async function enrichCandidateWithWeReadSearch(candidate: BookCandidate, fetchImpl: typeof fetch): Promise<BookCandidate> {
  if (candidate.wereadLink || !shouldSearchWeRead(candidate)) {
    return candidate;
  }

  const query = buildWeReadSearchQuery(candidate);
  if (!query) {
    return candidate;
  }

  const [jsonResults, htmlEntries] = await Promise.all([
    requestWeReadSearch(query, fetchImpl).catch(() => []),
    requestWeReadSearchHtml(query, fetchImpl).catch(() => []),
  ]);
  const match = findBestWeReadMatch(candidate, jsonResults, htmlEntries);
  if (!match) {
    return candidate;
  }

  return {
    ...candidate,
    description: candidate.description === "未提供" && match.intro ? match.intro : candidate.description,
    publisher: candidate.publisher === "未提供" && match.publisher ? match.publisher : candidate.publisher,
    wereadLink: match.link ?? candidate.wereadLink,
    wereadRecommendationScore: match.recommendationScore,
    wereadRecommendationCount: match.recommendationCount,
  };
}

function shouldSearchWeRead(candidate: BookCandidate): boolean {
  return candidate.sourceLabel === "豆瓣" && candidate.title.trim().length > 0 && candidate.authors.length > 0;
}

function buildWeReadSearchQuery(candidate: BookCandidate): string {
  return [candidate.title, candidate.authors[0]].filter(Boolean).join(" ").trim();
}

async function requestWeReadSearch(query: string, fetchImpl: typeof fetch): Promise<Array<{
  title: string;
  author: string;
  publisher: string;
  intro: string;
  recommendationScore: number | null;
  recommendationCount: number | null;
  bookId: string;
}>> {
  const url = new URL("https://weread.qq.com/web/search/global");
  url.searchParams.set("keyword", query);
  url.searchParams.set("count", "5");

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`WeRead search request failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as { books?: Array<{ bookInfo?: WeReadSearchBookInfo }> };
  return (payload.books ?? [])
    .map((item) => normalizeWeReadBookInfo(item.bookInfo))
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function normalizeWeReadBookInfo(bookInfo: WeReadSearchBookInfo | undefined): {
  title: string;
  author: string;
  publisher: string;
  intro: string;
  recommendationScore: number | null;
  recommendationCount: number | null;
  bookId: string;
} | null {
  const title = bookInfo?.title?.trim();
  const author = bookInfo?.author?.trim();
  const bookId = bookInfo?.bookId?.trim();
  if (!title || !author || !bookId) {
    return null;
  }

  return {
    title,
    author,
    publisher: bookInfo?.publisher?.trim() ?? "",
    intro: normalizeSummary(bookInfo?.intro),
    recommendationScore: normalizeWeReadRecommendationScore(bookInfo?.newRating),
    recommendationCount: normalizePositiveInteger(bookInfo?.newRatingCount),
    bookId,
  };
}

async function requestWeReadSearchHtml(query: string, fetchImpl: typeof fetch): Promise<WeReadHtmlEntry[]> {
  const url = new URL("https://weread.qq.com/web/search/books");
  url.searchParams.set("keyword", query);

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`WeRead HTML search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const itemPattern = /<li class="wr_bookList_item">([\s\S]*?)<\/li>/gu;
  const entries: WeReadHtmlEntry[] = [];

  for (const match of html.matchAll(itemPattern)) {
    const block = match[1] ?? "";
    const href = block.match(/<a href="([^"]+)" class="wr_bookList_item_link"><\/a>/u)?.[1]?.trim();
    const title = decodeHtmlEntities(stripHtml(block.match(/<p class="wr_bookList_item_title">([\s\S]*?)<\/p>/u)?.[1] ?? ""));
    const author = decodeHtmlEntities(stripHtml(block.match(/<p class="wr_bookList_item_author">([\s\S]*?)<\/p>/u)?.[1] ?? ""));
    const description = decodeHtmlEntities(stripHtml(block.match(/<p class="wr_bookList_item_desc">([\s\S]*?)<\/p>/u)?.[1] ?? ""));

    if (!href || !title || !author) {
      continue;
    }

    entries.push({
      href,
      title,
      author,
      description: normalizeSummary(description),
    });
  }

  return entries;
}

function findBestWeReadMatch(
  candidate: BookCandidate,
  jsonResults: Array<{
    title: string;
    author: string;
    publisher: string;
    intro: string;
    recommendationScore: number | null;
    recommendationCount: number | null;
    bookId: string;
  }>,
  htmlEntries: WeReadHtmlEntry[],
): {
  link: string | null;
  intro: string;
  publisher: string;
  recommendationScore: number | null;
  recommendationCount: number | null;
} | null {
  const targetTitle = normalizeKey(candidate.title);
  const targetAuthor = normalizeKey(candidate.authors[0] ?? "");
  const normalizedHtmlEntries = htmlEntries.filter((entry) => {
    return computeLooseMatchScore(targetTitle, normalizeKey(entry.title)) >= 0.6
      && computeLooseMatchScore(targetAuthor, normalizeKey(entry.author)) >= 0.6;
  });

  for (const result of jsonResults) {
    const titleScore = computeLooseMatchScore(targetTitle, normalizeKey(result.title));
    const authorScore = computeLooseMatchScore(targetAuthor, normalizeKey(result.author));
    if (titleScore < 0.6 || authorScore < 0.6) {
      continue;
    }

    const htmlMatch = normalizedHtmlEntries.find((entry) => {
      return computeLooseMatchScore(normalizeKey(entry.title), normalizeKey(result.title)) >= 0.6
        && computeLooseMatchScore(normalizeKey(entry.author), normalizeKey(result.author)) >= 0.6;
    });

    return {
      link: htmlMatch ? normalizeWeReadHref(htmlMatch.href) : null,
      intro: result.intro !== "未提供" ? result.intro : htmlMatch?.description ?? "未提供",
      publisher: result.publisher,
      recommendationScore: result.recommendationScore,
      recommendationCount: result.recommendationCount,
    };
  }

  if (normalizedHtmlEntries.length > 0) {
    const htmlMatch = normalizedHtmlEntries[0];
    if (!htmlMatch) {
      return null;
    }
    return {
      link: normalizeWeReadHref(htmlMatch.href),
      intro: htmlMatch.description,
      publisher: "",
      recommendationScore: null,
      recommendationCount: null,
    };
  }

  return null;
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

function normalizeWeReadHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//u.test(trimmed)) {
    return trimmed;
  }

  return `https://weread.qq.com${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

function normalizeWeReadRecommendationScore(value: number | undefined): number | null {
  return typeof value === "number" && value > 0 ? value / 10 : null;
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

function renderBookBlock(index: number, book: BookCandidate): string[] {
  const authors = book.authors.length > 0 ? book.authors.join("、") : "未提供";
  const categories = book.categories.length > 0 ? book.categories.join("、") : "未提供";
  const links = buildBookLinks(book);
  const ratings = buildBookRatings(book);

  return [
    `${index}. **《${book.title}》**`,
    `- 作者：${authors}`,
    `- 出版社：${book.publisher}`,
    `- 出版年份：${book.publishedYear}`,
    `- 主要内容：${truncateText(book.description || `${book.title} 暂无公开摘要。`, 110)}`,
    `- 特色：${truncateText(buildFeatureCopy(book, categories), 110)}`,
    `- 链接：${links}`,
    ...ratings,
  ];
}

function buildBookLinks(book: BookCandidate): string {
  const links: string[] = [];

  if (book.infoLink) {
    links.push(`[${book.sourceLabel}](${book.infoLink})`);
  }

  if (book.previewLink) {
    links.push(`[公开预览](${book.previewLink})`);
  }

  if (book.wereadLink) {
    links.push(`[微信读书](${book.wereadLink})`);
  }

  return links.length > 0 ? links.join(" | ") : "暂无公开链接";
}

function buildBookRatings(book: BookCandidate): string[] {
  const ratings: string[] = [];

  if (book.averageRating !== null) {
    const sourceLabel = book.ratingSourceLabel ?? book.sourceLabel;
    const ratingScale = book.ratingScale ?? 10;
    ratings.push(`- 【${sourceLabel}】评分：${book.averageRating}/${ratingScale}${book.ratingsCount ? `（${book.ratingsCount} 条评价）` : ""}`);
  }

  if (typeof book.wereadRecommendationScore === "number") {
    ratings.push(`- 【微信读书】推荐值：${book.wereadRecommendationScore.toFixed(1)}%${book.wereadRecommendationCount ? `（${book.wereadRecommendationCount} 人）` : ""}`);
  }

  return ratings.length > 0 ? ratings : ["- 评分：暂无公开数据"];
}

function buildFeatureCopy(book: BookCandidate, categories: string): string {
  const fragments = [
    categories !== "未提供" ? `主题覆盖 ${categories}` : null,
    book.previewLink ? "提供公开预览入口" : null,
    book.averageRating !== null ? "公开评分信息较完整" : null,
    typeof book.wereadRecommendationScore === "number" ? "含微信读书推荐值" : null,
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

function normalizePositiveInteger(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
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
