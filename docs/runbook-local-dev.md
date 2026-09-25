# Local dev runbook (Draft)

> Status: Draft. Not a PRD/DSD/SDD/QAD/RFC doc — operational reference only. See
> [docs/index.md](index.md) for the Locked-doc list this must not contradict.

The stack is pinned to Supabase Postgres 17 + Storage (`docs/build-arkilaunch.md` §3). There is no
docker-compose or local Postgres path — `packages/db/test/*` (RLS/GUC-leak suites) require a real
Supavisor pooler, so a throwaway local Postgres would not actually prove isolation. Use a Supabase
dev project.

This runbook is the *local* path. To apply the schema and seed to a remote Supabase project,
see [runbook-deploy-supabase.md](runbook-deploy-supabase.md).

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
| `PLATFORM_DOMAIN` | Deployed envs only: lets the API's CORS accept `https://{slug}.<domain>` tenant origins. Not needed in dev (Vite proxy). |
| `WEB_ORIGIN` | `http://localhost:5173` for the Vite dev server — CORS rejects anything else. |
| `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET_EDTR`, `SUPABASE_STORAGE_BUCKET_KYC` | Storage REST API, distinct from the `DATABASE_URL_*` Postgres connections. |

Feature flags for local frontend work (auth real, everything vendor-backed stubbed):

```
ENABLE_OCR_PIPELINE=false
ENABLE_OCR_KYC=false
ENABLE_WEATHER_POLL=false
ENABLE_DIESEL_SCRAPE=false
ENABLE_PAYMENTS=false
```

Leave `AZURE_DI_*` and `PAYMONGO_*` blank — the stub/fixture adapters are used instead (see
`packages/shared/src/document-intelligence-port.ts`). Weather needs no credential at all
(`docs/cr-arkilaunch-open-meteo-free-tier.md`): set `ENABLE_WEATHER_POLL=true` and the free-tier
Open-Meteo client works immediately, no key to fill in.

## 3. Migrate and seed

```
pnpm db:migrate         # applies packages/db/migrations/*, sets app_authenticated's password
pnpm db:seed            # almara tenant + arkilaunch-platform (platform_admin)
pnpm db:seed:test       # OR: two tenants, for isolation testing
```

### Sign-in accounts

`pnpm db:seed` creates one account per role, all sharing the password `admin`:

| Email | Role | Lands on | What it can do |
|-------|------|----------|----------------|
| `admin@admin.com` | `admin` | `/app` | The tenant's back-office admin: users, quotes, fleet, and the EDTR approve/deduct gate (PRD-F3 US-01) |
| `owner@admin.com` | `owner` | `/app/insights` | Read-mostly on operational data (QAD-T19); manages its own users and tenant settings |
| `timekeeper@admin.com` | `timekeeper` | `/field` | Creates EDTRs on assigned sites only; never approves or deducts (PRD-F3 US-02) |
| `customer@admin.com` | `customer` | `/account` | Own bookings, quotes and deposit checkout; holds no staff permission (PRD-F8/F2) |
| `platform@admin.com` | `platform_admin` | `/app` | Every permission; cross-tenant authority via `withPlatformTx`, never via tenant RLS (RFC-1 §3) |

Switching between these is the quickest way to exercise RBAC: the same screen should
show, hide, or 403 different things per role.

> **These are local-only credentials.** `admin` is five characters and would be rejected
> by `UserPasswordSchema` (min 12), which governs every path where a password is actually
> *chosen* — invite activation and password reset. The seed writes the Argon2id hash
> directly, so it bypasses that; login only requires min(1). Because of that asymmetry
> the seed **refuses to run against a non-local database**: point `DATABASE_URL_DIRECT`
> at a remote host and it aborts before connecting. Set `SEED_PASSWORD` to a real
> password (>= 12 chars) to seed a remote environment, or `ALLOW_WEAK_SEED_CREDENTIALS=true`
> to override deliberately. See `packages/db/src/seed/seed-identities.ts`.
> For the remote case end to end -- identifying the target project, migrating, and
> seeding past that guard -- see [runbook-deploy-supabase.md](runbook-deploy-supabase.md).

