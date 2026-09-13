import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ROLE_CODES } from '@arkilaunch/shared';
import {
  LEGACY_EMAIL_MIGRATIONS,
  SEED_IDENTITIES,
  assertSeedTargetIsLocal,
  isLocalDatabaseUrl,
} from '../src/seed/seed-identities.js';

// These are the guardrails around the weak development credentials the
// anchor seed writes. The seed bypasses UserPasswordSchema by hashing
// directly, so the only thing standing between "admin"/"admin" and a live
// multi-tenant database holding RA 10173 personal data is the host check
// below. It gets a test.
describe('seed identities', () => {
  it('covers every role in ROLE_CODES exactly once', () => {
    const seeded = SEED_IDENTITIES.map((i) => i.role).sort();
    expect(seeded).toEqual([...ROLE_CODES].sort());
    expect(new Set(seeded).size).toBe(ROLE_CODES.length);
  });

  it('gives every identity a unique email', () => {
    const emails = SEED_IDENTITIES.map((i) => i.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('puts only platform_admin on the reserved platform tenant (RFC-1 §3)', () => {
    for (const identity of SEED_IDENTITIES) {
      expect(identity.tenant === 'platform').toBe(identity.role === 'platform_admin');
    }
  });

  it('migrates every legacy email to an address the seed actually creates', () => {
    const current = new Set(SEED_IDENTITIES.map((i) => i.email));
    for (const [legacy, target] of LEGACY_EMAIL_MIGRATIONS) {
      expect(current.has(target), `${legacy} migrates to unseeded ${target}`).toBe(true);
      expect(current.has(legacy), `${legacy} is both legacy and current`).toBe(false);
    }
  });
});

describe('isLocalDatabaseUrl', () => {
  it('accepts local and throwaway hosts', () => {
    for (const url of [
      'postgresql://postgres:postgres@localhost:5432/postgres',
      'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
      'postgresql://u:p@host.docker.internal:5432/db',
      'postgresql://u:p@postgres:5432/db',
      'postgresql://u:p@mybox.local:5432/db',
    ]) {
      expect(isLocalDatabaseUrl(url), url).toBe(true);
    }
  });

  it('rejects remote hosts, including the Supabase pooler this repo points at', () => {
    for (const url of [
      'postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
      'postgresql://u:p@db.example.com:5432/postgres',
      'postgresql://u:p@10.0.0.5:5432/postgres',
    ]) {
      expect(isLocalDatabaseUrl(url), url).toBe(false);
    }
  });

  it('treats an absent or unparseable URL as not local', () => {
    expect(isLocalDatabaseUrl(undefined)).toBe(false);
    expect(isLocalDatabaseUrl('not a url')).toBe(false);
  });
});

describe('assertSeedTargetIsLocal', () => {
  const REMOTE = 'postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';
  const LOCAL = 'postgresql://postgres:postgres@localhost:5432/postgres';
  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    delete process.env.ALLOW_WEAK_SEED_CREDENTIALS;
    delete process.env.SEED_PASSWORD;
  });
  afterEach(() => {
    process.env = saved;
  });

  it('allows a local target', () => {
    expect(() => assertSeedTargetIsLocal(LOCAL)).not.toThrow();
  });

  it('refuses a remote target by default', () => {
    expect(() => assertSeedTargetIsLocal(REMOTE)).toThrow(/Refusing to seed development credentials/);
  });

  it('refuses when the URL is missing, rather than failing open', () => {
    expect(() => assertSeedTargetIsLocal(undefined)).toThrow(/Refusing to seed development credentials/);
  });

  it('allows a remote target behind the explicit override', () => {
    process.env.ALLOW_WEAK_SEED_CREDENTIALS = 'true';
    expect(() => assertSeedTargetIsLocal(REMOTE)).not.toThrow();
  });

  it('only honours the override when it is exactly "true"', () => {
    process.env.ALLOW_WEAK_SEED_CREDENTIALS = '1';
    expect(() => assertSeedTargetIsLocal(REMOTE)).toThrow(/Refusing to seed development credentials/);
  });
});
