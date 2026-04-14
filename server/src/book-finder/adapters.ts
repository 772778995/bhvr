import type { BookCandidate, BookSourceAdapter, BookSourceSearchContext } from "./types.js";

const OPEN_LIBRARY_LIMIT = 20;
const Z_LIBRARY_DETAIL_LIMIT = 6;
const GUTENBERG_DETAIL_LIMIT = 6;
const REQUEST_TIMEOUT_MS = 8000;

export const bookSourceAdapters: BookSourceAdapter[] = [
  createOpenLibraryAdapter(),
  createAnnaArchiveAdapter(),
  createProjectGutenbergAdapter(),
  createZLibraryAdapter(),
];

function createOpenLibraryAdapter(): BookSourceAdapter {
  return {
    id: "open-library",
    label: "Open Library",
    reliability: 90,
    supports() {
      return true;
    },
    async search(context) {
      try {
        return await searchOpenLibrary(context.normalizedQuery, context);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("HTTP 422")) {
          throw error;
        }

        const relaxedQuery = buildRelaxedSearchQuery(context.normalizedQuery);
        if (!relaxedQuery || relaxedQuery === context.normalizedQuery) {
          return [];
        }

        return await searchOpenLibrary(relaxedQuery, context).catch(() => []);
      }
    },
  };
}

async function searchOpenLibrary(query: string, context: BookSourceSearchContext): Promise<BookCandidate[]> {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(OPEN_LIBRARY_LIMIT));

  const response = await fetchWithTimeout(url, {}, REQUEST_TIMEOUT_MS, context.fetchImpl);
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
    .map((doc) => {
      const title = doc.title?.trim();
      const key = doc.key?.trim();
      if (!title || !key) {
        return null;
      }

      return buildCandidate({
        id: `open-library:${key}`,
        sourceId: "open-library",
        sourceLabel: "Open Library",
        sourceReliability: 90,
        title,
        authors: normalizeStringArray(doc.author_name),
        publisher: doc.publisher?.[0]?.trim() || "未提供",
        publishedYear: typeof doc.first_publish_year === "number" ? String(doc.first_publish_year) : "未提供",
        description: "Open Library 搜索结果未提供摘要。",
        categories: normalizeStringArray(doc.subject).slice(0, 6),
        isbns: normalizeIsbnList(doc.isbn),
        infoLink: `https://openlibrary.org${key}`,
      });
    })
    .filter((candidate): candidate is BookCandidate => candidate !== null);
}

function createAnnaArchiveAdapter(): BookSourceAdapter {
  return {
    id: "anna-archive",
    label: "Anna's Archive",
    reliability: 55,
    supports() {
      return true;
    },
    async search(context) {
      const url = new URL("https://annas-archive.gl/search");
      url.searchParams.set("q", context.normalizedQuery);

      const response = await fetchWithTimeout(url, {}, REQUEST_TIMEOUT_MS, context.fetchImpl);
      if (!response.ok) {
        throw new Error(`Anna's Archive request failed: HTTP ${response.status}`);
      }

      const html = await response.text();
      const blocks = html.split(/<div class="flex\s+pt-3 pb-3 border-b last:border-b-0 border-gray-100">/u).slice(1);

      return blocks
        .map((block) => parseAnnaArchiveCandidate(block))
        .filter((candidate): candidate is BookCandidate => candidate !== null);
    },
  };
}

