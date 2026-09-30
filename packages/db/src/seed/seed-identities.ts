import type { RoleCode } from '@arkilaunch/shared';

// DEVELOPMENT credentials only: the seed hash bypasses UserPasswordSchema (min 12),
// which is why assertSeedTargetIsLocal() exists.
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'admin';

export type SeedIdentity = {
  readonly email: string;
  readonly role: RoleCode;
  // 'platform' is the reserved cross-tenant tenant row (RFC-1).
  readonly tenant: 'anchor' | 'platform';
  readonly note: string;
};

export const SEED_IDENTITIES: readonly SeedIdentity[] = [
  {
    email: 'platform@admin.com',
    role: 'platform_admin',
    tenant: 'platform',
    note: 'every permission; cross-tenant authority via withPlatformTx, never via tenant RLS',
  },
  {
    email: 'owner@admin.com',
    role: 'owner',
    tenant: 'anchor',
    note: 'read-mostly on operational data (QAD-T19), but manages its own users + tenant settings',
  },
  {
    email: 'admin@admin.com',
    role: 'admin',
    tenant: 'anchor',
    note: "the tenant's back-office admin; owns the EDTR approve/deduct gate (PRD-F3 US-01)",
  },
  {
    email: 'timekeeper@admin.com',
    role: 'timekeeper',
    tenant: 'anchor',
    note: 'creates EDTRs on assigned sites only; never approves or deducts (PRD-F3 US-02)',
  },
  {
    email: 'customer@admin.com',
    role: 'customer',
    tenant: 'anchor',
    note: 'own bookings/quotes and deposit checkout only; holds no staff permission (PRD-F8/F2)',
  },
];

// Legacy seed emails, renamed in place: users.id is referenced mostly without ON DELETE CASCADE.
export const LEGACY_EMAIL_MIGRATIONS: ReadonlyMap<string, string> = new Map([
  ['platform-admin@arkilaunch.test', 'platform@admin.com'],
  ['admin@almara.test', 'admin@admin.com'],
  ['timekeeper@almara.test', 'timekeeper@admin.com'],
]);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal', 'postgres', 'db']);

function hostOf(url: string): string | null {
  try {
    // postgres:// URLs parse as WHATWG URLs; hostname strips brackets from IPv6.
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  const host = hostOf(url);
  if (!host) return false;
  return LOCAL_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.localhost');
}

/**
 * Refuses to seed weak credentials into a non-local database (`.env` has pointed at live
 * pilot data). Override with ALLOW_WEAK_SEED_CREDENTIALS=true or a real SEED_PASSWORD.
 */
export function assertSeedTargetIsLocal(databaseUrl: string | undefined, opts: { fixedPassword?: boolean } = {}): void {
  if (isLocalDatabaseUrl(databaseUrl)) return;
  if (process.env.ALLOW_WEAK_SEED_CREDENTIALS === 'true') {
    console.warn(
      'WARNING: seeding weak development credentials into a NON-LOCAL database ' +
        `(${hostOf(databaseUrl ?? '') ?? 'unparseable host'}) because ` +
        'ALLOW_WEAK_SEED_CREDENTIALS=true. Every seeded account shares the password ' +
        `"${SEED_PASSWORD}".`,
    );
    return;
  }
  // A password that satisfies the app's own policy needs no local-host guard.
  // fixedPassword: the seed ignores SEED_PASSWORD, so it cannot vouch for the target.
  if (!opts.fixedPassword && process.env.SEED_PASSWORD && process.env.SEED_PASSWORD.length >= 12) return;

  throw new Error(
    [
      'Refusing to seed development credentials into a non-local database.',
      '',
      `  target host : ${hostOf(databaseUrl ?? '') ?? '(could not parse DATABASE_URL_DIRECT)'}`,
      `  password    : "${SEED_PASSWORD}" (${SEED_PASSWORD.length} chars)`,
      '',
      'These accounts share one trivially guessable password and are intended for a',
      'local or throwaway database only. Seeding them into a live environment would',
      'create a guessable administrator on a multi-tenant system.',
      '',
      'Pick one:',
      '  - point DATABASE_URL_DIRECT at a local Postgres, or',
      ...(opts.fixedPassword ? [] : ['  - set SEED_PASSWORD to a real password (>= 12 chars), or']),
      '  - set ALLOW_WEAK_SEED_CREDENTIALS=true if you genuinely mean to do this.',
    ].join('\n'),
  );
}
