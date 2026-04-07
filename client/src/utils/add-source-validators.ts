export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeSearchQuery(value: string): string {
  return value.trim();
}

export function getRequiredFieldError(value: string, label: string): string | null {
  return value.trim() ? null : `请输入${label}`;
}

export function getUrlFieldError(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return isValidHttpUrl(normalized) ? null : "请输入有效的 http(s) URL";
}

export function canShowValidationError(error: string | null, touched: boolean, submitted: boolean): boolean {
  return Boolean(error) && (touched || submitted);
}

export function shouldDisableSubmitAction(busy: boolean): boolean {
  return busy;
}
