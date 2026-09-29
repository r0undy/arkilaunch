// Keeps signed Storage URLs (bearer token in the query) and credential headers out of App Insights (RA 10173).
const SENSITIVE_KEY =
  /(authorization|api[-_]?key|apikey|token|secret|password|passwd|cookie|signature|credential|session)/i;
const URL_ATTRIBUTE_KEYS = ['url.full', 'http.url', 'http.target'];

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value.split('?')[0] ?? value;
  }
}

export function redactAttributes(attrs: Record<string, unknown>): void {
  for (const key of Object.keys(attrs)) {
    if (SENSITIVE_KEY.test(key) || key === 'url.query') {
      delete attrs[key];
      continue;
    }
    if (URL_ATTRIBUTE_KEYS.includes(key) && typeof attrs[key] === 'string') {
      attrs[key] = redactUrl(attrs[key] as string);
    }
  }
}
