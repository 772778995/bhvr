export interface BookCandidate {
  id: string;
  sourceId: string;
  sourceLabel: string;
  sourceReliability: number;
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
}

export interface BookFinderIntent {
  searchText: string;
  keywords: string[];
  languagePreference: "zh" | "en" | "any";
}

export interface BookFinderResult {
  normalizedQuery: string;
  results: BookCandidate[];
  markdown: string;
}

export type BookSourceStatStatus = "success" | "empty" | "failure";

export interface BookFinderSearchOptions {
  recordSourceStat?: (entry: {
    sourceId: string;
    sourceLabel: string;
    status: BookSourceStatStatus;
    latencyMs: number;
    error?: string | null;
  }) => Promise<void> | void;
}

export interface BookSourceSearchContext {
  normalizedQuery: string;
  languagePreference: "zh" | "en";
  fetchImpl: typeof fetch;
}

export interface BookSourceAdapter {
  id: string;
  label: string;
  reliability: number;
  supports(context: Pick<BookSourceSearchContext, "normalizedQuery" | "languagePreference">): boolean;
  search(context: BookSourceSearchContext): Promise<BookCandidate[]>;
}
