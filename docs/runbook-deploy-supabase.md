# Deploying schema + seed to a remote Supabase project (Draft)

> Status: Draft. Not a PRD/DSD/SDD/QAD/RFC doc — operational reference only. See
> [docs/index.md](index.md) for the Locked-doc list this must not contradict.

[runbook-local-dev.md](runbook-local-dev.md) covers standing the stack up for local work.
This runbook covers the other case: applying the migrations and the RBAC seed to a
**remote** Supabase project, where the seed's local-host guard applies.

There is no Supabase CLI in this repo — no `supabase/`, no `config.toml`. Supabase is
hosted Postgres + Storage; the schema is Drizzle migrations. "Deploying the database"
means `pnpm db:migrate` and, if the environment needs sign-in accounts, `pnpm db:seed`,
both against whatever `.env` names.

## 0. Identify the target first

`.env` is gitignored and machine-local, and in this repo it has at times pointed at the
project holding real pilot data, including KYC documents carrying SEC and TIN numbers
(personal information under RA 10173). The seed is **not** purely additive: it upserts
the anchor tenant, equipment, rate card, pricing parameters, a customer, a site and a
rental, and it renames legacy seed user rows in place.

So before running anything, print the host only — never the credentials:

```
grep -E '^(DATABASE_URL_DIRECT|DATABASE_URL_POOLED)=' .env \
  | sed -E 's#^([A-Z_]+)=.*@([^:/]+):([0-9]+).*#\1 -> \2:\3#'
```

Confirm the project ref is the dev/staging one. Expect:

- `DATABASE_URL_DIRECT` → pooler host, port **5432** (session mode), user `postgres.<ref>`
- `DATABASE_URL_POOLED` → pooler host, port **6543** (transaction mode), user `app_authenticated.<ref>`

Migrations need prepared statements, so `DATABASE_URL_DIRECT` must stay session mode.
Also confirm `APP_AUTHENTICATED_PASSWORD` is set — `migrate.ts` only *warns* when it is
missing, so the step would go green while every pooled runtime connection failed.

## 1. Migrate

```
pnpm db:migrate
```

Applies `packages/db/migrations/0000_create_app_role.sql` … `0016_reference_table_grants.sql`
(including every RLS, FORCE RLS and grant migration), then sets the `app_authenticated`
role's password from `APP_AUTHENTICATED_PASSWORD`. Success ends with:

```
app_authenticated password set from APP_AUTHENTICATED_PASSWORD.
Migrations applied.
```

`NOTICE: schema "drizzle" already exists, skipping` on an already-migrated database is
normal. The step is idempotent — Drizzle's journal skips applied migrations — so re-running
it is the cheapest check that the journal is consistent.

## 2. Seed, past the local-host guard

`assertSeedTargetIsLocal()` (`packages/db/src/seed/seed-identities.ts`) aborts before
connecting when the target is not a local host, because the default seed password `admin`
would put a guessable administrator on a multi-tenant system. There are two ways past it:

| | Effect |
|---|---|
| `SEED_PASSWORD=<>= 12 chars>` | **Preferred.** Satisfies `UserPasswordSchema`'s own minimum, so these are no longer weak credentials and the guard does not apply. |
| `ALLOW_WEAK_SEED_CREDENTIALS=true` | Forces the default `admin` password onto the remote database. Only for a genuinely throwaway project. |

Use the first. Pass it scoped to the single command rather than writing it into `.env` —
nothing else reads it, and `.env` persists on disk:

```
SEED_PASSWORD='<chosen>' pnpm db:seed
```

PowerShell:

```
$env:SEED_PASSWORD='<chosen>'; pnpm db:seed; Remove-Item Env:\SEED_PASSWORD
```

The seed is idempotent (upserts) and prints the sign-in table and sample POC ids on
success. The five accounts and what each can do are tabulated in
[runbook-local-dev.md](runbook-local-dev.md#sign-in-accounts) — the only difference on a
remote target is the password.

## 3. Verify

1. Re-run `pnpm db:migrate` → clean no-op.
2. Prove RLS from the **pooled** role, which is what the app uses. Connecting as
   `app_authenticated` with no `app.current_tenant_id` GUC set, `select count(*) from users`
   must return **0**, and `tenants` must be invisible too. Then inside a transaction with
   `set_config('app.current_tenant_id', <anchor id>, true)`, exactly the anchor tenant's
   users appear — `platform@admin.com` correctly does **not**, since it belongs to the
   reserved `arkilaunch-platform` tenant and reaches across tenants via `withPlatformTx`,
   never via tenant RLS (RFC-1 §3).
3. `pnpm --filter @arkilaunch/db test` — the RLS/GUC-leak suites, which need a real
   Supavisor pooler and so are only meaningful against a deployed project.
4. Sign in through the app as `admin@admin.com`, then as `timekeeper@admin.com`, and
   confirm the same screens narrow per role.

## 4. Notes

- CI (`.github/workflows/deploy.yml`) already runs `pnpm db:migrate` between the image push
  and `terraform apply`. It does **not** seed, and should not — seeding is a deliberate,
  human-run action against a named environment.
- `pnpm db:seed:test` creates the two-tenant isolation fixture. It accumulates
  `*@test-tenant-a.test` / `*@test-tenant-b.test` rows on whatever database it runs against;
  on a long-lived dev project these pile up and are worth periodically clearing.

## 5. Run record

**2026-09-15 — the dev project (ap-southeast-1). Project ref deliberately not recorded here;
read it from `.env`.**

- `pnpm db:migrate`: no new migrations; the journal was already at `0016`. The run's
  effect was re-asserting the `app_authenticated` password from `APP_AUTHENTICATED_PASSWORD`.
- `pnpm db:seed` with a 19-char `SEED_PASSWORD` (guard satisfied without
  `ALLOW_WEAK_SEED_CREDENTIALS`). Seeded `almara` (Almara Construction, active) and
  `arkilaunch-platform` (ArkiLaunch Platform, active), and all five accounts active:
  `owner@`/`admin@`/`timekeeper@`/`customer@admin.com` on `almara`,
  `platform@admin.com` on `arkilaunch-platform`. Zero legacy `*.test` seed emails remained,
  so the rename-in-place path had already run.
- Verified: `app_authenticated` reports `rolbypassrls = false`; with no tenant GUC it sees
  0 users and cannot see `tenants` at all; with the GUC set to `almara` it sees exactly the
  four anchor users and not `platform@admin.com`.
- Observed, not fixed: the dev database carries ~25 accumulated `*@test-tenant-a.test`
  timekeeper rows in `invited` status from repeated `db:seed:test` runs (see §4).
