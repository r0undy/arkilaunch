# Request for Comments (RFC) / Tech Spec

**Title:** Multi-Tenant Isolation and Identity/Auth (Postgres RLS + Passport-JWT)
**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Author:** ArkiLaunch Team (Almara Construction capstone)
**Status:** `Locked`
**Last reconciled:** 2026-09-07 (see docs/index.md §1); §3's global-table addendum added by `docs/cr-arkilaunch-m4-money-path-gates.md` (migration `0016`: `tenants` gains RLS; the two global catalogues become read-only to `app_authenticated`)
**PRD Reference:** [prd-arkilaunch.md](prd-arkilaunch.md) PRD-F7 (§3), US-07 (§4)
**SDD Reference:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §3 (data architecture, GUC pattern), §5 (security & authorization)
**RFC ID:** `arkilaunch-rfc-001`
**Event / context:** FMD engine v1.28.1; Scale Full.

---

> **Note:** This is the deep design behind PRD-F7 and SDD §3/§5. It settles two questions the thesis left open: how tenants are isolated, and who owns identity. It does not restate the PRD feature list or the SDD global architecture; it goes one level deeper on the tenancy model, the RLS enforcement mechanics, and the token lifecycle. Sibling RFCs: [RFC-2](rfc-arkilaunch-ocr-edtr-reconciliation.md) (OCR + reconciliation, PRD-F3), [RFC-3](rfc-arkilaunch-quotation-pricing-engine.md) (quotation pricing, PRD-F1).

---

## 1. Context & Objective

**The problem this solves:**

The thesis pitched a SaaS product for multiple rental firms but never modeled a tenant. There is no `Tenant` entity in its 29-entity schema, no `tenant_id` on any table, and no isolation boundary between one firm's data and another's. A shared database with no isolation key is not multi-tenant; it is one big single-tenant database waiting for a cross-tenant leak.

Identity was equally unsettled. The thesis stack listed both Supabase (which ships GoTrue auth) and a NestJS/Passport-JWT backend, with no statement of which one owns a session. Two auth authorities in one system is not redundancy; it is two sources of truth that will disagree about who a user is and which tenant they belong to. That ambiguity is a security defect, not a detail.

This RFC settles both. It defines the tenancy model (shared schema, pooled, isolated by Postgres row-level security), names the single identity authority (NestJS/Passport-JWT), and specifies the enforcement path end to end: how a request proves who it is, how the database refuses to return another tenant's rows, and how a stolen refresh token gets a whole token family revoked.

**Reference in PRD/SDD:**

This RFC implements PRD-F7 (Multi-Tenant Access, Identity & RBAC) and the acceptance criteria in US-07. It is the deep design for the tenant isolation described in SDD §3 ("Tenant isolation (shared schema + RLS)", "The GUC pattern") and the authorization model in SDD §5. Traced SDD components: the NestJS API and RBAC guard (SDD §2 API layer), the Supabase-managed Postgres data tier (SDD §2 data layer), and the 28 tenant-owned tables in the SDD §3 master catalog (26 there, plus `refresh_tokens` added here and `pricing_parameters` added by RFC-3).

**Success criteria** (each maps to a US-07 acceptance criterion):

- A user of Tenant A crafting a request for Tenant B's data receives zero Tenant B rows, and the refusal happens at the database, not only in application code (US-07 AC2).
- Every one of the tenant-owned tables has row-level security enabled and forced; a query with no tenant context returns zero rows rather than all rows (fail closed).
- The access token is short-lived (minutes-scale TTL) and carries `tenant_id` and `role`; every sensitive route is gated by an RBAC permission check (US-07 AC1).
- A refresh token replayed after rotation is detected and revokes the entire token family (US-07 AC3).
- JWT verification runs an algorithm allowlist; `alg: none` and algorithm-confusion attempts are rejected.

---

## 2. Proposed Solution

**Approach:**

Three decisions, taken together.

**1. Tenancy: shared schema, pooled, isolated by Postgres RLS on a `tenant_id` key.** All tenants share one schema and one set of tables. Every tenant-owned row carries `tenant_id UUID NOT NULL`. Isolation is enforced by Postgres row-level security policies that compare each row's `tenant_id` against a transaction-scoped session variable (`app.current_tenant_id`), plus a defense-in-depth application filter. The application connects on a dedicated Postgres role that is **not** `BYPASSRLS` and is **not** the table owner, so the database itself refuses cross-tenant rows even if an application filter is ever missed. `service_role` (which bypasses RLS) is reserved for migrations and trusted cron only.

