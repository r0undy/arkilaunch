# Business Requirements Document (BRD)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with reality)
**Event / context:** FMD engine v1.28.1; Scale Full. B2B SaaS for PH heavy-equipment rental MSMEs; Almara Construction Corporation (Quezon City) is the pilot / anchor tenant.

---

> **Note:** This BRD is a qualitative research gate. It justifies why ArkiLaunch is worth building and maps the business model. It carries no unit economics. CAC, LTV, payback, burn, runway, margins, pricing tiers, and capital doctrine enforcement live only in the UES (`ues-arkilaunch.md`), which is the next document, followed by the PRD (`prd-arkilaunch.md`). Cross-links to the source idea brief: [idea-arkilaunch.md](idea-arkilaunch.md). Verified claims and carried gaps: [scrutiny-arkilaunch.md](scrutiny-arkilaunch.md).

---

## 1. Executive Summary

ArkiLaunch is a multi-tenant B2B SaaS that runs the back office for Philippine heavy-equipment rental MSMEs. Small rental firms lose money because their operations run on paper: field time-sheets get mis-billed and unbilled, price quotes take 20 to 30 minutes by hand, and file-cabinet archives are destroyed by floods. ArkiLaunch scans the handwritten field logs into a bill the admin can trust, prices rentals in under a minute from live diesel and travel distance, and keeps a flood-proof digital record with weather-linked liability evidence. Almara Construction Corporation, a Quezon City rental firm where one administrator carries the entire back office by hand, is the pilot and anchor tenant. The business sells this as a subscription to each rental company, priced by fleet size and seats. The Philippine construction equipment rental market was USD 175.9M in 2023 and is forecast to reach USD 236.5M by 2029 at a 5.06% CAGR ([Arizton](https://www.arizton.com/market-reports/philippines-construction-equipment-rental-market)), pulled by government infrastructure and flood-mitigation projects that put more equipment into a market where manual back offices cannot scale.

*What this is and why it matters: paper-based PH rental firms are bleeding billable hours and losing records to floods; ArkiLaunch stops the leak and sells that fix as recurring software.*

---

## 2. The Problem & Opportunity

**The Problem:**
Small Philippine construction-equipment rental companies run on three manual artifacts that leak money. First, paper Equipment Daily Time Reports (EDTRs): field trackers record active and idle hours by hand, the admin re-keys them into Excel, and mis-keyed or missing entries produce mis-billed and unbilled equipment-hours against a client's prepaid deposit. Second, hand-calculated quotations: a prospective client asks for a price and waits 20 to 30 minutes while the admin computes diesel-indexed hourly rates, mobilization and demobilization distance, maintenance, operator labor, and buffers over phone or Messenger. A faster-quoting competitor wins the job. Third, file-cabinet archives: a single monsoon flood can water-damage a week of paper EDTRs, leaving the firm unable to prove billed hours against a client's 100-hour deposit, so it eats the discrepancy. At Almara Construction, one administrator carries all of this by hand, which is the ceiling on how much business the firm can take.

*The pain is quantifiable at the anchor: 20 to 30 minutes per manual quote, an unmeasured but real volume of unbilled equipment-hours per billing cycle, and total data loss exposure to a single flood event. The exact leakage figure is a pilot-measurement TBD (see BRD-M8).*

**The Opportunity:**
The winning move is to back-end the paper rather than force a born-digital field workflow: OCR the existing handwritten EDTRs and reconcile them against a second independent log (double-entry) before any deposit deduction. That is a fix no incumbent PH rental tool offers. Existing sites (Hastings, Monark) provide only a contact-form "quick quote" emailed back hours later; none does OCR of paper, diesel-indexed dynamic pricing, or weather-aware liability logging. Timing is right because Philippine infrastructure demand is rising under the government build program and flood-mitigation projects, which pulls more MSMEs into a market where manual back offices break. The tooling to do this well is now commodity and affordable: managed OCR (Azure AI Document Intelligence handles handwriting), hosted payments that keep card data off the platform (PayMongo), and free-to-cheap weather APIs (Open-Meteo).

*What becomes possible: a one-person back office scales, quotes go out in a minute, billing becomes an evidence trail instead of a dispute, and records survive a flood. Why now: infrastructure-driven demand plus commodity OCR/payments/weather tooling.*

**Target Customer / User:**
The paying customer is the Philippine heavy-equipment rental MSME (the tenant), with Almara Construction (Quezon City) as the anchor. The buyer and daily champion is the back-office administrator (persona Rhea at Almara) who owns quoting, EDTR re-keying, and filing. The economic sponsor is the rental company owner who wants reports and oversight. Secondary users served through the tenant are the field timekeeper (uploads and scans EDTRs from assigned sites) and the client/contractor (browses the catalog, books, pays a deposit, tracks transactions). The platform admin (the ArkiLaunch team) onboards tenants and manages subscriptions.

*Who has this problem badly enough to pay: rental firms whose growth is capped by a manual back office and whose margin is leaking through paper. This seeds the BMC Customer Segments and the UES cohorts.*

---

## 3. Business Model

ArkiLaunch is a B2B SaaS subscription sold per rental-company tenant. Value is created by removing the manual back office: OCR usage-based billing (PRD-F3) converts paper EDTRs into trusted invoices, the dynamic quotation engine (PRD-F1) prices rentals in a minute, and the fleet, weather, KYC, booking, and payment modules round out the operating system. Value is delivered as a multi-tenant web application with row-level tenant isolation (PRD-F7), so each rental firm gets an isolated workspace without running its own software. Value is captured as a recurring subscription per tenant, tiered by fleet size and seats, so a firm pays more as it grows the fleet and the number of people using the system. Almara anchors the model as the first production tenant and design partner; the same product then serves additional PH rental MSMEs with the same capabilities. Client deposit payments flow through PayMongo hosted checkout (PRD-F2); that money moves between the contractor and the tenant, and ArkiLaunch stores no card data, so it is not a platform revenue line. Pricing amounts, tier boundaries, and all unit economics are deferred to [UES §0 Business Model Fit](ues-arkilaunch.md).

**Unit (named):** One paying rental-company tenant per month.

**Capture mechanism:** Recurring SaaS subscription per tenant, tiered by fleet size and seats. Amounts and tier structure live in the UES, not here.

---

## 4. Business Model Canvas

Osterwalder nine blocks ([Strategyzer](https://www.strategyzer.com/library/what-is-a-business-model)). Qualitative map only. Revenue Streams, Cost Structure, and Customer Segments feed the UES; this canvas does not replace LTV/CAC.

| Block | Content |
|-------|---------|
| **Customer Segments** | Primary paying segment: Philippine heavy-equipment rental MSMEs (the tenant), anchored by Almara Construction (Quezon City). Within each tenant, the users are the back-office admin (champion buyer), the owner (sponsor, reports), and the field timekeeper. End customers/contractors book and pay through a tenant's portal but are not the paying customer of ArkiLaunch. |
| **Value Propositions** | Stop revenue leakage: OCR usage-based billing with double-entry reconciliation before any deposit deduction (PRD-F3, the core differentiator). Quote in under a minute with diesel-indexed dynamic pricing and mobilization/demobilization km (PRD-F1) instead of 20 to 30 minutes by hand. Flood-proof digital records replacing water-vulnerable file cabinets. Weather-aware liability evidence (PRD-F5). A back office that scales without hiring. None of this is offered by incumbent contact-form "quick quote" tools. |
| **Channels** | Direct pilot and reference-led sales starting with Almara; word of mouth inside PH construction and rental networks; capstone and industry demos; the client booking portal (PRD-F8) as a distribution surface that puts a tenant's catalog online; later, self-serve tenant onboarding (PRD-F6 OCR-assisted KYC). |
| **Customer Relationships** | High-touch onboarding for the anchor and early tenants (paper-to-digital migration, human-in-the-loop KYC verification); ongoing support; self-serve SaaS dashboard for day-to-day use; trust built and kept through the reconciliation evidence trail that neutralizes billing disputes. |
| **Revenue Streams** | Recurring subscription per tenant, tiered by fleet size and seats (PRD-F7 gates seats and roles). Feeds UES-E1. Deposit payments via PayMongo are pass-through client money, not platform revenue. Amounts deferred to the UES. |
| **Key Resources** | The OCR-plus-reconciliation pipeline (Azure AI Document Intelligence custom models tuned on EDTR/KYC fields); the diesel-indexed pricing engine; the multi-tenant platform with row-level isolation; the weather integration; the engineering team; and Almara's domain knowledge as the anchor design partner. |
| **Key Activities** | OCR model training and confidence tuning; double-entry reconciliation logic; tenant onboarding and paper-data migration; human-in-the-loop KYC verification; maintaining external integrations (Azure DI, PayMongo, Open-Meteo, diesel-price source); and PH data-privacy compliance (RA 10173 / RA 10175). |
| **Key Partners** | Microsoft Azure AI Document Intelligence (OCR); PayMongo (hosted payments, BSP-regulated, PCI-DSS L1); Open-Meteo (weather; commercial licensing is a carried gap, see G-4); managed hosting / persistent compute for cron and OCR workers; Almara Construction as anchor design partner. |
| **Cost Structure** | Per-page OCR API cost (scales with EDTR/KYC volume); Open-Meteo commercial plan; hosting and compute for a persistent backend running the scheduler and async OCR workers; payment processing (pass-through); engineering and support. Feeds UES-E2 and UES-F#. Amounts deferred to the UES. |

*Before lock: Segments, Value Propositions, Revenue Streams, and Cost Structure are filled (not TBD).*

**UES handoff:** Segments → UES cohorts / UES-D8; Revenue Streams → UES-E1; Cost Structure → UES-E2 and UES-F#.

---

## 5. Impact Variables (Pareto / Power Law)

Most of the outcome rides on a few levers. ArkiLaunch is a trust product sold on billing integrity, so the drivers cluster around whether the core OCR-plus-reconciliation loop is trusted, whether the anchor stays and expands, and whether acquiring the next tenant is repeatable rather than bespoke. Research and build effort concentrate on the top of this list, not the long tail (weather-feature polish, booking-portal breadth, catalog UX).

**Candidates considered:** OCR extraction accuracy and reconciliation trust, anchor-tenant retention and expansion, tenant acquisition efficiency (segment/channel fit), quotation speed, weather-feature adoption, tenant churn, seat expansion within a tenant, price point.

| ID | Impact variable | Why it dominates | Falsifier (what evidence kills this) | Rank |
|----|-----------------|------------------|--------------------------------------|------|
| BRD-V1 | OCR extraction accuracy and double-entry reconciliation trust (billing integrity, PRD-F3) | This is the core differentiator and the reason a firm pays. If admins do not trust the extracted hours and the reconciliation gate, they revert to re-keying by hand and the entire value proposition and retention collapse. Everything else is secondary to a bill the admin trusts. | Pilot admins keep re-keying EDTRs by hand or routinely override the reconciliation gate because they distrust it; or per-field accuracy sits below the confidence-gate threshold so the human-review queue is larger than the manual work it was meant to save. | 1 |
| BRD-V2 | Anchor-tenant (Almara) retention and expansion | Almara is the first production reference. Sustained production use, retention, and expansion across modules and seats prove the model and become the sales proof for every next tenant. Lose the anchor and you lose both the reference and the design partner. | Almara stops using the system in production, reverts to Excel/paper, or does not expand beyond the initial module within the pilot window. | 2 |
| BRD-V3 | Tenant acquisition efficiency (segment and channel fit for the next rental firms) | Multi-tenant SaaS only works if onboarding tenant #2 through #N is repeatable and mostly self-similar. This variable decides whether the model generalizes past a single bespoke deployment. Qualitative here; the economics (CAC efficiency) are quantified only in the UES. | Every new tenant needs heavy custom work (bespoke OCR templates, hand-built pricing logic) so onboarding never standardizes; or no channel produces qualified rental-firm leads at all. | 3 |

*Stable IDs (`BRD-V#`), never renumbered. UES asset allocation and cohort actions concentrate on these variables.*

**Concentration rule:** For the first 90 days after anchor go-live, all discretionary build and experiment effort goes to BRD-V1 (OCR/reconciliation trust) and BRD-V2 (anchor retention). Do not chase BRD-V3 multi-tenant acquisition until the anchor proves trusted billing in production. Proving the loop once beats spreading it thin across firms that will not renew.

---

## 6. Capital Philosophy Gate

Venture operating rules for research, not investment advice. Each row is a research question. Quantification and pass/fail enforcement live in the UES Capital Doctrine Register (`UES-D1` through `UES-D8`).

| # | Principle | Research question (one-line answer) | Status | UES link |
|---|-----------|-------------------------------------|--------|----------|
| 1 | DO NOT LOSE MONEY | Will we hold acquisition and paid-channel spend until the anchor proves trusted billing and the model stays default-alive? | TBD | UES-D1 |
| 2 | ASSET ALLOCATION | Does scarce build/experiment capital go first to BRD-V1 and BRD-V2 (OCR trust and anchor retention) before BRD-V3? | TBD | UES-D2 |
| 3 | Asymmetrical RISK-REWARD | Does each integration and tenant bet cap downside (HITL gates, hosted checkout, no card storage) while upside is open-ended if reconciliation trust generalizes across tenants? | TBD | UES-D3 |
| 4 | Small risk; huge upside; 1 in 5 out | Is each feature/experiment cost capped relative to expected contribution so a miss is survivable? | TBD | UES-D4 |
| 5 | Margins run the business, not capital | Will growth spend be funded from subscription contribution after the pilot proves out, with OCR and weather API COGS staying inside subscription margin? | TBD | UES-D5 |
| 6 | Operating Cashflow | Do we track cash from tenant subscriptions after variable API costs, not headline tenant count? | TBD | UES-D6 |
| 7 | Capital Gains | Is a grant or raise the exception, with recurring subscription OCF as the default path? | TBD | UES-D7 |
| 8 | User Centric, Tailored | Do we serve the PH rental-MSME back-office segment (the anchor role) first and kill adjacent-vertical distractions until the core segment is retained? | TBD | UES-D8 |

*All rows are TBD by design at BRD stage. Each matching `UES-D#` must be filled or explicitly deferred when the UES is written.*

---

## 7. Strategic Alignment

This maps to three concrete goals. First, the capstone delivery goal: a real, deployable multi-tenant SaaS validated against the ISO/IEC 25010 software product quality model via UAT, with a mean rating at or above 3.41 ("Agree") across the eight sub-characteristics, plus hard system targets (see BRD-M5). ArkiLaunch ships with auth, tenant isolation, tests, observability, and rollback, not a mock. Second, the anchor-tenant business goal: put Almara Construction into production use so the firm stops leaking billable hours to paper and can prove billed hours against client deposits, which is the direct fix for the core wound (BRD-V2, BRD-M1, BRD-M8). Third, the market-entry goal: convert the anchor reference into a repeatable multi-tenant offering aimed at the growing PH construction equipment rental market (USD 175.9M in 2023 to USD 236.5M by 2029 at 5.06% CAGR, [Arizton](https://www.arizton.com/market-reports/philippines-construction-equipment-rental-market)), where infrastructure and flood-mitigation demand is pulling more MSMEs past the limit of a manual back office (BRD-V3, BRD-M7).

*Tied to specific goals: ISO/IEC 25010 UAT pass, Almara in production with recovered billing, and a repeatable path to the next tenants in a verified, growing market. Not "improves user experience."*

---

## 8. Scope

**In Scope:**
- Multi-tenant B2B SaaS for PH heavy-equipment rental MSMEs, with Almara Construction as the anchor / pilot tenant in production.
- OCR usage-based billing with double-entry reconciliation before deposit deduction (PRD-F3), the core differentiator and the one thing shipped if only one ships.
- Dynamic quotation engine: diesel-indexed hourly rate plus mobilization/demobilization km, printable quote (PRD-F1).
- Multi-tenant access, identity, and RBAC with row-level tenant isolation and rental-company onboarding (PRD-F7).
- Fleet inventory, maintenance timers, utilization and financial reporting (PRD-F4).
- Weather-aware module: Open-Meteo poll per site, risk advisories, automatic liability incident logs (PRD-F5).
- OCR-assisted KYC and registration: SEC/TIN extraction with human-in-the-loop verification (PRD-F6).
- Client booking portal (PRD-F8) and PayMongo hosted deposit checkout (PRD-F2).
- B2B SaaS subscription per tenant, tiered by fleet size and seats (qualitative in this BRD).

**Out of Scope:**
- Machine-learning demand forecasting.
- Physical IoT / GPS telemetry on equipment.
- Native storage or processing of card or bank-account data (PayMongo hosted checkout only; no card data stored).
- Fully automated government-portal verification (BIR ORUS CAPTCHA blocks it, so KYC stays human-in-the-loop; verified in scrutiny FC-11).
- Geographies outside Luzon for the weather and logistics features (v0).
- All unit economics: pricing amounts, tier boundaries, CAC, LTV, payback, burn, and runway. These are deferred to the UES (`ues-arkilaunch.md`), not decided in this BRD.

*Calling out what we are not doing kills scope creep early. The hardest line here is the last one: no numbers get invented in the BRD.*

---

## 9. Success Metrics

Each metric has a stable **ID** (`BRD-M#`), never renumbered. The GTM tracks these same IDs in its launch metrics, and the QAD verifies each is instrumented before launch. These are 6-to-12-month business and product outcomes. Unit economics, cash, runway, capital doctrine, and moats live in the [UES](ues-arkilaunch.md); they are not duplicated here.

| ID | Metric | Baseline | Target | Timeline |
|----|--------|----------|--------|----------|
| BRD-M1 | Anchor tenant in production use on core modules (PRD-F3, F1, F4, F7) | 0 (Almara on paper + Excel) | Almara running core modules live in production | Within 6 months (pilot go-live) |
| BRD-M2 | OCR extraction accuracy on structured EDTR/KYC fields | n/a (manual re-keying) | >= 90.06% per-field, with confidence gate and human review below threshold | At go-live, sustained through 6 months |
| BRD-M3 | Billing discrepancy at deposit deduction | Unquantified leakage under paper EDTRs | 0% discrepancy at the reconciliation gate | From go-live, sustained |
| BRD-M4 | Quotation turnaround time | 20 to 30 minutes, hand-calculated | Under 1 minute via the dynamic quotation engine | At go-live |
| BRD-M5 | ISO/IEC 25010 UAT mean rating (8 sub-characteristics, 5-point Likert, 3 to 5 IT experts + 15 to 30 end users) | n/a | >= 3.41 ("Agree") | Capstone UAT, within 6 months |
| BRD-M6 | Core module uptime | n/a | 99.5% | Measured over first 6 months post-launch |
| BRD-M7 | Additional PH rental-company tenants beyond the anchor | 0 | 1 to 3 onboarded or piloting | 6 to 12 months |
| BRD-M8 | Recovered billable equipment-hours at Almara (revenue-leakage reduction) | Unbilled/mis-billed hours under paper (exact quantum TBD, established during pilot) | Measurable reduction in unbilled equipment-hours | Within 6 months of go-live |

*Hard numbers where defensible. BRD-M2's 90.06% is a measured design target behind a confidence gate and HITL, not an external guarantee (scrutiny FC-9). BRD-M8's baseline is a pilot-measurement TBD: the leakage quantum is real but not yet counted.*

---

## 10. Stakeholders & Owners

| Role | Person | Responsibility |
|------|--------|----------------|
| Sponsor / Decision Maker | Almara Construction Corporation (owner) + capstone panel | Final approval, funding, and anchor-tenant go/no-go |
| Business Owner | ArkiLaunch Team (Almara Construction capstone) | Accountable for the outcome: anchor adoption, market path, metric delivery |
| Product / Tech Lead | ArkiLaunch Team engineering lead | Delivering the multi-tenant build (auth, isolation, OCR pipeline, integrations, rollback) |

*The team wears all three hats. Naming them separately forces clarity on which hat is on: sponsor gate, business outcome, or delivery.*

---

## Self-Check

- [x] Section 1 can be read by a non-technical person and makes immediate sense
- [x] Section 2 quantifies the problem (20 to 30 min quotes, flood data loss, unbilled hours; exact leakage a pilot TBD)
- [x] Section 3 names the unit (one paying tenant per month) and capture mechanism (tiered subscription)
- [x] Section 4 BMC has Segments, Value Propositions, Revenue Streams, and Cost Structure filled (not TBD)
- [x] Section 5 has `BRD-V1`, `BRD-V2`, `BRD-V3`, each with a falsifier
- [x] Section 6 Capital Philosophy Gate is filled as research questions, all TBD with explicit `UES-D#` follow-up
- [x] Section 9 has metrics with numbers and timelines
- [x] Section 8 explicitly names things out of scope (ML forecasting, IoT/GPS, card storage, automated gov verification, non-Luzon weather, and all unit economics)
- [x] Nothing in this document describes *how* to build the solution (that is the SDD's job)
- [x] Nothing in this document duplicates the UES spreadsheet (numbers deferred to `UES-E#` / `UES-D#`)
- [x] No CAC / LTV / LTV:CAC / payback / burn / runway tables appear in this BRD (hard split honored)
- [x] AGENTS hard bans applied (no em-dashes); cross-linked to `idea-arkilaunch.md`; next doc is UES, then PRD