function createProjectGutenbergAdapter(): BookSourceAdapter {
  return {
    id: "project-gutenberg",
    label: "Project Gutenberg",
    reliability: 85,
    supports(context) {
      return context.languagePreference === "en";
    },
    async search(context) {
      const url = new URL("https://www.gutenberg.org/ebooks/search.opds/");
      url.searchParams.set("query", context.normalizedQuery);

      const response = await fetchWithTimeout(url, {}, REQUEST_TIMEOUT_MS, context.fetchImpl);
      if (!response.ok) {
        throw new Error(`Project Gutenberg request failed: HTTP ${response.status}`);
      }

      const xml = await response.text();
      const entries = extractXmlEntries(xml)
        .map((entry) => parseGutenbergSearchEntry(entry))
        .filter((entry): entry is { detailUrl: string; title: string; authors: string[] } => entry !== null);

      const candidates = await Promise.all(entries.map(async (entry, index) => {
        if (index >= GUTENBERG_DETAIL_LIMIT) {
          return buildCandidate({
            id: `project-gutenberg:${entry.detailUrl}`,
            sourceId: "project-gutenberg",
            sourceLabel: "Project Gutenberg",
            sourceReliability: 85,
            title: entry.title,
            authors: entry.authors,
            publisher: "Project Gutenberg",
            publishedYear: "未提供",
            description: "Project Gutenberg 搜索结果未提供摘要。",
            categories: [],
            isbns: [],
            infoLink: entry.detailUrl.replace(/\.opds$/u, ""),
          });
        }

        try {
          const detailResponse = await fetchWithTimeout(entry.detailUrl, {}, REQUEST_TIMEOUT_MS, context.fetchImpl);
          if (!detailResponse.ok) {
            throw new Error(`Project Gutenberg detail request failed: HTTP ${detailResponse.status}`);
          }

          const detailXml = await detailResponse.text();
          return parseGutenbergDetailEntry(detailXml, entry.detailUrl, entry.title, entry.authors);
        } catch {
          return buildCandidate({
            id: `project-gutenberg:${entry.detailUrl}`,
            sourceId: "project-gutenberg",
            sourceLabel: "Project Gutenberg",
            sourceReliability: 85,
            title: entry.title,
            authors: entry.authors,
            publisher: "Project Gutenberg",
            publishedYear: "未提供",
            description: "Project Gutenberg 搜索结果未提供摘要。",
            categories: [],
            isbns: [],
            infoLink: entry.detailUrl.replace(/\.opds$/u, ""),
          });
        }
      }));

      return candidates.filter((candidate): candidate is BookCandidate => candidate !== null);
    },
  };
}

function createZLibraryAdapter(): BookSourceAdapter {
  return {
    id: "z-library",
    label: "Z-Library",
    reliability: 50,
    supports() {
      return true;
    },
    async search(context) {
      const searchUrl = `https://z-lib.fm/s/${encodeURIComponent(context.normalizedQuery)}`;
      const response = await fetchWithTimeout(searchUrl, {}, REQUEST_TIMEOUT_MS, context.fetchImpl);
      if (!response.ok) {
        throw new Error(`Z-Library request failed: HTTP ${response.status}`);
      }

      const html = await response.text();
      const blocks = [...html.matchAll(/<z-bookcard\b([\s\S]*?)>([\s\S]*?)<\/z-bookcard>/gu)];
      const indexed = blocks
        .map((match) => parseZLibrarySearchCandidate(match[1] ?? "", match[2] ?? ""))
        .filter((candidate): candidate is BookCandidate => candidate !== null);

      const candidates = await Promise.all(indexed.map(async (candidate, index) => {
        if (!candidate.infoLink || index >= Z_LIBRARY_DETAIL_LIMIT) {
          return candidate;
        }

        try {
          const detailResponse = await fetchWithTimeout(candidate.infoLink, {}, REQUEST_TIMEOUT_MS, context.fetchImpl);
          if (!detailResponse.ok) {
            throw new Error(`Z-Library detail request failed: HTTP ${detailResponse.status}`);
          }
          const detailHtml = await detailResponse.text();
          return enrichZLibraryCandidate(candidate, detailHtml);
        } catch {
          return candidate;
        }
      }));

      return candidates;
    },
  };
}

function parseAnnaArchiveCandidate(block: string): BookCandidate | null {
  const titleMatch = block.match(/<a href="(\/md5\/[^"]+)"[^>]*js-vim-focus[^>]*>([\s\S]*?)<\/a>/u);
  if (!titleMatch) {
    return null;
  }

  const infoLink = `https://annas-archive.gl${titleMatch[1]}`;
  const title = decodeHtmlEntities(stripHtml(titleMatch[2] ?? "")).trim();
  if (!title) {
    return null;
  }

  let author = "";
  let publisherRaw = "";
  for (const anchor of block.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gu)) {
    const inner = anchor[2] ?? "";
    const text = decodeHtmlEntities(stripHtml(inner)).trim();
    if (!text) {
      continue;
    }
    if (!author && inner.includes("mdi--user-edit")) {
      author = text;
      continue;
    }
    if (!publisherRaw && inner.includes("mdi--company")) {
      publisherRaw = text;
    }
  }

  const description = normalizeSummary(
    decodeHtmlEntities(
      stripHtml(block.match(/<div class="relative"><div class="line-clamp-\[2\][^"]*">([\s\S]*?)<\/div>/u)?.[1] ?? ""),
    ),
  );

  const metaText = decodeHtmlEntities(
    stripHtml(block.match(/(✅[\s\S]*?)·\s*<a href="#"/u)?.[1] ?? block.match(/<div class="text-gray-800[\s\S]*?mt-2">([\s\S]*?)<\/div>/u)?.[1] ?? ""),
  ).trim();
  const meta = parseSegmentMeta(metaText.replace(/^✅\s*/u, ""));

  return buildCandidate({
    id: `anna-archive:${titleMatch[1]}`,
    sourceId: "anna-archive",
    sourceLabel: "Anna's Archive",
    sourceReliability: 55,
    title,
    authors: author ? [author] : [],
    publisher: publisherRaw || "未提供",
    publishedYear: meta.year || extractYear(publisherRaw),
    description,
    categories: meta.category ? [meta.category] : [],
    isbns: [],
    infoLink,
  });
}

