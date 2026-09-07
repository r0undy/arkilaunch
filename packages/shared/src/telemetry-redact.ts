// Pure functions, no OpenTelemetry dependency here on purpose -- this file
// also stays importable from apps/web should browser telemetry ever land.
// Used by apps/api's telemetry span processor to keep signed Supabase
// Storage URLs (which carry a bearer token in the query string) and any
// credential-shaped header out of App Insights (RA 10173: KYC/EDTR document
// URLs and extracted fields are sensitive personal information).
const SENSITIVE_KEY =
  /(authorization|api[-_]?key|apikey|token|secret|password|passwd|cookie|signature|credential|session)/i;
const URL_ATTRIBUTE_KEYS = ['url.full', 'http.url', 'url.query', 'http.target'];

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
    if (SENSITIVE_KEY.test(key)) {
      delete attrs[key];
      continue;
    }
    if (URL_ATTRIBUTE_KEYS.includes(key) && typeof attrs[key] === 'string') {
      attrs[key] = redactUrl(attrs[key] as string);
    }
  }
}
