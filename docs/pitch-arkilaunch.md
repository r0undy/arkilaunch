# Pitch Deck & Demo Script (PITCH)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with demo)
**IDEA:** [idea-arkilaunch.md](idea-arkilaunch.md)
**PRD:** [prd-arkilaunch.md](prd-arkilaunch.md)

---

> Capstone-defense narrative + live demo. Hook and problem inherit the IDEA one-liner and pain. Judging map covers the ISO/IEC 25010 evaluation and a standard capstone rubric.

---

## 1. Narrative Spine

**Hook (first 10 seconds):** A flood hits a Quezon City office, and a week of a rental company's field time-sheets turns to pulp. Nobody can prove which hours to bill. The company just ate the loss, again.

**Problem (15 seconds):** Small Philippine equipment-rental firms run on paper: handwritten Equipment Daily Time Reports, quotes hand-computed from diesel and distance over 20 to 30 minutes, and file cabinets that floods destroy. One administrator carries the whole back office, and revenue leaks through every manual step.

**Solution (20 seconds):** ArkiLaunch is the operating system for these firms. It scans the handwritten field logs the crew already fills out, reconciles them against a second independent log before a peso is deducted, prices rentals against live diesel in under a minute, and flags weather risk on site. The paper workflow stays; the leakage stops.

**Proof (demo tease):** In the next 90 seconds you will watch a photo of a handwritten time-sheet become a reconciled, deducted invoice, and a live diesel-indexed quote generated in under a minute.

**Differentiation (10 seconds):** Existing PH rental tools are contact forms that email a quote back hours later. None reads the paper, reconciles two logs, or indexes price to today's diesel. That double-entry evidence trail is the moat.

**Ask / close:** ArkiLaunch runs at Almara Construction as the pilot tenant, and the architecture is multi-tenant from day one. We are validating it against ISO/IEC 25010 and onboarding the next rental firms.

---

## 2. Slide / Scene Outline

| # | Scene | On screen | Speaker says (bullet script) | Duration |
|---|-------|-----------|------------------------------|----------|
| 1 | Hook | Flooded office / ruined EDTR photo | The flood story; the loss is invisible and routine | 0:30 |
| 2 | Problem | Fishbone / revenue-leakage causes | Paper EDTRs, manual quotes, no audit trail; one admin carries it all | 1:00 |
| 3 | Solution | ArkiLaunch dashboard (Yardboard UI) | Scan the paper, reconcile, price on diesel, flag weather; multi-tenant SaaS, Almara anchor | 1:00 |
| 4 | Demo | Live app: EDTR scan -> reconcile -> deduct; live quote; weather advisory | See §3 | 2:30 |
| 5 | Evidence + Ask | ISO/IEC 25010 plan + architecture + roadmap | Validation approach, the moat, pilot + next tenants | 1:00 |

**Total time:** about 6 minutes of talk + demo (fits a capstone defense slot with Q&A after).

---

## 3. Live Demo Script

**Pre-flight (before the panel):** seed the anchor tenant (Almara) with equipment, a rate card, and a fresh diesel price; have a real handwritten EDTR photo and its counterpart tracker log ready; confirm Azure DI, Open-Meteo, and PayMongo sandbox are reachable; load the admin account; have the fallback recording open in another tab.

**Demo path (happy path only):**

1. Log in as the Almara administrator; land on the fleet + weather dashboard (S1).
2. Upload the handwritten EDTR photo; watch Azure DI extract active/idle hours with confidence scores; open the Evidence Split View showing the original image beside the extracted fields.
3. Show the double-entry reconciliation against the tracker's log (within tolerance); approve; watch the deposit auto-deduct into an invoice.
4. Generate a new quotation: pick equipment, set mobilization/demobilization km; the live diesel-indexed price appears in under a minute; print it. Then open the weather-aware dashboard to show a red-flag advisory that auto-logged a liability incident.

**Fallback if live fails:** a 60 to 90 second recorded screen capture of the same path plus static screenshots of the reconciliation and the quote.

**Do not demo:** tenant onboarding internals, admin settings, error states, KYC portal CAPTCHA steps, or payment card entry.

---

## 4. Judging Criteria Map

