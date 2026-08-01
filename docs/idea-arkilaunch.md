# Idea Brief (IDEA)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with reality)
**Event / context:** Undergraduate capstone build for Almara Construction Corporation (Quezon City, PH); productized as a multi-tenant SaaS. Distilled from the root `IDEA.md` thesis.

---

> **Note:** This brief is the FMD-shaped distillation of the full capstone thesis at `../IDEA.md`. The thesis remains the source of record for the literature review, diagrams, and 29-entity data dictionary. Product framing decision (build start): ArkiLaunch is a multi-tenant SaaS for Philippine heavy-equipment rental MSMEs; **Almara Construction is the pilot / anchor tenant.**

---

## 1. The Spark

**Production intent:** A real, deployable multi-tenant SaaS from day one. Almara runs on it in production (pilot tenant); the capstone defense and ISO/IEC 25010 UAT are delivery milestones, not the goal. We ship with auth, tenant isolation, tests, observability, and rollback, not a mock.

**One-line pitch:** ArkiLaunch is the operating system for Philippine heavy-equipment rental MSMEs: it scans handwritten field time-sheets, auto-prices rentals from live diesel and travel distance, and flags weather risk on site, so paper-based rental firms stop leaking revenue.

**Problem:** Small PH construction-equipment rental companies run on paper Equipment Daily Time Reports (EDTRs), phone-and-Messenger quotations hand-calculated from diesel, distance, and labor, and file-cabinet archives. This causes revenue leakage (mis-billed and unbilled hours), slow quotations, weather-driven liability disputes, and flood-vulnerable data loss. Almara Construction Corporation in Quezon City is the exemplar: one administrator carries the entire back office by hand.

**Insight (why us, why now):** The field workforce will not abandon paper, so the winning move is to *back-end the paper* rather than force a born-digital workflow: OCR the existing handwritten EDTRs and reconcile them with a second independent log (double-entry) before any deposit deduction. Layer on diesel-indexed dynamic pricing and weather-aware liability logging, both of which existing PH rental tools (Hastings, Monark) do not do; their "quick quote" is a contact form emailed back hours later. PH infrastructure demand is rising under the government build program, pulling more MSMEs into a market where manual back offices cannot scale.

---

## 2. Who It's For

**Primary user (named, specific):** Rhea, the sole back-office administrator at Almara Construction (Quezon City). They hand-calculate every quotation (distance km, diesel, maintenance, operator labor, buffers), re-key every paper EDTR into Excel, chase field trackers for hours, and file physical contracts by project. (Rhea is a representative persona for the anchor-tenant admin role; ArkiLaunch serves this role across many rental-company tenants.)

**Secondary users:** the Rental Company Owner (reports, oversight); the Field Timekeeper (uploads/scans EDTRs from assigned sites only); the Customer/Contractor (browses catalog, books, pays deposit, tracks transactions); and the ArkiLaunch platform admin (tenant onboarding, subscription).

**Their moment of pain:** A monsoon floods the office; a week of paper EDTRs is water-damaged and unreadable, so the admin cannot prove billed hours against the client's 100-hour deposit and the company eats the discrepancy. On a normal day, a prospective client asks for a price and waits while the admin spends 20 to 30 minutes hand-computing diesel-indexed rates and mobilization distance, and a faster competitor wins the job.

**Success in their words:** "The field logs scan themselves into a bill I can trust, quotes go out in a minute, and a flood can't erase my records anymore."

---

## 3. Scope & Cut Line

**In scope for this build (multi-tenant SaaS; Almara = anchor tenant):**

| # | Capability | Demo-critical? |
|---|------------|----------------|
| 1 | OCR usage-based billing: scan handwritten EDTRs, extract active/idle hours + breakdown status, double-entry reconciliation before deposit deduction (PRD-F3) | YES |
| 2 | Dynamic quotation engine: diesel-indexed hourly rate + mobilization/demobilization km, printable quote (PRD-F1) | YES |
| 3 | Multi-tenant access, identity, RBAC + row-level tenant isolation; rental-company onboarding (PRD-F7) | YES |
| 4 | Fleet inventory, maintenance timers, utilization + financial reporting (PRD-F4) | YES |
| 5 | Weather-aware module: Open-Meteo poll per site, risk advisories, auto liability incident logs (PRD-F5) | YES |
| 6 | OCR-assisted KYC: extract SEC number + TIN, human-in-the-loop portal verification (PRD-F6) | YES |
| 7 | Client booking portal: browse catalog, cart/book, track transactions (PRD-F8) | Partial |
| 8 | PayMongo deposit checkout (hosted; no card data stored) (PRD-F2) | Partial |