function buildRelaxedSearchQuery(query: string): string {
  const tokens = query.split(/[\s,，、]+/u).filter(Boolean);
  return tokens.find((token) => /[A-Za-z0-9]/u.test(token) || token.length >= 4) ?? tokens[0] ?? "";
}

function parseGutenbergSearchEntry(entry: string): { detailUrl: string; title: string; authors: string[] } | null {
  const href = entry.match(/<link[^>]*rel="subsection"[^>]*href="([^"]+)"/u)?.[1];
  if (!href || !/\/ebooks\/\d+\.opds$/u.test(href)) {
    return null;
  }

  const title = normalizeSummary(decodeHtmlEntities(stripHtml(entry.match(/<title>([\s\S]*?)<\/title>/u)?.[1] ?? "")));
  if (!title || title === "未提供") {
    return null;
  }

  const authorText = normalizeSummary(decodeHtmlEntities(stripHtml(entry.match(/<content type="text">([\s\S]*?)<\/content>/u)?.[1] ?? "")));
  return {
    detailUrl: href.startsWith("http") ? href : `https://www.gutenberg.org${href}`,
    title,
    authors: authorText === "未提供" ? [] : splitAuthors(authorText),
  };
}

function parseGutenbergDetailEntry(xml: string, detailUrl: string, fallbackTitle: string, fallbackAuthors: string[]): BookCandidate | null {
  const entry = extractXmlEntries(xml)[0] ?? xml;
  const paragraphs = [...entry.matchAll(/<p>([\s\S]*?)<\/p>/gu)].map((match) => normalizeSummary(decodeHtmlEntities(stripHtml(match[1] ?? ""))));
  const summaryParagraph = paragraphs.find((paragraph) => paragraph.startsWith("Summary:"));
  const downloadsParagraph = paragraphs.find((paragraph) => paragraph.startsWith("Downloads:"));
  const languageParagraph = paragraphs.find((paragraph) => paragraph.startsWith("Language:"));
  const publishedParagraph = paragraphs.find((paragraph) => paragraph.startsWith("Published:"));
  const detailTitle = normalizeSummary(decodeHtmlEntities(stripHtml(entry.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/u)?.[1] ?? fallbackTitle)));
  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/gu)]
    .map((match) => normalizeSummary(decodeHtmlEntities(stripHtml(match[1] ?? ""))))
    .filter(Boolean);
  const subjects = [...entry.matchAll(/<category[^>]*term="([^"]+)"/gu)]
    .map((match) => normalizeSummary(decodeHtmlEntities(match[1] ?? "")))
    .filter(Boolean);
  const previewLink = toAbsoluteUrl(
    entry.match(/<link[^>]*rel="http:\/\/opds-spec.org\/acquisition"[^>]*href="([^"]+)"/u)?.[1] ?? null,
    "https://www.gutenberg.org",
  );
  const infoLink = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/u)?.[1] ?? detailUrl.replace(/\.opds$/u, "");

  return buildCandidate({
    id: `project-gutenberg:${detailUrl}`,
    sourceId: "project-gutenberg",
    sourceLabel: "Project Gutenberg",
    sourceReliability: 85,
    title: detailTitle || fallbackTitle,
    authors: authors.length > 0 ? authors : fallbackAuthors,
    publisher: "Project Gutenberg",
    publishedYear: extractYear(publishedParagraph),
    description: summaryParagraph ? summaryParagraph.replace(/^Summary:\s*/u, "") : "Project Gutenberg 详情页未提供摘要。",
    categories: subjects,
    isbns: [],
    infoLink: infoLink.startsWith("http") ? infoLink : `https://www.gutenberg.org${infoLink}`,
    previewLink,
    ratingsCount: normalizePositiveInteger(Number.parseInt(downloadsParagraph?.replace(/^Downloads:\s*/u, "") ?? "", 10)),
    ratingSourceLabel: languageParagraph ? null : null,
  });
}