**2. ORM: Drizzle, with RLS policies declared in-schema via `pgPolicy`.** This is a documented divergence from the thesis's Prisma. Drizzle expresses RLS policies in the same TypeScript that defines the table, so a policy is code-reviewed and diffed next to its columns. That matters when isolation is a security boundary. The Prisma path to RLS runs through client extensions (`@yates`, `prisma-rls`) that inject WHERE clauses at the application layer, which is a weaker guarantee, and Prisma's default connection habits make the "queries bypass RLS" hazard easy to hit (see §4).

**3. Identity: NestJS/Passport-JWT as the single authority.** Passport-JWT owns sessions. Supabase Auth/GoTrue is not the session authority; we connect directly to Postgres and drive RLS from our own GUCs, not from Supabase's `auth.uid()`. A short-lived access token (JWT, asymmetric signature, minutes-scale TTL) carries `sub`, `tenant_id`, and `role`. A rotating opaque refresh token, stored server-side as a hash with a family lineage, backs silent re-auth and gets reuse detection. RBAC runs as a NestJS guard over the global `roles` / `permissions` / `role_permissions` catalog.

The request lifecycle wires these together: verify JWT (algorithm allowlist) -> a guard extracts `sub` / `tenant_id` / `role` -> the ORM opens a transaction and runs `set_config(..., true)` for tenant, user, and role -> RLS filters every row against the GUC -> an RBAC guard checks the route's permission code. A caller can hold a valid token and still be refused a row (wrong tenant) or an action (wrong permission).

**Auth + RLS request path:**

```mermaid
sequenceDiagram
    actor U as User (Tenant A)
    participant FE as React SPA
    participant API as NestJS API
    participant JWT as JwtStrategy (alg allowlist)
    participant G as Guards (Tenant + RBAC)
    participant DB as Postgres (non-BYPASSRLS role)

    U->>FE: action on /app/*
    FE->>API: request with Bearer access token
    API->>JWT: verify signature (RS256 allowlist), exp, iss, aud
    alt invalid signature or alg not allowed
        JWT-->>API: reject
        API-->>FE: 401 Unauthorized
    else valid token
        JWT-->>G: claims { sub, tenant_id, role }
        G->>G: RBAC check permission code for this route
        alt permission missing
            G-->>API: deny
            API-->>FE: 403 Forbidden
        else permitted
            G->>DB: begin tx; set_config tenant_id, user_id, role (local true)
            DB->>DB: RLS filters every row by app.current_tenant_id
            DB-->>API: Tenant A rows only
            API-->>FE: 200 scoped result
        end
    end
```

**Architecture changes:**

- Add a dedicated Postgres request role (`app_authenticated`): `LOGIN`, `NOBYPASSRLS`, not the owner of any table. The API connects as this role for every request-path query.
- Enable and **force** row-level security on all 28 tenant-owned tables (the 26 in SDD §3, plus `refresh_tokens` introduced here and `pricing_parameters` from RFC-3), each with a tenant-isolation policy.
- Add a request-scoped tenant transaction wrapper (`withTenant`) in the NestJS data layer that sets `app.current_tenant_id`, `app.current_user_id`, and `app.current_role` with `local = true` before any query runs.
- Add `refresh_tokens` (token family lineage, hashed tokens) to back rotation and reuse detection.
- Add a `TenantContextGuard` (populates request context from JWT claims) and a `PermissionsGuard` (RBAC over the global catalog), applied globally to `/api/v1/**` except the public and auth routes.
- Seed Almara as the anchor tenant and a `platform_admin` reserved role in the global RBAC catalog during migration.

---

## 3. Technical Details & Contracts

### Data Model Changes

