import { describe, expect, it } from 'vitest';
import { redactAttributes, redactUrl } from './telemetry-redact.js';

describe('redactUrl', () => {
  it('strips the query string from a signed Supabase Storage URL', () => {
    const signed =
      'https://x.supabase.co/storage/v1/object/sign/kyc-documents/tenant-a/2026/08/uuid.jpg?token=eyJhbGciOiJIUzI1NiJ9.eyJhbGciOiJIUzI1NiJ9';
    const redacted = redactUrl(signed);
    expect(redacted).not.toContain('token=');
    expect(redacted).not.toContain('eyJ');
    expect(redacted).toBe('https://x.supabase.co/storage/v1/object/sign/kyc-documents/tenant-a/2026/08/uuid.jpg');
  });

  it('strips basic-auth credentials embedded in the URL', () => {
    expect(redactUrl('https://user:pass@example.com/path')).toBe('https://example.com/path');
  });

  it('falls back to a naive query-string split for a non-URL string', () => {
    expect(redactUrl('not-a-url?token=secret')).toBe('not-a-url');
  });
});

describe('redactAttributes', () => {
  it('deletes authorization, api key, and cookie-shaped attribute keys', () => {
    const attrs: Record<string, unknown> = {
      authorization: 'Bearer abc',
      'x-api-key': 'k',
      Cookie: 'session=1',
      'paymongo-signature': 'sig',
      'http.request.method': 'GET',
    };
    redactAttributes(attrs);
    expect(attrs).toEqual({ 'http.request.method': 'GET' });
  });

  it('redacts the query string on url.full but keeps the path (a UUID in the path is not over-redacted)', () => {
    const attrs: Record<string, unknown> = {
      'url.full': 'https://api.arkilaunch.app/api/v1/edtr/9f3c1b2a-uuid?foo=bar',
    };
    redactAttributes(attrs);
    expect(attrs['url.full']).toBe('https://api.arkilaunch.app/api/v1/edtr/9f3c1b2a-uuid');
  });

  it('leaves non-sensitive, non-URL attributes untouched', () => {
    const attrs: Record<string, unknown> = { 'arkilaunch.tenant_id': 'abc-123', count: 5 };
    redactAttributes(attrs);
    expect(attrs).toEqual({ 'arkilaunch.tenant_id': 'abc-123', count: 5 });
  });
});