function parseZLibrarySearchCandidate(attributeText: string, innerHtml: string): BookCandidate | null {
  const attributes = parseAttributes(attributeText);
  const href = attributes.href?.trim();
  const title = normalizeSummary(decodeHtmlEntities(stripHtml(innerHtml.match(/<div slot="title">([\s\S]*?)<\/div>/u)?.[1] ?? "")));
  if (!href || !title || title === "未提供") {
    return null;
  }

  const author = normalizeSummary(decodeHtmlEntities(stripHtml(innerHtml.match(/<div slot="author">([\s\S]*?)<\/div>/u)?.[1] ?? "")));
  return buildCandidate({
    id: `z-library:${href}`,
    sourceId: "z-library",
    sourceLabel: "Z-Library",
    sourceReliability: 50,
    title,
    authors: author === "未提供" ? [] : splitAuthors(author),
    publisher: attributes.publisher?.trim() || "未提供",
    publishedYear: attributes.year?.trim() || "未提供",
    description: "Z-Library 搜索结果未提供摘要。",
    categories: [],
    isbns: normalizeIsbnList(attributes.isbn ? [attributes.isbn] : []),
    infoLink: href.startsWith("http") ? href : `https://z-lib.fm${href}`,
  });
}

function enrichZLibraryCandidate(candidate: BookCandidate, detailHtml: string): BookCandidate {
  const structured = parseZLibraryStructuredData(detailHtml);
  const description = normalizeSummary(
    choosePreferredText(
      structured.description,
      decodeHtmlEntities(stripHtml(detailHtml.match(/<div id="bookDescriptionBox">([\s\S]*?)<\/div>/u)?.[1] ?? "")),
      candidate.description,
    )
  );
  const title = structured.title
    || normalizeSummary(decodeHtmlEntities(stripHtml(detailHtml.match(/<h1 class="book-title"[^>]*>([\s\S]*?)<\/h1>/u)?.[1] ?? "")))
    || candidate.title;
  const authors = structured.authors.length > 0
    ? structured.authors
    : [...detailHtml.matchAll(/<i class="authors">([\s\S]*?)<\/i>/gu)]
      .flatMap((match) => splitAuthors(normalizeSummary(decodeHtmlEntities(stripHtml(match[1] ?? "")))))
      .filter(Boolean);
  const publisher = choosePreferredText(structured.publisher, extractPropertyValue(detailHtml, "publisher"), candidate.publisher);
  const publishedYear = choosePreferredText(structured.publishedYear, extractPropertyValue(detailHtml, "year"), candidate.publishedYear);
  const isbnValues = structured.isbns.length > 0 ? structured.isbns : extractZLibraryIsbns(detailHtml);

  return {
    ...candidate,
    title,
    authors: authors.length > 0 ? authors : candidate.authors,
    publisher,
    publishedYear,
    description,
    isbns: isbnValues.length > 0 ? isbnValues : candidate.isbns,
  };
}

function parseZLibraryStructuredData(html: string): {
  title: string;
  description: string;
  authors: string[];
  publisher: string;
  publishedYear: string;
  isbns: string[];
} {
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as {
        "@type"?: string;
        name?: string;
        description?: string;
        author?: Array<{ name?: string }> | { name?: string };
        publisher?: { name?: string };
        isbn?: string;
        datePublished?: number | string;
      };
      if (parsed["@type"] !== "Book") {
        continue;
      }

      const authors = Array.isArray(parsed.author)
        ? parsed.author.map((author) => author?.name?.trim() ?? "").filter(Boolean)
        : parsed.author?.name?.trim()
          ? [parsed.author.name.trim()]
          : [];

      return {
        title: parsed.name?.trim() ?? "",
        description: normalizeSummary(parsed.description),
        authors,
        publisher: parsed.publisher?.name?.trim() ?? "",
        publishedYear: extractYear(String(parsed.datePublished ?? "")),
        isbns: normalizeIsbnList(parsed.isbn ? [parsed.isbn] : []),
      };
    } catch {
      continue;
    }
  }

  return {
    title: "",
    description: "",
    authors: [],
    publisher: "",
    publishedYear: "",
    isbns: [],
  };
}