Most of the schema already exists in SDD §3 (35 tables, 28 tenant-owned, folded in together with RFC-3's additions). This RFC adds one table, adds two Postgres roles, and attaches an RLS policy to every tenant-owned table. It does not restate the SDD column tables.

**New table: `refresh_tokens`** (tenant-owned; formalizes SDD §5 "token families are stored in Postgres"). Cataloged as table 33 of 35 in the SDD §3 master catalog.

```
CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id      UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  family_id    UUID NOT NULL,                       -- rotation lineage; constant across a login session
  token_hash   TEXT NOT NULL,                       -- sha-256 of the opaque token; raw token never stored
  parent_id    UUID REFERENCES refresh_tokens(id),  -- previous token in the rotation chain
  status       TEXT NOT NULL DEFAULT 'active',      -- active, rotated, revoked
  expires_at   TIMESTAMPTZ NOT NULL,
  rotated_at   TIMESTAMPTZ,
  user_agent   TEXT,
  ip           INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX refresh_tokens_hash_uq   ON refresh_tokens (token_hash);
CREATE INDEX        refresh_tokens_family_idx ON refresh_tokens (tenant_id, family_id);
CREATE INDEX        refresh_tokens_user_idx   ON refresh_tokens (tenant_id, user_id);

CHECK (status IN ('active','rotated','revoked'));
```

Notes: the raw refresh token is a 256-bit random value returned to the client once; only its sha-256 hash is persisted, so a database dump cannot mint sessions. `family_id` is the reuse-detection unit: replaying a `rotated` token revokes every row that shares its `family_id`.

**New Postgres roles.**

```
-- request-path role: owns nothing, cannot bypass RLS
CREATE ROLE app_authenticated LOGIN NOBYPASSRLS;
GRANT app_authenticated TO <connection role used by the API>;

-- migrations + trusted cron only; may bypass RLS
-- service_role already exists on Supabase (BYPASSRLS); it never serves a user request.
```

**RLS: enabled and forced on every tenant-owned table.** `FORCE ROW LEVEL SECURITY` is load-bearing: without it, the table owner is exempt from its own policies, which is exactly the hole that lets a migration-owned connection read everything. The canonical policy, applied to all 28 tenant-owned tables (generated in the migration, one per table). **This exact five-element form (`FORCE`, `TO app_authenticated`, `USING`, `WITH CHECK`, `missing_ok`) is mandatory for every tenant-owned table added by any future RFC or migration, with no partial-form exception:**

> **Addendum, 2026-09-07 (`cr-arkilaunch-m4-money-path-gates.md`): the tenant-owned set was never the whole attack surface.**
> This section's five-element form was applied correctly to all 28 (now 32) tenant-owned tables. The gap was the other seven: SDD §3's
> 35 tables include global ones with no `tenant_id`, which are therefore exempt from the policy above and from the enumeration test that
> checks it. On three of them — `tenants`, `subscription_plans`, `equipment_types` — `0002` had granted `app_authenticated` all four
> DML verbs and `0007` narrowed only `UPDATE`/`DELETE`, and only on `tenants`. With no policy and no `FORCE`, the grant was the sole
> control, so any authenticated user could rewrite both platform catalogues, `INSERT` a tenant row directly (bypassing the PRD-F6 KYC
> gate that `tenants_register()` exists to enforce), and `SELECT` the entire tenant registry.
>
> Closed by `0016_reference_table_grants.sql`: the two catalogues are read-only, `INSERT` on `tenants` is revoked, and `tenants` gains
> `ENABLE` + `FORCE` plus a bespoke `tenant_self` policy keyed on `id` — it cannot use the form below or the shared
> `tenantIsolationPolicy()` helper, because it has no `tenant_id` column: its primary key **is** the tenant id. Every cross-tenant and
> pre-auth reader of `tenants` is `SECURITY DEFINER` and so unaffected.
>
> The standing rule this adds: a table without a `tenant_id` is not thereby safe. It needs either a bespoke policy (if its rows belong
> to a tenant by some other key) or least privilege (if it is genuinely a platform catalogue). Both halves are now asserted by
> `packages/db/test/rls-enumeration.spec.ts`, which previously checked only the RLS half and so skipped these three tables entirely.

```
-- pattern applied to equipment, users, edtr, invoices, ... (all tenant-owned)
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment FORCE  ROW LEVEL SECURITY;   -- owner is not exempt

CREATE POLICY tenant_isolation ON equipment
  FOR ALL
  TO app_authenticated
  USING      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

Why both clauses: `USING` filters what a query can read or target (SELECT/UPDATE/DELETE visibility); `WITH CHECK` rejects INSERT/UPDATE rows whose `tenant_id` is not the current tenant (write isolation). One without the other leaks in one direction. The second argument `true` to `current_setting` is `missing_ok`; when the GUC is unset the call returns NULL, `tenant_id = NULL` is never true, and the query returns zero rows. That is the fail-closed default: no tenant context means no data, never all data. The `app.*` prefix is a custom GUC class, so `set_config` accepts it at runtime without a `postgresql.conf` entry.

**`audit_logs` is append-only** (SDD §3). Its policy grants SELECT and INSERT to `app_authenticated` and no UPDATE or DELETE, plus a matching REVOKE, so a deduction's evidence trail cannot be rewritten:

```
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE  ROW LEVEL SECURITY;
REVOKE UPDATE, DELETE ON audit_logs FROM app_authenticated;

CREATE POLICY audit_read   ON audit_logs FOR SELECT TO app_authenticated
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY audit_append ON audit_logs FOR INSERT TO app_authenticated
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

**Composite `(tenant_id, natural_key)` uniqueness.** Under a shared schema, a bare `UNIQUE (email)` would let one tenant's signup collide with another's, and it leaks existence across the boundary. Every natural key is scoped to the tenant:

```
ALTER TABLE users     ADD CONSTRAINT users_tenant_email_uq   UNIQUE (tenant_id, email);
ALTER TABLE equipment ADD CONSTRAINT equipment_tenant_sn_uq  UNIQUE (tenant_id, serial_no);
-- same pattern for every table with a human-facing natural key
```

Documented exception: `payments.provider_ref` stays **globally** UNIQUE (not tenant-scoped). PayMongo reference IDs are globally unique already, and webhook idempotency depends on a single global uniqueness check before the tenant context is known. This is intentional and safe (a `provider_ref` carries no cross-tenant information).

**Platform-admin: a reserved role, never a bypass.** `platform_admin` is a row in the global `roles` catalog. It does not get `BYPASSRLS` and it does not read across tenants blindly. Platform-scoped tables (`tenants`, `subscription_plans`, `subscriptions`) get policies that permit the platform role. When a platform admin must act inside a specific tenant (support, onboarding), the API sets `app.current_tenant_id` to that target tenant for that transaction and writes an `audit_logs` row for the context switch. So "one firm can never read another firm's data" holds even for us: cross-tenant access is always an explicit, audited, one-tenant-at-a-time context, never a god-mode SELECT.

**Migration and backfill (expand / contract; seed Almara).** Forward-only Drizzle migrations, expand/contract so the prior tagged build still runs for one release (this is what keeps the PRD §9 rollback safe). RLS policies ship in the same migration as the table they protect.

```
-- EXPAND (backward-compatible)
--  1. create tenants, subscription_plans, subscriptions, refresh_tokens
--  2. add tenant_id UUID NULL to every tenant-owned table (nullable for now)
--  3. create role app_authenticated (NOBYPASSRLS), grant table privileges
--  4. seed Almara as the anchor tenant; seed platform_admin role + permission catalog

-- BACKFILL
--  5. UPDATE every tenant-owned table SET tenant_id = <almara.id> WHERE tenant_id IS NULL
--     (trivial for a greenfield anchor pilot, but the seam is required for later tenants)

-- CONTRACT (after backfill verified)
--  6. ALTER tenant_id SET NOT NULL; add FK to tenants(id) ON DELETE RESTRICT
--  7. add composite UNIQUE (tenant_id, natural_key) constraints
--  8. ENABLE + FORCE row level security; attach tenant_isolation policy per table
--  9. index tenant_id as the leading column on every tenant-owned table
```

### API Changes

Two auth endpoints carry the token lifecycle. Both are public (no tenant context yet); every other `/api/v1/**` route runs inside the tenant transaction after the guards pass.

```
POST /api/v1/auth/login

Request:
{
  "email":     string,
  "password":  string,
  "totp":      string | null      // required when the user has 2FA enrolled (timekeepers)
}

Response 200:
{
  "access_token":  string,        // JWT, RS256, TTL ~ 10 min
  "refresh_token": string,        // opaque 256-bit; client stores it, server stores only its hash
  "token_type":    "Bearer",
  "expires_in":    600
}

Response 401: { "error": "invalid_credentials" }   // same body for bad email, bad password, bad totp
Response 423: { "error": "account_locked" }
```

Access token claims (verified with an algorithm allowlist of `["RS256"]`; `none` and HS/RS confusion rejected):

```
{
  "sub":       "<user uuid>",
  "tenant_id": "<tenant uuid>",
  "role":      "admin | owner | timekeeper | customer | platform_admin",
  "iss":       "arkilaunch-api",
  "aud":       "arkilaunch-web",
  "iat":       <unix>,
  "exp":       <unix>            // minutes-scale
}
```

```
POST /api/v1/auth/refresh

Request:  { "refresh_token": string }

Response 200:                    // rotation: old token retired, new pair issued
{
  "access_token":  string,
  "refresh_token": string,       // RT2; RT1 is now status=rotated
  "token_type":    "Bearer",
  "expires_in":    600
}

Response 401:
{ "error": "invalid_refresh" }   // unknown, expired, or already-revoked token

Response 401 (reuse detected):
{ "error": "token_reuse_detected", "action": "reauthenticate" }
// entire family_id revoked; an audit_logs row is written
```

**Refresh rotation + reuse detection flow:**

```mermaid
sequenceDiagram
    participant FE as React SPA
    participant API as NestJS Auth
    participant DB as Postgres refresh_tokens

    FE->>API: POST /auth/refresh (RT1)
    API->>DB: find row where token_hash = sha256(RT1)
    alt RT1 unknown or expired
        API-->>FE: 401 invalid_refresh
    else RT1 status = active
        API->>DB: set RT1 status=rotated; insert RT2 (active, parent RT1, same family)
        API-->>FE: 200 new access + RT2
    else RT1 status = rotated or revoked (replay)
        API->>DB: revoke ALL rows sharing RT1.family_id
        API->>DB: insert audit_logs (action=refresh_reuse_detected)
        API-->>FE: 401 token_reuse_detected
    end
```

The insight: after a legitimate rotation RT1 is marked `rotated`, not deleted. A thief who copied RT1 and replays it hits a `rotated` (or already `revoked`) row, which is proof of compromise, so the whole `family_id` is burned and the real user is forced to log in again. This is the standard OAuth refresh-token rotation defense and satisfies US-07 AC3.

### State Management

- **Access token:** stateless JWT, verified per request, never stored server-side. Client keeps it in memory (not `localStorage`) and attaches it as a Bearer header via the native-fetch wrapper.
- **Refresh token:** opaque, server-stateful in `refresh_tokens`, sent to the client once. TanStack Query drives silent refresh on 401. No Redis in V1; families live in Postgres (SDD §1 tech debt).
- **Tenant context:** never client-supplied beyond the signed JWT claim. The `TenantContextGuard` reads `tenant_id` only from verified claims and hands it to `withTenant`; a client cannot pass a `tenant_id` header and have it honored.
- **Request-scoped GUCs:** `app.current_tenant_id`, `app.current_user_id`, `app.current_role`, set with `local = true` at transaction start and discarded at commit/rollback. They never persist on a pooled connection past the transaction.

**Drizzle wrapper (version-tagged; Drizzle ORM as pinned in BUILD §3, verified 2026-07-25; re-verify `pgPolicy` / `set_config` against the pinned version before reuse):**

```ts
// schema: policy lives next to the columns it protects
export const equipment = pgTable('equipment', {
  id:       uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  serialNo: text('serial_no').notNull(),
  // ...
}, (t) => [
  index('equipment_tenant_idx').on(t.tenantId),
  unique('equipment_tenant_sn_uq').on(t.tenantId, t.serialNo),
  pgPolicy('tenant_isolation', {
    for: 'all',
    to: appAuthenticated,
    using:     sql`${t.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    withCheck: sql`${t.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
  }),
]).enableRLS();

// data layer: the ONLY sanctioned way to touch a tenant-owned table
async function withTenant<T>(ctx: RequestCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant_id', ${ctx.tenantId}, true)`);
    await tx.execute(sql`select set_config('app.current_user_id',   ${ctx.userId},   true)`);
    await tx.execute(sql`select set_config('app.current_role',      ${ctx.role},     true)`);
    return fn(tx);   // every query inside runs under RLS with the GUC set
  });
}
```

**RBAC guard and permission catalog.** The `PermissionsGuard` resolves the JWT `role` to its permission codes through the global `role_permissions` join and checks the code the route declares (`@RequirePermission('edtr:approve')`). Seed catalog (illustrative codes; frozen when RFC is approved):

| Role | Holds (permission codes) | Explicitly lacks |
|------|--------------------------|------------------|
| `admin` | `quote:*`, `edtr:create`, `edtr:approve`, `kyc:verify`, `settings:manage`, `users:manage`, `reports:read`, `booking:manage` | platform routes |
| `owner` | `reports:read`, `quote:read`, `fleet:read` | any `*:create` / `*:manage` (US-10: cannot data-enter) |
| `timekeeper` | `edtr:create` (own assigned sites only) | `kyc:*`, `settings:*` (blocked from `/app/kyc`, `/app/settings/*`) |
| `customer` | `booking:manage` (own), `catalog:read` | all `/app/**` admin routes |
| `platform_admin` | `platform:tenant:manage`, `platform:subscription:manage` | tenant data except via audited per-tenant context |

RLS is the coarse tenant/row backstop under all of this; RBAC is the fine-grained per-action gate above it. A caller passes RBAC and still gets zero rows if the row belongs to another tenant, and passes RLS and still gets a 403 if the role lacks the permission.

---

## 4. Alternatives Considered

| Option | Why Rejected |
|--------|-------------|
| **Tenancy: schema-per-tenant** (one Postgres schema per firm) | Stronger blast-radius isolation, but migrations must fan out across N schemas, connection/search-path management gets fiddly, and cross-tenant platform reporting needs a UNION over schemas. At MSME scale with an anchor pilot under 10 daily users, it buys isolation we already get from forced RLS at real operational cost. Revisit only if a tenant contractually demands schema separation. |
| **Tenancy: database-per-tenant** (one Postgres database or instance per firm) | Hard physical isolation, and the honest answer if a large client ever mandates it. For V1 it multiplies infra cost, backup surface, and migration orchestration by the tenant count, and makes the platform console a cross-database problem. Documented as the later migration path for a hard-isolation customer (SDD §1 tech debt), not the V1 model. |
| **ORM: Prisma with a client extension for RLS** (`@yates`, `prisma-rls`) | Prisma is the thesis default, but its RLS story is second-class. The extensions inject WHERE clauses in application code, so isolation depends on the ORM layer rather than the database, which is the weaker guarantee for a security boundary. The concrete hazard: Prisma commonly connects as the schema owner, and the owner is exempt from RLS unless `FORCE ROW LEVEL SECURITY` is set, so a policy can be silently bypassed; setting per-transaction `SET LOCAL` through Prisma's connection model is awkward under pooling. Drizzle declares policies in-schema and lets us enforce at the DB with a non-owner role. Divergence recorded in BUILD §3 use-X-not-Y. |
| **Identity: Supabase Auth / GoTrue as the session authority** | It ships with the database and would be the path of least resistance. Rejected because it splits the identity authority: GoTrue would own sessions while NestJS owns business logic and RBAC, and RLS would key off `auth.uid()` instead of our `tenant_id`. We need one authority that mints tokens carrying `tenant_id` + `role`, controls refresh rotation and reuse detection, and drives RLS from our own GUCs. NestJS/Passport-JWT is that authority; Supabase stays managed Postgres + Storage. |
| **Identity: access-token-only, no refresh** (long-lived access token) | Simpler, but a leaked long-lived token is a long-lived breach, and there is no rotation to detect theft. Short access + rotating refresh with reuse detection gives us a minutes-scale exposure window and an alarm when a token is replayed. |
| **App-layer `tenant_id` filter only, no RLS** | The thesis's implicit model. One forgotten `.where(eq(t.tenantId, ...))` in one query is a cross-tenant leak, and nothing catches it. RLS makes the database the last line: even a buggy or missing app filter returns zero foreign rows. We keep the app filter too, as defense in depth, but never as the only guard. |

---

## 5. AI / Agent Implementation Notes

Not applicable. This feature has no AI/LLM component; identity and tenant isolation are deterministic. The AI surface of the product (Azure Document Intelligence for OCR/KYC) is specified in [RFC-2](rfc-arkilaunch-ocr-edtr-reconciliation.md) and SDD §8. One connection point worth naming: the async OCR/reconciliation workers run under `service_role` (BYPASSRLS) on the cron path, so they must set the tenant context explicitly for every tenant whose documents they process, exactly as the platform-admin path does; a worker never gets to skip tenant scoping just because it can bypass RLS.

---

## 6. Security, Privacy & Performance

**Security surface:**

- **Cross-tenant read/write:** blocked at the database by forced RLS on a non-BYPASSRLS, non-owner role. A crafted request for Tenant B returns zero rows and logs `cross_tenant_access_denied` (US-07 AC2). This is the property QAD abuse tests must prove holds at the DB, not just the app.
- **JWT verification:** algorithm allowlist `["RS256"]` (asymmetric); `alg: none` rejected; RS/HS confusion impossible because the verifier holds only a public key and never an HMAC secret. `iss` and `aud` checked. Clock skew bounded.
- **Refresh tokens:** 256-bit random, stored only as sha-256 hashes, rotated on every use, reuse burns the family (US-07 AC3). A database leak cannot resurrect a session.
- **Passwords:** argon2id (OWASP starting parameters m=19 MiB, t=2, p=1; final tuning confirmed in BUILD/OPS). `password_hash` never logged.
- **RBAC:** every sensitive route declares a permission code; the guard denies by default when no code is satisfied. Owner cannot data-enter; timekeeper cannot reach KYC or settings; platform-admin is reserved (US-10).
- **Tenant context is unspoofable:** `tenant_id` is read only from verified JWT claims, never from a header or body. A client cannot assert a tenant.
- **2FA:** timekeepers enroll TOTP and pass an active-site check before submitting EDTRs (PRD US-02); `totp_secret` encrypted at rest.

**Privacy:**

- Tenant isolation is invisible to users; a user only ever sees their own tenant's data (PRD §5.5). This is also an RA 10173 data-minimization control: one firm's operational and customer data is never exposed to another.
- No PII (raw credentials, tokens, SEC/TIN, card/account numbers) in logs or analytics property values (PRD §5.6 naming rule). `refresh_tokens` stores hashes, not tokens.
- Cross-tenant context switches by platform admins are audit-logged, so support access is accountable.

**Performance:**

- `tenant_id` is the leading column on every tenant-owned index (SDD §3), so RLS's `tenant_id = ...` predicate rides the same index the query already needs; RLS adds a cheap equality check, not a scan.
- `set_config(..., true)` is three fast calls at transaction start, amortized over the request's queries. Measured inside the p95 < 400 ms tenant-CRUD budget (SDD §7).
- The transaction wrapper means every request-path read runs in a transaction; that is expected, not a regression, and keeps GUCs scoped.
- No N+1 introduced; RBAC permission resolution is a single indexed join, cacheable per role if it ever shows up in a profile.

---

## 7. Execution Plan

**Can this ship behind a feature flag?** Partly. Tenant isolation (RLS + forced policies + non-BYPASSRLS role) is a security invariant and ships un-flagged with the tables; you cannot half-enable an isolation boundary. The auth hardening around it can stage: `ENABLE_REFRESH_ROTATION` and `ENABLE_STRICT_RBAC` let refresh reuse detection and per-route permission enforcement roll in progressively during the anchor pilot, with the app-layer `tenant_id` filter always on underneath.

**Ticket breakdown** (create once RFC is Approved; feeds PRD §9 M2/M3):

| Ticket | Description | Size |
|--------|-------------|------|
| `RFC1-01` | Migration EXPAND: create `tenants`, `subscription_plans`, `subscriptions`, `refresh_tokens`; add nullable `tenant_id` to tenant-owned tables; create `app_authenticated` role | M |
| `RFC1-02` | Backfill: seed Almara anchor tenant + `platform_admin` role + permission catalog; `UPDATE ... SET tenant_id` | S |
| `RFC1-03` | Migration CONTRACT: `tenant_id NOT NULL` + FKs; composite `(tenant_id, natural_key)` uniques; ENABLE + FORCE RLS + `tenant_isolation` policy on all 28 tables; leading `tenant_id` indexes | L |
| `RFC1-04` | `withTenant` transaction wrapper + Drizzle `pgPolicy` in-schema; data layer refuses raw `db` access to tenant tables | M |
| `RFC1-05` | Passport-JWT strategy: RS256 keypair, algorithm allowlist, `sub`/`tenant_id`/`role` claims; `POST /auth/login` (+ TOTP) with argon2id verify | M |
| `RFC1-06` | Refresh rotation + reuse detection: `POST /auth/refresh`, family revoke, `refresh_reuse_detected` audit row | M |
| `RFC1-07` | `TenantContextGuard` + `PermissionsGuard` global on `/api/v1/**`; `@RequirePermission` decorator; seed permission codes | M |
| `RFC1-08` | Platform-admin audited per-tenant context path (no BYPASSRLS); cron/worker explicit tenant scoping | M |
| `RFC1-09` | Test suite: cross-tenant read/write fails at DB; RLS-on-every-table assertion; refresh reuse revokes family; role-escalation abuse; GUC-no-leak under pooler | L |
| `RFC1-10` | Wire SAD agents `tenant-isolation-checker` and `migration-rls-guardian` into CI (see below) | S |

**Rollout order:** migration EXPAND -> backfill + seed Almara -> migration CONTRACT (RLS forced) -> `withTenant` + guards -> login/refresh -> RBAC enforcement -> platform-admin path -> full test suite green -> stage the two auth flags on during the anchor pilot. Keep the milestone/phase mapping consistent with [prd-arkilaunch.md](prd-arkilaunch.md) §9 (M2 design, M3 the F3+F1+F7 slice).

**Testing (deep; forward-linked to QAD and SAD).**

- **Tenant isolation, read and write.** Authenticate as Tenant A, set A's context, attempt to SELECT and to UPDATE/INSERT rows with Tenant B's `id`. Both must fail at the database: zero rows on read, `WITH CHECK` rejection on write. Run with the app-layer filter deliberately removed to prove RLS alone holds.
- **RLS-on-every-table check.** A test enumerates all tenant-owned tables from the schema and asserts each has `relrowsecurity` and `relforcerowsecurity` true and a `tenant_isolation` policy present. A new tenant-owned table shipped without a policy fails CI. This is the check the `tenant-isolation-checker` SAD agent runs.
- **No-context fail-closed.** A query with no `app.current_tenant_id` set returns zero rows (never all rows). Proves the fail-closed default.
- **Refresh reuse revocation.** Rotate RT1 to RT2, then replay RT1; assert 401 `token_reuse_detected` and that every row sharing the family is `revoked` and RT2 is dead.
- **Role escalation abuse.** Owner attempts a `*:create`/`*:manage` route; timekeeper attempts `/app/kyc` and `/app/settings/*`; customer attempts `/app/**`. All 403. A forged JWT with an elevated `role` claim fails signature verification.
- **Algorithm-confusion abuse.** Present a token signed `HS256` with the public key as secret, and a token with `alg: none`. Both rejected by the allowlist.
- **Pooler GUC leakage.** Open two transactions on the same physical connection through the Supavisor pooler; assert the second cannot read the first's `app.current_tenant_id`. Proves `local = true` scoping.

Forward-link: these cases become QAD abuse-path rows for PRD-F7 (auth, cross-tenant, role-escalation), and two SAD agents own the standing guards: **`tenant-isolation-checker`** (asserts RLS enabled + forced + policy on every tenant-owned table, and scans for tenant-table queries that skip `withTenant`) and **`migration-rls-guardian`** (blocks any migration that adds a tenant-owned table without a `tenant_id`, the full five-element policy, and a leading-`tenant_id` index in the same migration). Both are materialized to `.claude/agents/tenant-isolation-checker.md` and `.claude/agents/migration-rls-guardian.md` per [sad-arkilaunch.md](sad-arkilaunch.md) SAD-A1/SAD-A2.

---

## 8. Risks & Rollout Notes

- **GUC leakage under the Supavisor pooler.** In transaction pooling mode a physical connection is handed to the next client at transaction end. A session-level `SET` (`local = false`) would leak the tenant context to the next borrower, which is a cross-tenant disaster. Mitigation: **always** `set_config(..., true)` (transaction-local), verified by the pooler-leakage test above and a startup assertion. Prefer Supavisor session mode or a direct connection for the app pool, but the `local = true` discipline is the real guard regardless of pool mode.
- **Drizzle query discipline (the `.rls()` / `withTenant` hazard).** A developer who runs `db.select()` on the raw (non-transaction) handle skips the GUC. It fails closed (zero rows, and `WITH CHECK` blocks writes), so it is a bug not a breach, but a confusing one. Mitigations: the data layer exposes only the `withTenant`-bound `tx` for tenant-owned tables, a lint/CI rule flags direct `db.*` access to those tables, and the `tenant-isolation-checker` agent scans for it.
- **Forgetting `FORCE ROW LEVEL SECURITY`.** `ENABLE` alone leaves the table owner exempt, and migrations run as owner. If a request path ever connected as owner, RLS would silently not apply. Mitigations: the app connects only as `app_authenticated` (non-owner, non-BYPASSRLS), and `migration-rls-guardian` fails any migration that enables RLS without forcing it.
- **Defense in depth is the design, not a fallback.** The app-layer `tenant_id` filter and RLS both run on every tenant query. Neither is trusted alone (SDD §3). Removing the app filter "because RLS covers it" is not allowed; removing RLS "because the app filters" is the thesis's original hole.
- **Refresh-token volume in Postgres.** No Redis in V1 (SDD §1); families and rotations live in Postgres. Fine at anchor scale; revisit if revocation or refresh throughput climbs (the documented Redis add).
- **Almara-as-anchor backfill seam.** The backfill step is trivial today (one tenant) but the nullable-then-NOT-NULL expand/contract seam must exist now, because the second tenant is a data migration, not a schema change. Building the seam late is the expensive path.

---

## Self-Check

- [x] Section 3 has exact schema DDL (`refresh_tokens` table, RLS policy DDL, roles, composite uniques, migration steps), not vague descriptions
- [x] Section 3 API changes have exact request/response shapes (`/auth/login`, `/auth/refresh`, token claims, reuse-detected 401)
- [x] Section 4 has real rejected alternatives with concrete trade-offs (schema-per-tenant, db-per-tenant, Prisma client-extension RLS + the FORCE-RLS bypass hazard, Supabase GoTrue, app-filter-only)
- [x] Section 5: no AI/LLM component in this feature; stated N/A with the one relevant cron/worker tenant-scoping note
- [x] Section 7 ticket list is specific and immediately actionable; rollout order and PRD §9 mapping stated
- [x] Nothing here duplicates PRD feature text or SDD global architecture; this is the deep design one level below both
- [x] Two Mermaid diagrams (auth + RLS request path; refresh rotation + reuse detection); no em-dashes in any label
- [x] Traced to PRD-F7 / US-07 and SDD §3 / §5 components; forward-linked to QAD and the SAD agents `tenant-isolation-checker` + `migration-rls-guardian`
- [x] AGENTS hard bans applied (no em-dashes anywhere, including diagram labels and code comments)
