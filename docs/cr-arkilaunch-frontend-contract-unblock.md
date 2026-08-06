# Change Record

**Title:** Backend-unblock pass for frontend work: local dev runbook, shared response Zod schemas for the read surface, tenant-application/self-profile/catalog-detail reads, and a fixture KYC extractor
**Project:** ArkiLaunch
**Date:** 2026-08-06
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §4 (endpoint table additions), [index.md](index.md) §2 (Change Log)

---

## 1. Summary

The backend was already feature-complete: all eight PRD features plus the `cr-arkilaunch-f9-read-surface.md` read-surface pass had shipped, and the two prior CRs (`cr-arkilaunch-tenant-registration-catalog.md`, `cr-arkilaunch-storage-upload.md`) were themselves backend-unblock passes. This pass closes the three things that still blocked frontend work rather than adding new backend features:

1. A written, repeatable local bring-up path (`docs/runbook-local-dev.md`) plus two small drift fixes (`JWT_ACCESS_TOKEN_TTL` was documented in `.env.example` but never read; a duplicate `runs-on` key in `.github/workflows/ci.yml`; `GET /health` now runs a trivial query so it distinguishes "API is up" from "API can reach Postgres").
2. Shared **response** Zod schemas for every list/detail endpoint the frontend was consuming as `unknown` (`apps/web/src/lib/queries.ts`) — sites, weather advisories, incidents, billing, bookings, notifications, fleet reports, and tenant applications. Each is an egress allowlist (only fields the frontend renders), mirroring the discipline `catalog_list_equipment` already set.
3. Four genuinely missing reads: `GET /tenants/applications` (platform console), `GET /tenants/me/application` (an owner's own pending application), `GET /users/me` (self-service profile, since `UsersController` is class-level gated on `user:manage`), and `GET /catalog/equipment/:id` (equipment detail, public/anchor-tenant).

Also: bound a `FixtureDocumentIntelligenceAdapter` in `kyc.module.ts` (previously always `StubDocumentIntelligenceAdapter`, which returns empty fields and always renders nothing) so `/app/registration` shows real-shaped extracted values in local dev. No change to the reconciliation gate or the deposit-deduction path — RFC-2's "never deduct without a passing reconciliation or explicit human approval" is unaffected; only the extracted-field *values* changed, not the always-`needs_review` state machine.

No table changes. Two hand-authored migrations (0011, 0012) add read-only `SECURITY DEFINER` SQL functions, the same pattern as `catalog_list_equipment`/`tenants_decide_application` — additive, non-destructive.

## 2. Local dev runbook and drift fixes

- New: `docs/runbook-local-dev.md` (Draft) — Supabase dev project setup, `.env` fill-in order with call-outs for the non-obvious vars (`DATABASE_URL_DIRECT` vs `_POOLED`, `APP_AUTHENTICATED_PASSWORD`, `ANCHOR_TENANT_SLUG`), migrate/seed/run, and verification steps.
- `apps/api/src/auth/auth.service.ts`: `ACCESS_TOKEN_TTL_SECONDS` now reads `JWT_ACCESS_TOKEN_TTL` (seconds) with a 600s default, instead of silently ignoring the env var `.env.example` already documented.
- `.github/workflows/ci.yml`: removed a duplicate `runs-on: ubuntu-latest` key on `cross-tenant-isolation-suite`.
- `apps/api/src/health/health.controller.ts`: `GET /health` now runs `select 1` against the pooled connection and returns `503 { status: 'db_unreachable' }` on failure, so a green health check actually proves DB connectivity, not just process liveness.

## 3. Shared response schemas (the actual frontend unblock)

New/extended in `packages/shared/src/`: `sites.ts` (`SiteResponse`, `SiteListResponse`, `SiteDetailResponse`, `SiteAddressResponse`, `IncidentResponse`/`IncidentListResponse`), `weather.ts` (`WeatherAdvisoryResponse` converted from a bare TS interface to a Zod schema, plus `WeatherAdvisoryListResponse`), `billing.ts` (`InvoiceSummaryResponse`/`InvoiceListResponse`/`InvoiceDetailResponse`/`DepositLedgerResponse`/`EdtrDeductionEvidence`/`AuditTrailEntry`), `bookings.ts` (`BookingCreateResponse`/`BookingSummaryResponse`/`BookingListResponse`/`BookingDetailResponse`), `notifications.ts` (`NotificationResponse`/`NotificationListResponse`), `fleet.ts` (`EquipmentResponse`/`EquipmentListResponse`/`MaintenanceDetailResponse`/`UtilizationReportResponse`/`FinancialReportResponse`), `tenants.ts` (`TenantApplication`/`TenantApplicationListResponse`), `users.ts` (`UserSelfResponse`).

The corresponding Nest services (`sites.service.ts`, `billing.service.ts`, `bookings.service.ts`, `notifications.service.ts`, `fleet.service.ts`) had this data shape already, mostly as local, unexported TS interfaces (`SiteResponse`, `InvoiceSummary`, `EquipmentResponse`, etc.) — this pass moved those into `packages/shared` as Zod schemas with inferred types and pointed the services at the shared versions, so the frontend gets the same type the backend already used internally, not a hand-copied duplicate that can drift.

`apps/web/src/lib/queries.ts`: `sitesQueries`, `invoicesQueries`, `incidentsQueries`, `bookingsQueries`, `reportQueries` now type their `apiGet<...>` calls against the shared response types instead of `unknown[]`/`unknown`. The five `DataPanel`-backed routes that consumed these (`app.payments.tsx`, `app.incidents.tsx`, `app.deployment.tsx`, `account.bookings.tsx`, `field.deployment.tsx`) had their `isEmpty`/`render` callbacks updated from `data.length`/`JSON.stringify(data)` to `data.total`/`JSON.stringify(data.items)`, since the response is now `{ items, total }`, not a bare array — `DataPanel` itself (`apps/web/src/components/data-panel.tsx`) is unchanged, still a generic loading/error/empty/success wrapper, still rendering raw JSON as a deliberate placeholder for a bespoke table (per `cr-arkilaunch-frontend-storefront-shell.md` §4's deferred-UI list).

## 4. New endpoints

| Module | Endpoint | Notes |
|---|---|---|
| `apps/api/src/tenants/` | `GET /tenants/applications` (`tenant:approve`, `platform_admin`) | Cross-tenant read, same rationale as `tenants_decide_application` — a platform_admin's own RLS GUC is their own tenant, so a normal `withTenantTx` query can never see another tenant's `tenant_applications` rows. New `SECURITY DEFINER` function `tenants_list_pending_applications()` (migration `0011`), read-only, returns only pending applications and only the fields a review decision needs. |
| `apps/api/src/tenants/` | `GET /tenants/me/application` (`tenant:manage`) | Same-tenant read (an owner's own latest application, if any) — a normal RLS-scoped query, no new SQL function. Unblocks `account.applications.tsx`. |
| `apps/api/src/users/` (new `UserProfileController`) | `GET /users/me` | `UsersController` is class-level gated on `user:manage`, which a `customer` never holds — a separate controller was required, not a method-level permission override (`PermissionsGuard`'s `getAllAndOverride` only overrides when the handler sets a *defined* value; there is no "opt out of the class gate" sentinel). **Registration order matters**: `UsersModule` registers `UserProfileController` before `UsersController`, since `UsersController` has a class-level `@Get(':id')` that would otherwise swallow `GET /users/me` (`id = 'me'`) before Nest/Express ever reaches the literal route. No `PATCH /users/me`: `users` has no self-editable field today (email/role/status are all admin-governed; there is no display-name column) — deferred rather than fabricating a field or silently accepting a governed one, per the restraint ladder. |
| `apps/api/src/catalog/` | `GET /catalog/equipment/:id` | Same `@Public`, anchor-tenant-only, `SECURITY DEFINER` posture as the existing list endpoint (migration `0012`, `catalog_get_equipment`), same safe-column allowlist (no `serialNo`/`runtimeHours`). `equipment.$equipmentId.tsx` now calls this directly instead of fetching the full catalog list and filtering client-side. |

## 5. Fixture KYC extractor

`apps/api/src/kyc/kyc.module.ts` previously bound `StubDocumentIntelligenceAdapter` unconditionally — it returns `{ fields: {} }`, so `/app/registration` always rendered no extracted values. No real Azure DI adapter exists for either state of `ENABLE_OCR_KYC` yet (a follow-up once live credentials + a trained model exist), so the flag currently has no effect on which adapter binds; this pass swapped the binding to `FixtureDocumentIntelligenceAdapter` with plausible SEC/TIN values, the same posture `edtr.controller.ts`'s `POST /edtr/dev/run-worker` already had. `kyc.service.ts`'s always-`needs_review` state machine (RFC-2 §2, "requires human confirmation" is always `true`) is unaffected — only the extracted-field values a human reviews changed from nothing to something plausible.

## 6. Migrations

Two additive, non-destructive, hand-authored migrations (same class as `0006`/`0010`), both registered in `packages/db/migrations/meta/_journal.json`:

- `0011_tenant_applications_list.sql` — `tenants_list_pending_applications()`.
- `0012_public_catalog_detail.sql` — `catalog_get_equipment(p_slug, p_id)`.

**Not applied against a live database as part of this change** — no Supabase project was available in this environment. Both follow the exact pattern of an already-applied, already-reviewed migration in this repo (`0009`/`0010`), and `pnpm typecheck` is clean end to end, but `migration-rls-guardian` and the live-pooler suites (`packages/db/test/tenant-isolation.spec.ts`, `rls-enumeration.spec.ts`, `guc-pooler-leak.spec.ts`) have not run against this diff. Flagged per §7 below — run `pnpm db:migrate` against a real dev project and the full verification list before merging.

## 7. Verification

- `pnpm typecheck` clean across `packages/shared`, `packages/db`, `apps/api`, `apps/web` (each package rebuilt/retypechecked individually after every schema change in this pass).
- **Not run in this environment (no live Supabase project, no Node/pnpm test runner available here):** `pnpm lint`, `pnpm test`, `pnpm e2e`, the live-pooler RLS suites, and the pre-merge subagent gates named in `AGENTS.md` §2 — `tenant-isolation-checker` (new tenant-applications/users-me/catalog-detail data paths), `migration-rls-guardian` (migrations `0011`/`0012`), `restraint-guardian` (whole diff). **Run all of these before merging** — this CR documents what was built and typechecked, not a full green CI run.
- Manual verification path once a dev project exists: `pnpm db:migrate && pnpm db:seed:test`, register a tenant, call `GET /tenants/applications` as a seeded `platform_admin`, approve, activate, log in, and confirm the five `DataPanel` routes render tables (not raw arrays crashing on `.length`) and that tenant B's rows never appear for tenant A.

## 8. Scope note

Deferred, named explicitly rather than silently dropped:

- `GET /dashboard` aggregate endpoint — restraint ladder already ruled it out in `cr-arkilaunch-f9-read-surface.md` §7; still true.
- Email provider (Resend/SES) — the real blocker for invites, notifications, and self-service password reset; needs its own `build-arkilaunch.md` §3 register row and CR.
- `PATCH /users/me` — no editable field exists yet (§4 above).
- Two known Locked-doc/RFC-1 drifts, flagged but not fixed in this pass (both pre-exist this CR): access token stored in `sessionStorage` (`apps/web/src/lib/auth-client.ts`) vs RFC-1 §3's in-memory requirement, and the 2FA challenge dead-ending in `login.tsx` ("not yet supported here") despite a live, tested backend (`two-fa.controller.ts`).
