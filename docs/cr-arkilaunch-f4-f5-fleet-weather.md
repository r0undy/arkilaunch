# Change Record

**Title:** PRD-F4 (Fleet Inventory, Maintenance & Reporting) + PRD-F5 (Weather-Aware Module) implementation
**Project:** ArkiLaunch
**Date:** 2026-08-02
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §4 (endpoint list), [index.md](index.md) §2 (Change Log)

---

## 1. Summary

F4 and F5 were the two remaining Must-Have features with no backend (F1/F3/F6/F7 were already built). This pass closes both: the fleet module (`apps/api/src/fleet/`), the sites/weather module (`apps/api/src/sites/`), the `runtime_hours` accrual hook in `edtr.service.ts`, and two new ACA Jobs (`jobs/src/weather-poll.ts`, `jobs/src/maintenance-notify.ts`). No migration was required; every table F4/F5 touch already existed with its RLS policy.

Four points of drift from the Locked SDD/RFC baseline, logged here per AGENTS.md §5.1 rather than coded around silently.

## 2. Drift 1 — Cron shape: direct job entrypoints, not `POST /internal/jobs/*`

**SDD says:** `POST /internal/jobs/weather-poll` and `POST /internal/jobs/maintenance-threshold-notify` as guarded internal HTTP endpoints (SDD §4).

**What shipped:** `jobs/src/weather-poll.ts` and `jobs/src/maintenance-notify.ts` as direct exported entrypoints, invoked by ACA Jobs as a container command — the same pattern already established by `jobs/src/diesel.ts` and `jobs/src/edtr-ocr-worker.ts` before this pass.

**Why:** Consistency with the two crons that already exist. An internal HTTP surface would be a second cron pattern in the codebase for no functional gain, and it adds an internal-auth surface (who is allowed to call `/internal/jobs/*`) that the direct-entrypoint form does not need.

**Impact:** None on the public API contract (these were never public endpoints). SDD §4's endpoint table is stale on this point; update deferred to the next SDD reconciliation pass.

## 3. Drift 2 — Equipment write endpoints not in the SDD §4 list

**SDD says:** F4's endpoint list is `GET /equipment`, `GET /equipment/:id/maintenance`, `POST /equipment/:id/maintenance-logs`, `GET /reports/utilization`. No create/update for `equipment` itself.

**What shipped:** `POST /api/v1/equipment` and `PATCH /api/v1/equipment/:id`, both `fleet:manage`-gated.

**Why:** Without them, nothing outside the seed script can ever add or transition a unit, so the maintenance and reporting endpoints have no way to be demonstrated on real, API-created data. `PATCH` additionally carries the QAD-T16 guard (refuses `deployed` when the unit is already deployed or maintenance-flagged).

**Impact:** Additive only; no existing contract changed. `reference/equipment` (the read-only pick-list endpoint) is untouched.

## 4. Drift 3 — `weather_alerts` doubles as the reading cache

**SDD says:** `GET /sites/:id/weather` serves "the current advisory + conditions," implying a reading is always available, with `is_stale` set when the poll is behind cadence.

**What shipped:** `jobs/src/weather-poll.ts` writes a `weather_alerts` row on **every** poll cycle — `severity: 'none'`, `status: 'cleared'` when calm — not only on a threshold crossing.

**Why:** A site that has never crossed a threshold would otherwise have zero rows to serve, making the documented `is_stale` fallback (QAD-T17) unimplementable. Writing every cycle is the smallest change that makes the contract real; it does not require a new `weather_readings` table (no migration, no new RLS policy).

**Impact:** `weather_alerts` grows on a 30-minute cadence per active site regardless of severity, not only on incidents. The liability-incident trail (an `events` row) still only fires on an escalation (a new or worsening crossing), so this does not inflate the incident record itself.

## 5. Finding (not fixed in this pass) — deduction double-count on a double-approve

Found while implementing the `runtime_hours` accrual hook, not by this pass's own code: `reconcileEdtr()` (`packages/db/src/reconciliation.ts`) deliberately writes two reconciliation rows per matched pair, one keyed on each EDTR id. `EdtrService.approve()` (`apps/api/src/edtr/edtr.service.ts`) marks only the row it was handed as `approved` and does not check the counterpart. An admin who approves **both** sides of one day's pair — a scenario the two-row design explicitly allows — gets two `deposit_deduction` invoices for one day's work. Each deduction did pass a real reconciliation, so the RFC-2 gate itself is intact; a client's deposit is still debited twice.

**Scope decision:** the `runtime_hours` accrual added by this pass is guarded against the same double-approve (skips accrual when the counterpart's reconciliation is already `approved`; see `edtr.service.ts` and the QAD-T4-adjacent test in `apps/api/test/edtr-engine.spec.ts`). The deduction path itself was left unfixed — editing the money path was judged out of scope for a fleet/weather slice and needs its own RFC-2 review pass, `edtr-ocr-worker` + `ai-ocr-abuse-runner` gates, and a dedicated CR.

**Follow-up:** file a dedicated CR + RFC-2 addendum for the deduction-path fix (apply the same counterpart check `approve()` now has for accrual, plus mark both reconciliation rows approved together).

## 6. Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm build` clean across `packages/shared`, `packages/db`, `jobs`, `apps/api`.
- `pnpm test`: 156 tests passing (`packages/shared` 21, `packages/db` 67, `jobs` 12, `apps/api` 56), run against the live Supabase test project (`pnpm db:seed:test` + `pnpm db:seed` applied first).
- New QAD coverage: T4 (runtime accrual, plus the double-approve guard), T5 (weather advisory + liability incident), T16 (deploy-blocked flagged/busy unit), T17 (Open-Meteo down fallback), T19 (owner denied fleet:manage), T30 (injection in maintenance-log `notes`).
- `apps/web`'s `pnpm test` fails on an unrelated, pre-existing issue (no `vitest.config.ts`, so Vitest's default file discovery picks up the Playwright `e2e/login.spec.ts`); not touched by this pass, not part of this Change Record.
