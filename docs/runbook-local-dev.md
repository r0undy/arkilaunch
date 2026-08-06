# Local dev runbook (Draft)

> Status: Draft. Not a PRD/DSD/SDD/QAD/RFC doc — operational reference only. See
> [docs/index.md](index.md) for the Locked-doc list this must not contradict.

The stack is pinned to Supabase Postgres 17 + Storage (`docs/build-arkilaunch.md` §3). There is no
docker-compose or local Postgres path — `packages/db/test/*` (RLS/GUC-leak suites) require a real
Supavisor pooler, so a throwaway local Postgres would not actually prove isolation. Use a Supabase
dev project.

## 1. Create a Supabase dev project

Use a project dedicated to local dev, separate from staging/prod. Note the project ref (the
`<project-ref>` in `db.<project-ref>.supabase.co`).

`db.<project-ref>.supabase.co` does not resolve for projects without the IPv4 add-on — use the
Supavisor pooler host (`aws-0-<region>.pooler.supabase.com`) for both connections below, not the
direct host.

## 2. Fill in `.env`

Copy `.env.example` to `.env` (already `.gitignore`d) and fill in:

| Var | Notes |
|---|---|
| `DATABASE_URL_DIRECT` | Session mode, port `5432`. Migrations need prepared-statement support — this must stay session mode, not transaction mode. |
| `APP_AUTHENTICATED_PASSWORD` | A password you generate, **not** a Supabase-issued one. `pnpm db:migrate` sets/rotates the `app_authenticated` role's password to this value on the target DB. |
| `DATABASE_URL_POOLED` | Transaction mode, port `6543`, username `app_authenticated.<project-ref>`, same password as above. This is what the running API/jobs use — never the `postgres` superuser, which always bypasses RLS regardless of `FORCE ROW LEVEL SECURITY`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Migrations + trusted cron only. Never referenced on a request path. |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | RS256 keypair, PEM, single line with `\n` escapes. Generate with `openssl genrsa -out key.pem 2048 && openssl rsa -in key.pem -pubout -out pub.pem`. |
| `ANCHOR_TENANT_SLUG` | `GET /catalog/equipment` and the public storefront routes return nothing without this — set it to the slug of a seeded active tenant. |
| `WEB_ORIGIN` | `http://localhost:5173` for the Vite dev server — CORS rejects anything else. |
| `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET_EDTR`, `SUPABASE_STORAGE_BUCKET_KYC` | Storage REST API, distinct from the `DATABASE_URL_*` Postgres connections. |

Feature flags for local frontend work (auth real, everything vendor-backed stubbed):

```
ENABLE_OCR_PIPELINE=false
ENABLE_OCR_KYC=false
ENABLE_QUOTE_ENGINE=false
ENABLE_DIESEL_SCRAPE=false
ENABLE_PAYMENTS=false
```

Leave `AZURE_DI_*`, `PAYMONGO_*`, `OPEN_METEO_API_KEY` blank — the stub/fixture adapters are used
instead (see `packages/shared/src/document-intelligence-port.ts`).

## 3. Migrate and seed

```
pnpm db:migrate         # applies packages/db/migrations/*, sets app_authenticated's password
pnpm db:seed            # single anchor tenant — matches ANCHOR_TENANT_SLUG
pnpm db:seed:test       # OR: two tenants, for isolation testing
```

## 4. Run

```
pnpm dev                # both apps/api and apps/web, parallel
```

- API: `http://localhost:3000/api/v1` (see `apps/web/.env`'s `VITE_API_BASE_URL`)
- Web: `http://localhost:5173`
- Health check: `GET /health` — now runs a trivial DB query, so a 200 means both "API is up" and
  "API can reach Postgres"; a 503 with `{"status":"db_unreachable"}` means the pooler connection is
  bad (check `DATABASE_URL_POOLED`).

## 5. Verify

Log in with a seeded user through `/login`; confirm it lands on the expected role home
(`customer`→`/account`, `owner`→`/app/insights`, `timekeeper`→`/field`, `admin`/`platform_admin`→`/app`,
per `apps/web/src/lib/guards.ts`).

```
pnpm test        # Vitest across all workspaces
pnpm typecheck
```

`packages/db/test/*` (tenant isolation, RLS enumeration, GUC-pooler-leak) needs the live pooler and
is not run by default in CI unless `RUN_LIVE_DB_TESTS=true` — run it locally against your dev
project when touching auth, tables, or RLS policies.
