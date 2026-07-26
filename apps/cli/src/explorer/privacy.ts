const urlInTextPattern = /https?:\/\/[^\s)\]}>'"]+/g;

export function sanitizeExplorationUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return value.slice(0, 500);
  }
}

export function sanitizeExplorationError(value: string): string {
  return value
    .replaceAll(urlInTextPattern, (url) => sanitizeExplorationUrl(url))
    .replaceAll(/\s+/g, " ")
    .slice(0, 1_000);
}