*Both the ISO/IEC 25010 evaluation sub-characteristics and a standard capstone rubric.*

| Official criterion | Where we address it | Evidence |
|--------------------|---------------------|----------|
| Functional Suitability | Demo steps 2 to 4; PRD-F1/F3 | Reconciled deduction + live quote work end to end |
| Reliability / Security | Scene 3 + §5 gate | RLS tenant isolation, JWT auth, reconciliation gate (SDD §5, QAD) |
| Usability | Demo on the Yardboard UI | Works on a cheap Android at 3 to 5 Mbps; Evidence Split View (DSD) |
| Problem significance + solution fit | Scenes 1 to 2 | Revenue-leakage pain; OCR-of-paper adoption bridge |
| Technical depth | Scene 5 | Multi-tenant RLS, Azure DI OCR + reconciliation, diesel-indexed pricing (RFCs) |
| Evaluation rigor | Scene 5 | ISO/IEC 25010, 5-point Likert, mean >= 3.41, 3 to 5 experts + 15 to 30 users (QAD) |

---

## 5. Production Readiness Gate (pre-demo)

*Documentation suite is complete; implementation is the next phase, so gate items are marked at the documentation level with honest notes.*

| Check | Status | Notes |
|-------|--------|-------|
| Security reviewed | Documented | SDD §5 + RFC-1: RLS, JWT rotation, RBAC; verify on code |
| CLR (user data) | Documented | CLR drafted; RA 10173/10175; counsel review flagged |
| AIA (AI/ML component) | Documented w/ escalations | AIA drafted; Azure DI residency + KYC counsel review open (AIA §4) |
| Context hygiene (AI product) | Documented | Uploads + extraction treated as untrusted; no autonomous money movement |
| QAD Must-Have paths | Specified | QAD happy/sad/abuse + AI-01..AI-06 defined; execute on code |
| OPS wired | Documented | OPS SLOs + alerts + runbooks drafted |
| Rollback (PRD §9) | Documented | Single-source rollback in PRD §9 |
| BUILD stack pinned | Pass | Stack pinned + currency-verified 2026-07-25 (BUILD §3) |
| DSD §8 gate (UI) | Specified | Yardboard design system + impeccable gate defined |

*Before a real public launch, these move from Documented/Specified to Pass on the built system, and the AIA + CLR escalations clear (GTM §6 gate).*

---

## 6. Anticipated Q&A

| Likely question | Short answer |
|-----------------|--------------|
| The thesis argued for zonal OCR but you use Azure AI Document Intelligence. Why? | Azure DI labeled custom extraction with bounding regions is the same zonal idea, ML-backed and managed; we kept the confidence gate and human-in-the-loop, and stated the divergence honestly (RFC-2). |
| How do you stop one tenant seeing another's data? | Postgres row-level security keyed on tenant_id, enforced on a non-superuser role via a transaction-scoped session variable, plus an app-layer filter (RFC-1); cross-tenant access is a first-class QAD abuse test. |
| Is Open-Meteo really free for this? | Free only for non-commercial use; ArkiLaunch is commercial, so we budget the commercial plan (surfaced in the scrutiny gate and the UES). |
| What if the OCR misreads an EDTR? | It never deducts on a low-confidence read; below the confidence gate or on a reconciliation mismatch it routes to human review, and a deduction always needs a passing reconciliation. |
| Why is this a SaaS and not just Almara's tool? | The pain is industry-wide; the data model and auth are multi-tenant from day one, with Almara as the anchor tenant and the reference case study. |

---

## Self-Check

- [x] Hook does not start with "Today we will…" (opens on the flood scene)
- [x] IDEA one-liner is restated in Solution/Ask ("operating system for PH heavy-equipment rental MSMEs")
- [x] Named user / pain appears in Hook and Problem (the flooded office, the lone admin)
- [x] Every judging criterion has a mapped beat (ISO 25010 + capstone rubric)
- [x] Production Readiness Gate (§5) status stated honestly (docs complete; code pending)
- [x] Demo script is rehearse-able in the slot; fallback recording exists
- [x] AGENTS hard bans applied (no em-dashes); VOICE polish clean
- [x] Next suggested doc: WRAP (after defense)
