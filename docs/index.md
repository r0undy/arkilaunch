# Documentation Index: ArkiLaunch

**Project slug:** `arkilaunch`
**Maintained by:** ArkiLaunch Team (Almara Construction capstone)
**Last updated:** 2026-07-25
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
| PRD · Product Requirements | [prd-arkilaunch.md](prd-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| DSD · Design System | [dsd-arkilaunch.md](dsd-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| SDD · System Design | [sdd-arkilaunch.md](sdd-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| QAD · QA & Test Plan | [qad-arkilaunch.md](qad-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| SAD · Subagents | [sad-arkilaunch.md](sad-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| BUILD · Build Guide | [build-arkilaunch.md](build-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| CLR · Compliance & Legal | [clr-arkilaunch.md](clr-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| AIA · AI Assurance Dossier | [aia-arkilaunch.md](aia-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| GTM · Go-To-Market | [gtm-arkilaunch.md](gtm-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| OPS · Ops & Observability | [ops-arkilaunch.md](ops-arkilaunch.md) | 0.1 | Draft | 2026-07-25 | N/A |
| LOG · Build Session Log | [log-arkilaunch.md](log-arkilaunch.md) | 0.1 | Draft (append-only) | 2026-07-25 | N/A |

**Materialized at project root (not in `docs/`):** `README.md`, `BRAND.md`, `DESIGN.md`, `AGENTS.md`, `MODEL_CARD.md` (from AIA §1). Pending materialization.

### RFCs (one per major feature)

| RFC ID | File | Feature | Status | Last Updated |
|--------|------|---------|--------|--------------|
| arkilaunch-rfc-001 | [rfc-arkilaunch-tenancy-rls-auth.md](rfc-arkilaunch-tenancy-rls-auth.md) | Multi-tenant isolation + identity/auth (PRD-F7) | Draft | 2026-07-25 |
| arkilaunch-rfc-002 | [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) | OCR EDTR + double-entry reconciliation (PRD-F3, PRD-F6) | Draft | 2026-07-25 |
| arkilaunch-rfc-003 | [rfc-arkilaunch-quotation-pricing-engine.md](rfc-arkilaunch-quotation-pricing-engine.md) | Diesel-indexed dynamic quotation (PRD-F1) | Draft | 2026-07-25 |

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
| (none yet) | - | - | - | - | - |

---

## 3. Incident Log (Postmortems)

| PM ID | Incident date | Severity | Summary | Action items closed? | File |
|-------|---------------|----------|---------|----------------------|------|
| (none yet) | - | - | - | - | - |

---

## 4. Health Check

- [ ] Every Locked doc's **Last Reconciled** date is newer than the last code change to its area. (No code yet; all docs Draft.)
- [x] No doc has been in `Draft` longer than expected without movement.
- [x] No open Change Records.
- [x] Feature IDs (`PRD-F#`) referenced by SDD / RFC / QAD exist in the PRD (PRD-F1..F8 frozen).
- [x] §1.1 Traceability Matrix matches Must-Have coverage (every Must-Have has SDD + QAD; RFCs cover F1/F3/F6/F7).
- [~] Metric IDs (`BRD-M#`) flow to GTM with a feeding event in PRD §5.6. (PRD §5.6 events wired to BRD-M1..M8; GTM pending Wave G.)
- [~] UES `UES-E#` feed GTM pricing; `UES-D#` filled; `BRD-V#` concentrate capital. (UES drafted; `UES-D1..D8` filled; GTM pending.)
- [ ] SAD roster matches materialized agent files. (SAD pending Wave F; materialization pending.)
- [ ] BUILD pinned versions + golden-path samples re-verified recently. (Currency pass done 2026-07-25; BUILD pending Wave G.)
- [x] No open Postmortems.
- [x] **Production Readiness Gate** (AGENTS.md): at the documentation level all inputs exist (SDD §5 security + RLS, CLR register, AIA dossier with escalations tracked, QAD Must-Have + AI-abuse specified, OPS SLOs/alerts, PRD §9 rollback, BUILD stack pinned, DSD §8). A shippable-system pass still needs the code, the QAD executed, and the CLR/AIA counsel clearances (see [wrap-arkilaunch.md](wrap-arkilaunch.md) §5).
- [x] **Validator green (generated suite):** `python fmd/scripts/check.py docs --scale full` passes with **0 failures** across all 20 FMD docs and the materialized root artifacts (AGENTS/BRAND/DESIGN/MODEL_CARD/README); 2 warnings cleared. The remaining `check.py` failures are voice violations **inside the root `IDEA.md` thesis** (the user-provided academic source, scanned by G15), a source artifact rather than an FMD deliverable. Convert root `IDEA.md` to a thin pointer (preserving the thesis) for a fully green run.

---

## 5. Notes

- Scrutiny verdict: **PROCEED WITH FIXES** (2026-07-25). Carried fixes tracked in [scrutiny-arkilaunch.md](scrutiny-arkilaunch.md) §1 and mirrored as gaps G-1..G-10 §3; each lands in its named downstream doc (Open-Meteo commercial -> SDD/OPS/UES done; diesel source -> RFC-3 done; multi-tenancy -> RFC-1/SDD done; ISO 25010 version -> QAD done; Azure DI residency -> CLR done, AIA pending; 5-point Likert -> QAD done).
- Product framing decision (build start): multi-tenant SaaS (ArkiLaunch), Almara = anchor tenant.
- Confirmed stack decisions: OCR = Azure AI Document Intelligence; payments = PayMongo; stack re-evaluated against current best practices (currency-verified 2026-07-25). Documented divergences from the thesis (persistent Azure Container Apps backend + jobs vs Vercel serverless; Drizzle vs Prisma for first-class RLS; NestJS/Passport identity vs Supabase GoTrue; Vite 8; add Playwright; Open-Meteo commercial plan) are recorded in BUILD §3.
- Engine note: the root `IDEA.md` thesis is the long-form source of record; `docs/idea-arkilaunch.md` is its FMD-shaped distillation.
- Build note: mid-build the org hit a monthly spend limit; the later docs (RFC-3, QAD, CLR, OPS, SAD, BUILD, AIA, GTM, PITCH, WRAP, VALIDATION, VOICE) were authored inline by the orchestrator rather than via parallel subagents.
- Validation (2026-07-25): `check.py docs --scale full` = 0 failures over the generated suite + materialized artifacts. Materialization banner in AGENTS/BRAND/DESIGN was converted from an HTML comment to a blockquote so the voice check would not read the comment's closing `-->` as a spaced dash (FMD `materialize.py` quirk; a candidate engine fix noted in the WRAP field report). Root `IDEA.md` thesis still fails voice (54 em/en-dash and `--` hits); left intact as the user's source document.
