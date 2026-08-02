# Change Record

**Title:** Backend read-surface completion: billing/deposit ledger, EDTR review queue, sites/deployments/weather/incidents, notifications, financial report, rate limiting, and a deposit-arithmetic fix
**Project:** ArkiLaunch
**Date:** 2026-08-02
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §4 (endpoint table, stale refund-event-name cleanup), [rfc-arkilaunch-tenancy-rls-auth.md](rfc-arkilaunch-tenancy-rls-auth.md) §3 (RBAC catalog drift, noted below), [index.md](index.md) §2 (Change Log)

---

## 1. Summary

All eight PRD features had a working backend, but only the *write* half of each: there was no way to list the reconciliation review queue, read an invoice or a deposit ledger, create a project site, read a notification, or see a financial report. This pass closes those gaps: a new `apps/api/src/billing/` module, a new `apps/api/src/notifications/` module, extensions to `apps/api/src/edtr/`, `apps/api/src/sites/`, and `apps/api/src/fleet/`, a global rate-limit guard plus a login-lockout, and a correctness fix to the EDTR deposit-deduction gate's own arithmetic. No new tables and no migration -- every endpoint reads or writes existing schema.

## 2. Correctness fix -- deposit ledger arithmetic (`apps/api/src/edtr/edtr.service.ts`)

**What was wrong:** `EdtrService.approve()` computed `deposit.balanceBefore`/`balanceAfter` as the running *sum of prior deduction invoices*, ignoring `rental_contracts.deposit_required` entirely -- the code's own comment called this "not the exact deposit-ledger arithmetic." A field named `balance` actually behaved as an ever-increasing total; nothing capped a deduction at the configured deposit.

**Fix:** a new shared helper, `packages/db/src/deposit-ledger.ts` (`resolveDepositLedger`), resolves a rental's `deposit_required` via `rentals -> quotations -> rental_contracts` (latest of each) plus its `deposit_deduction` invoice history. `approve()` now uses it: when a deposit is configured, `balanceBefore = depositRequired - totalDeducted`, `balanceAfter = balanceBefore - deducted`, and the call is rejected with `409 { error: 'deposit_exhausted', balanceBefore, attemptedDeduction }` *before* the invoice is written if `balanceAfter < 0`. When no quotation/rental_contracts chain exists for the rental (the common case today -- a booking created via `bookings.service.ts` never quotes, same gap `payments.service.ts`'s `DEFAULT_DEPOSIT_PHP` fallback already documents), the prior running-total behavior is kept unchanged and nothing is capped, since there is no real cap to measure against.

`billing.service.ts`'s new `GET /api/v1/rentals/:id/deposit` uses the same `resolveDepositLedger` helper, so the two can never disagree about a rental's remaining deposit.

## 3. New endpoints

| Module | Endpoints | Notes |
|---|---|---|
| `apps/api/src/billing/` (new) | `GET /invoices`, `GET /invoices/:id`, `GET /rentals/:id/deposit` | `billing:read`-gated. Invoice detail's evidence trail parses the `EDTR reconciliation {id} (sources: {a}, {b})` string `edtr.service.ts` already writes into `invoice_line_items.description` (a documented simplification -- a structured FK would need a migration this pass didn't need) and joins the `audit_logs` DEDUCT row directly by `entity_id`. |
| `apps/api/src/edtr/` (extended) | `GET /edtr` (review queue), `POST /edtr/:id/reject` | List sorts `review`-status rows first (single-source-pending and tolerance-exceeded discrepancies both land in `edtr.status = 'review'`, `packages/db/src/reconciliation.ts`); a timekeeper's results are scoped to their assigned sites, the same US-02 AC2 boundary `capture()` already enforces, extended to reads. `reject()` writes `edtr_reconciliations.status = 'rejected'` (a value the check constraint already permitted but nothing wrote); deducts nothing; scoped to only the given EDTR's own reconciliation row, not its counterpart -- rejecting doesn't move money, so there is no double-spend invariant to protect the way `approve()`'s pair-lock protects one. |
| `apps/api/src/sites/` (extended) | `GET`/`POST`/`PATCH /sites`, `POST /sites/:id/deployments`, `PATCH /sites/:id/deployments/:assignmentId/return`, `GET /weather/advisories`, `GET /incidents` | Deployment reuses `bookings.service.ts`'s overlap-check + `FOR UPDATE` lock + alternatives logic, extracted to `apps/api/src/common/equipment-availability.ts` so QAD-T16/T21 (never deploy/double-book an unavailable or maintenance-flagged unit) hold on this path too, not only booking. `createDeployment` validates `rental.projectSiteId === siteId` (a rental for a different site can't "deploy to" this one) -- this is also what keeps `returnDeployment`'s own site-scope check from ever finding a deployment it cannot return. `incidents` reads `events` where `name = 'weather_liability_incident'` (already written by `jobs/src/weather-poll.ts`) -- no new table, restraint ladder. |
| `apps/api/src/notifications/` (new) | `GET /notifications`, `PATCH /notifications/:id/read` | `jobs/src/maintenance-notify.ts` already writes `notifications` rows; nothing could read them before this pass. Scoped to the caller's own rows (`user_id = ctx.userId`); not permission-gated -- reading your own notifications isn't a privileged action, RLS is the backstop. |
| `apps/api/src/fleet/` (extended) | `GET /reports/financial` | QAD-T8 expects "utilization *and financial* summaries"; only the utilization half existed. Aggregates `invoices`/`payments` over a period, same `report:read` gate and default 30-day window as `utilizationReport`. |

