import type { RoleCode } from '@arkilaunch/shared';

// Development seed identities. One shared, trivially memorable password
// across all five roles, so exercising RBAC is a matter of switching
// accounts rather than juggling credentials.
//
// These are DEVELOPMENT credentials and nothing else. `admin` is five
// characters and would be rejected by `UserPasswordSchema` (min 12), which
// governs every path where a password is actually *chosen* -- invite
// activation and password reset. The seed writes an Argon2id hash straight
// into the row, so it bypasses that schema; `LoginRequestSchema` only
// requires min(1), so the login itself succeeds. That asymmetry is
// deliberate and is why `assertSeedTargetIsLocal()` below exists: the
// password policy is not weakened for real accounts, and these accounts are
// not allowed to reach a real database.
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'admin';

export type SeedIdentity = {
  readonly email: string;
  readonly role: RoleCode;
  // 'platform' is the reserved cross-tenant tenant row (RFC-1 §3); every
  // other identity belongs to the anchor tenant.
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

// Emails this seed used before 2026-09-13. An already-seeded database is
// migrated by UPDATEing these rows in place rather than deleting them:
// `users.id` is referenced by rentals, edtr reports, weather incidents,
// deposit ledger entries, timekeeper site assignments and more, most
// without ON DELETE CASCADE, so a delete-and-recreate would either fail on
// a foreign key or force deleting the operational data that gives the POC
// screens something to show.
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
 * Refuses to write the weak development credentials above into anything that
 * is not a local or throwaway database.
 *
 * This exists because `pnpm db:seed` runs against whatever `.env` happens to
 * name, and in this repo `.env` has pointed at the live Supabase project
 * holding the Almara pilot's real data -- including KYC documents carrying
 * SEC and TIN numbers, which are personal information under RA 10173.
 * Seeding `admin@admin.com` / `admin` there would put a guessable
 * administrator on a live multi-tenant system.
 *
 * Set `ALLOW_WEAK_SEED_CREDENTIALS=true` to override, or `SEED_PASSWORD` to
 * a real password to seed a remote environment safely.
 */
export function assertSeedTargetIsLocal(databaseUrl: string | undefined): void {
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
  // A caller-supplied password that satisfies the app's own policy is not a
  // weak credential, so it does not need the local-host guard.
  if (process.env.SEED_PASSWORD && process.env.SEED_PASSWORD.length >= 12) return;

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
      '  - set SEED_PASSWORD to a real password (>= 12 chars), or',
      '  - set ALLOW_WEAK_SEED_CREDENTIALS=true if you genuinely mean to do this.',
    ].join('\n'),
  );
}
