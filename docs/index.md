# Documentation Index: ArkiLaunch

**Project slug:** `arkilaunch`
**Maintained by:** ArkiLaunch Team (Almara Construction capstone)
**Last updated:** 2026-08-02
**Built on FMD:** v1.28.1

---

> **Manifest / control panel.** Every doc, its version, status, and the two dates. Updated in the same turn any doc is touched. Product: ArkiLaunch, a multi-tenant SaaS for PH heavy-equipment rental MSMEs; Almara Construction is the pilot/anchor tenant. Scale: Full.

---

## 1. Document Suite

| Document | File | Version | Status | Last Updated | Last Reconciled |
|----------|------|---------|--------|--------------|-----------------|
| IDEA · Idea Brief | [idea-arkilaunch.md](idea-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| VALIDATION · Validation Brief | [val-arkilaunch.md](val-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| SCRUTINY · Scrutiny Gate | [scrutiny-arkilaunch.md](scrutiny-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| VOICE · House Style | [voice-arkilaunch.md](voice-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| PITCH · Pitch & Demo | [pitch-arkilaunch.md](pitch-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| WRAP · Next Steps | [wrap-arkilaunch.md](wrap-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| BRD · Business Requirements | [brd-arkilaunch.md](brd-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| UES · Unit Economics Sheet | [ues-arkilaunch.md](ues-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| PRD · Product Requirements | [prd-arkilaunch.md](prd-arkilaunch.md) | 0.1 | Locked | 2026-07-25 | 2026-08-01 |
| DSD · Design System | [dsd-arkilaunch.md](dsd-arkilaunch.md) | 0.1 | Locked | 2026-07-25 | 2026-08-01 |
| SDD · System Design | [sdd-arkilaunch.md](sdd-arkilaunch.md) | 0.1 | Locked | 2026-07-25 | 2026-08-01 |
| QAD · QA & Test Plan | [qad-arkilaunch.md](qad-arkilaunch.md) | 0.1 | Locked | 2026-07-25 | 2026-08-01 |
| SAD · Subagents | [sad-arkilaunch.md](sad-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| BUILD · Build Guide | [build-arkilaunch.md](build-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| CLR · Compliance & Legal | [clr-arkilaunch.md](clr-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| AIA · AI Assurance Dossier | [aia-arkilaunch.md](aia-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| GTM · Go-To-Market | [gtm-arkilaunch.md](gtm-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| OPS · Ops & Observability | [ops-arkilaunch.md](ops-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| LOG · Build Session Log | [log-arkilaunch.md](log-arkilaunch.md) | 0.1 | Draft (append-only) | 2026-07-25 | N/A |

**Materialized at project root (not in `docs/`):** `README.md`, `BRAND.md`, `DESIGN.md`, `AGENTS.md`, `MODEL_CARD.md` (from AIA §1). All five exist and are current as of the 2026-08-01 remediation pass.

### RFCs (one per major feature)

| RFC ID | File | Feature | Status | Last Updated |
|--------|------|---------|--------|--------------|
| arkilaunch-rfc-001 | [rfc-arkilaunch-tenancy-rls-auth.md](rfc-arkilaunch-tenancy-rls-auth.md) | Multi-tenant isolation + identity/auth (PRD-F7) | Locked | 2026-08-01 |
| arkilaunch-rfc-002 | [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) | OCR EDTR + double-entry reconciliation (PRD-F3, PRD-F6) | Locked | 2026-08-01 |
| arkilaunch-rfc-003 | [rfc-arkilaunch-quotation-pricing-engine.md](rfc-arkilaunch-quotation-pricing-engine.md) | Diesel-indexed dynamic quotation (PRD-F1) | Locked | 2026-08-01 |

### 1.1 Traceability Matrix

Must-Have `PRD-F#` coverage. Frozen in the PRD; never renumbered. A Must-Have with `no` in SDD or QAD is a gap.

| PRD-F# | Feature (short) | Priority | In SDD | In QAD | In RFC |
|--------|-----------------|----------|--------|--------|--------|
| PRD-F1 | Dynamic Quotation Engine | Must-Have | yes | yes | rfc-003 |
| PRD-F2 | PayMongo Payment Interface | Should-Have | yes | yes | N/A |
| PRD-F3 | OCR Usage-Based Billing + reconciliation | Must-Have | yes | yes | rfc-002 |
| PRD-F4 | Fleet Inventory, Maintenance & Reporting | Must-Have | yes | yes | N/A |
| PRD-F5 | Weather-Aware Module | Must-Have | yes | yes | N/A |
| PRD-F6 | OCR KYC & Registration | Must-Have | yes | yes | rfc-002 |
| PRD-F7 | Multi-Tenant Access, Identity & RBAC | Must-Have | yes | yes | rfc-001 |
| PRD-F8 | Client Booking Portal | Should-Have | yes | yes | N/A |

---

## 2. Change Log

Every material change to a Locked document is recorded as a Change Record. Newest first.

| CR ID | Date | Summary | Trigger doc | Docs touched | File |
|-------|------|---------|-------------|--------------|------|
| cr-f9-read-surface | 2026-08-02 | Backend read-surface completion: new billing/notifications modules, EDTR review queue + reject, sites CRUD/deployments/weather-advisories/incidents, financial report, global rate limiting + login lockout, and a deposit-ledger arithmetic fix (approve() now caps deductions at `rental_contracts.deposit_required` instead of only ever growing) | build-arkilaunch.md §5.1 | sdd-arkilaunch.md §4, rfc-arkilaunch-tenancy-rls-auth.md §3 | [cr-arkilaunch-f9-read-surface.md](cr-arkilaunch-f9-read-surface.md) |
| cr-f2-f8-bookings-payments | 2026-08-02 | PRD-F2/F8 backend implementation: authenticated `customer` role (not public/guest) for bookings, a booking is `rentals`+`equipment_assignments` (no new table), real PayMongo checkout/webhook adapter behind `ENABLE_PAYMENTS`, webhook event names corrected against live docs, SECURITY DEFINER tenant lookup for the webhook | build-arkilaunch.md §5.1 | sdd-arkilaunch.md §4, rfc-arkilaunch-tenancy-rls-auth.md §3 | [cr-arkilaunch-f2-f8-bookings-payments.md](cr-arkilaunch-f2-f8-bookings-payments.md) |
| cr-edtr-double-approve | 2026-08-02 | Fixes the double-deduction finding deferred by cr-f4-f5-fleet-weather: `EdtrService.approve()` now locks and jointly transitions both reconciliation rows of a matched pair, rejecting a second approve with `409 already_approved` | cr-arkilaunch-f4-f5-fleet-weather.md §5 | rfc-arkilaunch-ocr-edtr-reconciliation.md §3 | [cr-arkilaunch-edtr-double-approve.md](cr-arkilaunch-edtr-double-approve.md) |
| cr-f4-f5-fleet-weather | 2026-08-02 | PRD-F4/F5 backend implementation: direct cron entrypoints (not `/internal/jobs/*`), equipment write endpoints added, `weather_alerts` doubles as the reading cache, deduction double-count finding (deferred) | build-arkilaunch.md §5.1 | sdd-arkilaunch.md §4 | [cr-arkilaunch-f4-f5-fleet-weather.md](cr-arkilaunch-f4-f5-fleet-weather.md) |

---

## 3. Incident Log (Postmortems)

| PM ID | Incident date | Severity | Summary | Action items closed? | File |
|-------|---------------|----------|---------|----------------------|------|
| (none yet) | - | - | - | - | - |

---

## 4. Health Check

- [x] Every Locked doc's **Last Reconciled** date is newer than the last code change to its area. (PRD, SDD, DSD, QAD, and RFC-1/2/3 locked 2026-08-01, ahead of the Phase 2-6 scaffold + PRD-F7 slice implementation starting the same day.)
- [x] No doc has been in `Draft` longer than expected without movement.
- [x] No open Change Records.
- [x] Feature IDs (`PRD-F#`) referenced by SDD / RFC / QAD exist in the PRD (PRD-F1..F8 frozen).
- [x] §1.1 Traceability Matrix matches Must-Have coverage (every Must-Have has SDD + QAD; RFCs cover F1/F3/F6/F7; PRD-F4's SDD entries filled in the 2026-08-01 pass, see below).
- [x] Metric IDs (`BRD-M#`) flow to GTM with a feeding event in PRD §5.6. (PRD §5.6 events wired to BRD-M1..M8; GTM exists, `gtm-arkilaunch.md`.)
- [x] UES `UES-E#` feed GTM pricing; `UES-D#` filled; `BRD-V#` concentrate capital. (UES drafted; `UES-D1..D8` filled; GTM exists and cites UES-E1/E3/E5, UES-D1/D5/D8.)
- [x] SAD roster matches materialized agent files. (SAD exists, `sad-arkilaunch.md`; all 5 files present in `.claude/agents/` with names, models, and tools matching the SAD cards.)
- [x] BUILD pinned versions + golden-path samples re-verified recently. (Currency pass 2026-07-25; every installable package/SDK pins an exact version as of the 2026-08-01 pass, `build-arkilaunch.md` §3; 6 managed-platform rows honestly marked n/a rather than "current".)
- [x] No open Postmortems.
- [x] **Production Readiness Gate**: at the documentation level all inputs exist (SDD §5 security + RLS, CLR register, AIA dossier with escalations tracked, QAD Must-Have + AI-abuse specified, OPS SLOs/alerts/runbooks including the deposit-deduction runbook and NPC 72h clock, PRD §9 rollback, BUILD stack pinned, DSD §8). The gate itself is defined in this section plus [pitch-arkilaunch.md](pitch-arkilaunch.md) §5 and [wrap-arkilaunch.md](wrap-arkilaunch.md) §5, not in the external FMD engine's generic `AGENTS.md` (this repo does not vendor the FMD engine). A shippable-system pass still needs the code, the QAD executed, and the CLR/AIA counsel clearances.
- [~] **Validator (external tool, not reproducible from this repo):** the FMD engine's `check.py` is not vendored here (no `fmd/` directory), so its "0 failures" result from 2026-07-25 cannot be re-run or re-verified from this repository. Treat that historical claim as unverifiable rather than current. A 2026-08-01 manual remediation pass fixed the defects a semantic reconcile would have caught: stale "pending" claims across this file, wrap, ops, dsd, and clr; broken relative links in AGENTS.md/BRAND.md; an under-specified RLS policy in RFC-3; a table-count mismatch across SDD/RFC-1/RFC-3/SAD; missing QAD test rows for the quotation engine; a UES arithmetic double-count; and more (see the LOG entry for this pass). Root `IDEA.md`'s voice violations (em/en-dashes in the source thesis) are a known, accepted exception; not a target for this pass.

---

## 5. Notes

- Scrutiny verdict: **PROCEED WITH FIXES** (2026-07-25). Carried fixes tracked in [scrutiny-arkilaunch.md](scrutiny-arkilaunch.md) §1 and mirrored as gaps G-1..G-10 §3; each lands in its named downstream doc (Open-Meteo commercial -> SDD/OPS/UES done; diesel source -> RFC-3 done; multi-tenancy -> RFC-1/SDD done; ISO 25010 version -> QAD done; Azure DI residency -> CLR done, AIA done with AIA-R7 tracked as the one open, escalated risk; 5-point Likert -> QAD done). G-10 (PayMongo webhook idempotency/refunds/disputes) resolved directly in SDD §4 as of 2026-08-01, no dedicated RFC needed.
- Product framing decision (build start): multi-tenant SaaS (ArkiLaunch), Almara = anchor tenant.
- Confirmed stack decisions: OCR = Azure AI Document Intelligence; payments = PayMongo; stack re-evaluated against current best practices (currency-verified 2026-07-25). Documented divergences from the thesis (persistent Azure Container Apps backend + jobs vs Vercel serverless; Drizzle vs Prisma for first-class RLS; NestJS/Passport identity vs Supabase GoTrue; Vite 8; add Playwright; Open-Meteo commercial plan) are recorded in BUILD §3.
- Engine note: the root `IDEA.md` thesis is the long-form source of record; `docs/idea-arkilaunch.md` is its FMD-shaped distillation.
- Build note: mid-build the org hit a monthly spend limit; the later docs (RFC-3, QAD, CLR, OPS, SAD, BUILD, AIA, GTM, PITCH, WRAP, VALIDATION, VOICE) were authored inline by the orchestrator rather than via parallel subagents.
- Validation (2026-07-25): `check.py docs --scale full` = 0 failures over the generated suite + materialized artifacts. Materialization banner in AGENTS/BRAND/DESIGN was converted from an HTML comment to a blockquote so the voice check would not read the comment's closing `-->` as a spaced dash (FMD `materialize.py` quirk; a candidate engine fix noted in the WRAP field report). Root `IDEA.md` thesis still fails voice (54 em/en-dash and `--` hits); left intact as the user's source document.
- **Remediation pass (2026-08-01):** a full re-audit found the 2026-07-25 validation was a lint/voice pass, not a semantic reconcile, so several waves of later work never propagated back into earlier docs. Fixed: an under-specified RLS policy on `pricing_parameters` (RFC-3) that the `migration-rls-guardian` agent would have silently passed; a table-count mismatch (32 vs 33 vs 35) across SDD/RFC-1/RFC-3/SAD, now reconciled at 35 tables (28 tenant-owned, 7 global); PRD-F4 was a stub in the SDD (no endpoint/contract), now filled; the RFC-3 quotation engine had no QAD test rows despite BUILD/RFC-3 both citing them, now `QAD-T43`..`T48`; OPS runbooks were non-contiguous (4.3-4.7 + 4.6-iso) with two misrouted P0 alert references and no deposit-deduction-failure runbook, now renumbered 4.1-4.7 with the missing runbook added and the NPC 72-hour breach-notification clock specified; a UES arithmetic double-count (Open-Meteo booked in both variable COGS and fixed overhead) understated the illustrative breakeven by ~PHP 220/mo; BRAND.md/DESIGN.md were re-split per the DSD §9 contract (159 duplicated lines removed, missing voice link added, unsubstituted `# Brand:`/`# Design:` titles fixed); MODEL_CARD.md was regenerated against AIA §1 after 9 facts were found dropped in the original hand-authored version; AGENTS.md/BRAND.md had broken relative links from the root (14 total) now `docs/`-prefixed; and this Health Check itself was updated to stop claiming several completed docs (GTM, SAD, BUILD, root artifacts) were still pending. Full findings and fixes are logged in [log-arkilaunch.md](log-arkilaunch.md).
- **Doc-count convention:** §1's Document Suite table lists 19 doc types; together with this index (20) and the 3 RFCs, the filesystem holds 23 `docs/*.md` files. Earlier notes and the LOG that say "20 docs" mean the suite-plus-index count and are counting RFCs separately, not omitting them.
- **Backend completion (2026-08-02):** all eight PRD features (F1..F8) now have a working, tested backend. F2/F8 (last to land, `cr-arkilaunch-f2-f8-bookings-payments.md`) shipped with two deliberate drifts from the PRD/SDD sketch: an authenticated `customer` role rather than the PRD's public/guest catalog (RFC-1's verified-JWT-only tenant rule rules out an unauthenticated write), and corrected PayMongo webhook event names against live-verified docs (`refund.succeeded` + `dispute.created`/`dispute.resolved`, not the SDD sketch's `refund.updated`/generic "dispute"). The same pass also closed the deposit double-deduction finding `cr-arkilaunch-f4-f5-fleet-weather.md` §5 had deferred (`cr-arkilaunch-edtr-double-approve.md`).
- **Backend read-surface completion (2026-08-02, `cr-arkilaunch-f9-read-surface.md`):** the eight features' backends previously exposed only their *write* half. This pass added the missing reads (billing/deposit ledger, EDTR review queue, sites/deployments/weather-advisories/incidents, notifications, financial report) plus global rate limiting, a login lockout, and a real fix to the EDTR deposit-deduction gate's own arithmetic (it previously ignored `rental_contracts.deposit_required` entirely and could never actually cap a deduction). Deferred: S18/S19 settings (rate-card writes, user/role admin), tenant registration + the platform console (S3/S25), and a dedicated dashboard-aggregate endpoint.