Re-running `pnpm db:seed` resets all five passwords and re-asserts each role, so an
account you have since changed converges back on the table above. Accounts seeded before
2026-09-13 (`admin@almara.test`, `timekeeper@almara.test`,
`platform-admin@arkilaunch.test`) are renamed in place on the next seed, keeping their
user ids so existing EDTRs, rentals and deposit entries still point at a real creator.

## 4. Run

```
pnpm dev                # both apps/api and apps/web, concurrently with [api]/[web] labeled output
```

- API: `http://localhost:3000/api/v1`
- Web: `http://localhost:5173`
- `apps/web/.env`'s `VITE_API_BASE_URL` is the **relative** `/api/v1`. `vite.config.ts` proxies
  `/api` to the API, so one value works from a laptop and a phone, over http and https, and the
  request is same-origin and never reaches the API's CORS allowlist.
- Health check: `GET /health` — now runs a trivial DB query, so a 200 means both "API is up" and
  "API can reach Postgres"; a 503 with `{"status":"db_unreachable"}` means the pooler connection is
  bad (check `DATABASE_URL_POOLED`).

### 4.1 Testing DTR scanning from a phone

The camera is the whole point of this path, and it is the one thing a laptop cannot fully check.

**On a laptop**, nothing extra is needed: `localhost` is a secure context, so `http://localhost:5173`
opens the live viewfinder against the built-in webcam.

**On a phone**, `http://192.168.x.x:5173` is *not* a secure context, `getUserMedia` does not exist
there, and the screen quietly falls back to the file input — which looks exactly like the feature
working. That is the failure mode worth knowing about. Serve https instead:

```
pnpm dev:cert           # once; writes the gitignored apps/web/certs/, SAN-ed for every LAN address
pnpm dev
```

Vite picks the certificate up automatically when it is present and prints `https://` URLs. Open the
Network one on the phone and accept the self-signed warning once (Advanced -> Proceed); a proceeded-
past certificate still counts as a secure context, which is all the camera asks for. With no
certificate present, `pnpm dev` serves plain http exactly as before.

Then: sign in, go to **Field logs -> Scan a DTR** (`/app/ocr/deployments`, or `/field/scan` as a
timekeeper), pick a deployment, and the viewfinder opens scoped to it. Denying the camera permission
is worth trying too — it should drop to "Take photo / Choose a file" with a sentence saying why.

Boxes only appear on the review screen for rows extracted by `worker:edtr` **after** bounding regions
shipped; older rows and any `manual_transcription` row carry no polygon and correctly draw none.

### 4.2 Running a cron job by hand

The four ACA Jobs are separate scheduled processes, not HTTP endpoints. Run one the same way
production does (`infra/terraform/modules/cron_job` runs `node jobs/dist/<entrypoint>.js`):

```
pnpm --filter @arkilaunch/jobs worker:edtr        # EDTR OCR + reconciliation
pnpm --filter @arkilaunch/jobs worker:weather     # needs ENABLE_WEATHER_POLL=true
pnpm --filter @arkilaunch/jobs worker:diesel      # needs ENABLE_DIESEL_SCRAPE=true
pnpm --filter @arkilaunch/jobs worker:pm-notify   # ungated
```

`worker:edtr` will report `document extraction unavailable (no_credentials); claiming nothing` and
exit without touching any row — correct, and deliberate: with no Azure DI credentials there is
nothing to extract with, and claiming rows anyway would burn their retry budget. Capture a paper
EDTR with the hours typed in alongside the photo instead (see §5), which is the pilot's actual
double-entry path.

## 5. Verify

Log in with a seeded user through `/login` (see the table in §3); confirm it lands on the expected role home
(`customer`→`/account`, `owner`→`/app/insights`, `timekeeper`→`/field`, `admin`/`platform_admin`→`/app`,
per `apps/web/src/lib/guards.ts`).

```
pnpm test        # Vitest across all workspaces
pnpm typecheck
```

`packages/db/test/*` (tenant isolation, RLS enumeration, GUC-pooler-leak) needs the live pooler and
is not run by default in CI unless `RUN_LIVE_DB_TESTS=true` — run it locally against your dev
project when touching auth, tables, or RLS policies.
