interface BookSummaryAvailabilityOptions {
  generating: boolean;
  hasBook: boolean;
}

export function canGenerateBookSummary(options: BookSummaryAvailabilityOptions): boolean {
  if (options.generating) {
    return false;
  }

  return options.hasBook;
}