**Explicitly out of scope (v0):** machine-learning demand forecasting; physical IoT / GPS telemetry; native storage or processing of card / bank-account data (PayMongo hosted checkout only); fully automated government-portal verification (BIR ORUS CAPTCHA blocks it, so KYC stays human-in-the-loop); geographies outside Luzon for weather/logistics features.

**If we only ship one thing:** OCR usage-based billing with double-entry reconciliation (PRD-F3). It is the direct fix for the core wound (revenue leakage from paper EDTRs) and the capability no competitor offers.

---

## 4. Success & Judging Criteria

**How we win (metrics or rubric):** Validated against the ISO/IEC 25010 software product quality model via User Acceptance Testing (UAT), plus hard system targets.

| Criterion (from rubric / brief) | How we hit it |
|---------------------------------|---------------|
| ISO/IEC 25010, 8 sub-characteristics, mean rating >= 3.41 ("Agree") | UAT with 3 to 5 IT experts + 15 to 30 end users (Almara admins, trackers, clients), 5-point Likert |
| OCR extraction accuracy >= 90.06% on structured EDTR/KYC fields | Azure AI Document Intelligence labeled extraction (bounded field regions = zonal), per-field confidence gate, human review below threshold |
| 0% discrepancy at billing | Double-entry reconciliation (two independent logs within tolerance) gates every deposit deduction |
| 99.5% uptime on core modules | Managed hosting, health checks, graceful external-API fallback (Open-Meteo cache) |

**Demo script (30 to 90 seconds):** Log in as Almara admin; upload a photo of a handwritten EDTR; watch OCR extract hours and reconcile against the tracker's log; approve; see the deposit auto-deduct into an invoice. Then generate a live diesel-indexed quote for a new booking in under a minute, and open the weather-aware dashboard showing a red-flag advisory that auto-logged a liability incident for a flooded site.

---

## 5. Concept Visuals

*Lo-fi references are not yet generated (image-generation tooling is not available in this build session). Visual direction is captured here; frames land in `docs/assets/concept/` and are pulled into DSD §0.5 once produced.*

**Visual direction (one sentence):** Field-rugged, high-contrast, data-dense "control room for the yard": trustworthy and legible on a cheap Android over a 3 to 5 Mbps connection, not default SaaS purple; Filipino-MSME-relatable, not enterprise-cold.

**Tooling used:** none yet (planned: taste-skill `imagegen-frontend-web` / `imagegen-frontend-mobile` + `/impeccable shape`).

| Screen / section | Asset path | Notes |
|------------------|------------|-------|
| Admin dashboard (fleet + weather) | `docs/assets/concept/` (to be generated) | not yet generated |
| EDTR scan + reconciliation review | `docs/assets/concept/` (to be generated) | not yet generated |
| Client booking + quote | `docs/assets/concept/` (to be generated) | not yet generated |

**Team decision:** Pending concept-frame generation. Direction above is the brief for it.

---

## 6. Open Questions

| Question | Owner | Resolve by |
|----------|-------|------------|
| Diesel-price data source (DOE price watch scrape vs admin input vs third-party feed) | Eng | RFC-3 (quotation-pricing-engine) |
| Multi-tenancy DB isolation pattern under Supabase pooler (Prisma set_config vs Drizzle RLS) | Eng | RFC-1 (tenancy-rls-auth) + SDD §3 |
| Likert scale for UAT: thesis is inconsistent (4-point once vs 5-point elsewhere); build standardizes on 5-point | QA | QAD (resolved: 5-point) |
| Azure DI region / data residency for PH corporate + ID images | Eng / Compliance | AIA §5 + CLR |

---

## Self-Check

- [x] Production intent stated in §1 (real multi-tenant product, not throwaway demo)
- [x] One-line pitch is specific; a stranger can repeat it (not generic SaaS filler)
- [x] Problem and insight are filled (not TBD / placeholder)
- [x] Primary user is named and specific (anchor-tenant admin role, persona Rhea)
- [x] Pain moment is a concrete scene (flooded EDTRs; client waiting on hand-calculated quote)
- [x] Cut line is explicit; "If we only ship one thing" is named (PRD-F3)
- [x] Judging criteria mapped to how we hit them (ISO/IEC 25010 + hard targets)
- [ ] Concept visuals linked (deferred: image tooling unavailable this session; direction captured)
- [x] Lock bar satisfied (all six load-bearing fields real)
- [x] AGENTS hard bans applied (no em-dashes); VOICE polish pass before final lock
- [x] Next suggested doc: SCRUTINY gate (build), then VALIDATION / BRD / PRD