## 4. RBAC catalog drift (RFC-1 §3)

Two permissions added to `packages/shared/src/permissions.ts`'s `PERMISSION_CODES`, additive only (same posture as `cr-arkilaunch-f2-f8-bookings-payments.md` §3):

- `billing:read` -- granted to `admin`, `owner` (read-mostly, QAD-T19), `platform_admin`.
- `site:manage` -- granted to `admin`, `platform_admin`.

No existing role's existing grants changed.

## 5. Rate limiting and login lockout (QAD-T22, QAD-T31)

- `@nestjs/throttler` 6.5.0 added as a fourth global `APP_GUARD`, ordered *first* (before `JwtAuthGuard`) so it also covers `@Public` routes like `/auth/login`. A generous default (120 req/min) applies everywhere; `POST /edtr`, `POST /kyc/extract`, `POST /quotes`(`/preview`), and `POST /bookings/:id/checkout` override it down to 10-20/min via `@Throttle`.
- **Deviation from the original plan:** the plan called for migrating `payments.service.ts`'s existing tenant-scoped, Postgres-backed `CHECKOUT_RATE_LIMIT` onto this shared mechanism so there would be "one limiter, not two." That was **not done**: this repo's engine test suite (`apps/api/test/*-engine.spec.ts`) calls services directly, bypassing NestJS's HTTP guard layer entirely, and `payments-engine.spec.ts`'s existing, passing QAD-T31 test asserts the service-level limiter throws after 20 calls in a tight loop -- a check an HTTP-only guard cannot satisfy from that test architecture. The existing limiter was left in place; the new `@Throttle` on checkout is additional, outer-layer defense-in-depth, not a replacement.
- Login lockout: `AuthService` tracks failed attempts in an in-process `Map` keyed by lowercased email (no Redis in V1, BUILD §3; resets on restart). After 5 consecutive failures within 15 minutes, further attempts are rejected with `429 { error: 'login_locked', retryAfterSeconds }` before password verification even runs. Keyed by email rather than tenant, since login runs before any tenant context exists -- the same no-enumeration posture `AuthService.login()` already had for "same error for bad email, bad password."
- **Not unit-tested at the HTTP layer:** the global `ThrottlerGuard` itself has no automated test. Exercising it requires a NestJS HTTP test harness (`Test.createTestingModule` + supertest or similar), which does not exist anywhere in this repo today -- every existing spec calls services directly. Building that harness was out of scope for this pass; flagged here rather than silently claimed as covered. Manual verification: `curl` a burst against a `@Throttle`-decorated route on a running `pnpm dev` API and confirm a `429` with a `Retry-After` header.

## 6. Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm build` clean across `packages/shared`, `packages/db`, `jobs`, `apps/api`, `apps/web`.
- `pnpm test`: `packages/shared` 21/21, `packages/db` 67/67, `jobs` 12/12, `apps/api` 98/98 (19 files, including 5 new: `billing-engine.spec.ts`, `sites-engine.spec.ts`, `notifications-engine.spec.ts`, `auth-lockout.spec.ts`, plus extensions to `edtr-engine.spec.ts`) -- all run against the live Supabase test project. `apps/web`'s pre-existing, unrelated Vitest-picks-up-Playwright failure (no `vitest.config.ts`; documented in `cr-arkilaunch-f4-f5-fleet-weather.md` §6) is untouched by this change; `apps/web`'s **build** passes clean.
- New QAD coverage: the deposit-exhaustion 409 case (extending QAD-T26); QAD-T23 (cross-tenant read denied for invoices/deposit ledger); QAD-T24 (cross-tenant write denied for site deployment); QAD-T16 extended to the deployment path (already-deployed and maintenance-flagged both refused); QAD-T21 extended to deployment (never double-books); QAD-T29 extended to reads (a timekeeper's review queue excludes unassigned sites); QAD-T22 (login lockout).
- **Fixed two pre-existing test fixture bugs surfaced while adding the above**, unrelated to this change's own logic but blocking a clean full-suite run: (a) `apps/api/test/weather-engine.spec.ts` instantiated `SitesService` with zero arguments -- `SitesService` now requires `EventsService` since sites CRUD/deployments emit events; fixed to `new SitesService(new EventsService())`. (b) `apps/api/test/bookings-engine.spec.ts`'s idempotency cleanup deleted stale rentals without first clearing their `invoices`/`payments` rows, which started failing (`invoices_rental_id_rentals_id_fk` violation) once enough accumulated test runs gave `payments-engine.spec.ts`'s own leftover rentals (created against the same shared equipment fixture, on an overlapping date range) real deposit invoices attached; fixed to clear `payments` then `invoices` before `rentals`, matching the order `payments-engine.spec.ts`'s own cleanup already uses.

## 7. Scope note

Pre-merge gates named in `AGENTS.md` §2 (`tenant-isolation-checker` for the new billing/sites/notifications data paths, `restraint-guardian` for the whole diff) were not run as part of this change -- flag if/when you want them run against this diff before it ships. `migration-rls-guardian` is not applicable: no migration in this pass.

Deferred, per the "Out of scope" section of the plan this CR implements: S18/S19 settings (rate-card writes, user invite/role assignment -- `user:manage` still has no endpoint), tenant self-registration and the platform console (S3/S25), and a dedicated `GET /dashboard` aggregate endpoint (S4 can compose the list endpoints above; revisit only if p95 latency on the 3-5 Mbps profile proves it necessary, per the restraint ladder).