function extractPropertyValue(html: string, propertyName: string): string {
  const normalizedProperty = normalizePropertyName(propertyName);
  const block = [...html.matchAll(/<div\s+class="bookProperty\s+property_([^"]+)"[^>]*>[\s\S]*?<div class="property_value">([\s\S]*?)<\/div>|<div\s+class="bookProperty\s+property_([^"]+)"[^>]*>[\s\S]*?<span class="property_value[^"]*">([\s\S]*?)<\/span>/gu)];
  for (const match of block) {
    const rawName = normalizePropertyName(match[1] ?? match[3] ?? "");
    if (rawName !== normalizedProperty) {
      continue;
    }

    return normalizeSummary(decodeHtmlEntities(stripHtml(match[2] ?? match[4] ?? "")));
  }

  return "";
}

function extractZLibraryIsbns(html: string): string[] {
  const fromPropertyBlocks = normalizeIsbnList([
    extractPropertyValue(html, "isbn 13"),
    extractPropertyValue(html, "isbn 10"),
  ].filter(Boolean));
  if (fromPropertyBlocks.length > 0) {
    return fromPropertyBlocks;
  }

  return normalizeIsbnList([
    decodeHtmlEntities(stripHtml(html.match(/ISBN\s*13:[\s\S]*?<div class="property_value">([\s\S]*?)<\/div>/iu)?.[1] ?? "")),
    decodeHtmlEntities(stripHtml(html.match(/ISBN\s*10:[\s\S]*?<div class="property_value">([\s\S]*?)<\/div>/iu)?.[1] ?? "")),
  ].filter(Boolean));
}

function buildCandidate(input: {
  id: string;
  sourceId: string;
  sourceLabel: string;
  sourceReliability: number;
  title: string;
  authors?: string[];
  publisher?: string;
  publishedYear?: string;
  description?: string;
  categories?: string[];
  isbns?: string[];
  averageRating?: number | null;
  ratingsCount?: number | null;
  ratingSourceLabel?: string | null;
  ratingScale?: number | null;
  infoLink?: string | null;
  previewLink?: string | null;
}): BookCandidate {
  return {
    id: input.id,
    sourceId: input.sourceId,
    sourceLabel: input.sourceLabel,
    sourceReliability: input.sourceReliability,
    title: input.title.trim(),
    authors: normalizeStringArray(input.authors),
    publisher: normalizeSummary(input.publisher),
    publishedYear: normalizeSummary(input.publishedYear),
    description: normalizeSummary(input.description),
    categories: normalizeStringArray(input.categories),
    isbns: normalizeIsbnList(input.isbns),
    averageRating: input.averageRating ?? null,
    ratingsCount: input.ratingsCount ?? null,
    ratingSourceLabel: input.ratingSourceLabel ?? null,
    ratingScale: input.ratingScale ?? null,
    infoLink: normalizeOptionalUrl(input.infoLink),
    previewLink: normalizeOptionalUrl(input.previewLink),
  };
}

function parseSegmentMeta(raw: string): { language: string; format: string; fileSize: string; year: string; category: string } {
  const segments = raw
    .split(/·/u)
    .map((segment) => normalizeSummary(segment).replace(/^✅\s*/u, ""))
    .filter((segment) => segment && segment !== "Save");

  return {
    language: segments[0] ?? "",
    format: segments[1] ?? "",
    fileSize: segments[2] ?? "",
    year: extractYear(segments[3] ?? ""),
    category: segments[4] ?? "",
  };
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of raw.matchAll(/([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/gu)) {
    attributes[match[1] ?? ""] = decodeHtmlEntities(match[2] ?? "");
  }
  return attributes;
}

function extractXmlEntries(xml: string): string[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gu)].map((match) => match[1] ?? "");
}

function fetchWithTimeout(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetchImpl(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });
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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalizeSummary(item))
    .filter((item) => item !== "未提供");
}

function normalizeIsbnList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/[^0-9Xx]/gu, ""))
    .filter((item) => item.length === 10 || item.length === 13);
}

function normalizeOptionalUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePropertyName(value: string): string {
  return value
    .replace(/[_-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function toAbsoluteUrl(value: string | null | undefined, baseUrl: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//u.test(trimmed)) {
    return trimmed;
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

function normalizePositiveInteger(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function choosePreferredText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = normalizeSummary(value);
    if (normalized !== "未提供") {
      return normalized;
    }
  }

  return "未提供";
}

function extractYear(value: string | null | undefined): string {
  const normalized = normalizeSummary(value);
  if (normalized === "未提供") {
    return normalized;
  }

  const match = normalized.match(/(19|20)\d{2}/u);
  return match?.[0] ?? normalized;
}

function splitAuthors(value: string): string[] {
  return value
    .split(/[\/／]|、|,|&| and /iu)
    .map((item) => normalizeSummary(item))
    .filter((item) => item !== "未提供");
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
