# Go-To-Market (GTM) Strategy

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with code)
**PRD:** [prd-arkilaunch.md](prd-arkilaunch.md)
**UES:** [ues-arkilaunch.md](ues-arkilaunch.md)

---

> Launch motion for a PH B2B SaaS with a services-heavy, referral-driven buyer. Pricing traces to the UES. Public launch is gated on the CLR and AIA clearing.

---

## 1. Product Summary (GTM View)

**What it does (one sentence):** ArkiLaunch turns a Philippine equipment-rental company's paper field logs, phone quotes, and file-cabinet records into a weather-aware, OCR-driven rental platform that stops revenue leakage.

**Who it's for:** Small and mid-size Philippine heavy-equipment and trucking rental companies whose back office still runs on handwritten Equipment Daily Time Reports (EDTRs), hand-calculated quotes, and physical folders.

**Core value proposition:** Stop leaking billable hours. Scan the paper you already keep, price a rental in under a minute against live diesel, and keep an audit trail a flood cannot erase.

**Category:** Vertical SaaS for construction/equipment-rental operations (PH).

---

## 2. Target Audience

**Primary ICP (Ideal Customer Profile):**
- *Who:* Owner-operators and lone administrators at PH heavy-equipment / self-loading-truck rental MSMEs (roughly 5 to 60 units), Luzon-first, who feel the pain of manual billing and slow quotes. Almara Construction (Quezon City) is the archetype and anchor tenant.
- *Where they hang out:* Facebook (where they already advertise and take inquiries), industry and contractor associations, equipment-dealer networks, and word-of-mouth referral chains between rental firms and contractors.
- *What they already believe:* Paper works but it loses money; a "system" sounds expensive and hard, and their field crews will not switch to a high-tech app.
- *What will make them try this:* Seeing that ArkiLaunch scans their existing handwritten EDTRs (no workflow change for the field), and a peer firm (Almara) vouching for recovered billable hours.

**Secondary audience:**
- *Who:* Larger rental firms and equipment dealers with multiple yards.
- *Why secondary:* Longer sales cycle and more integration demands (multi-yard, ERP tie-ins) than the V1 pooled multi-tenant model targets. Land the MSME segment first (UES-D8: stay user-centric on the primary segment).

---

## 3. Pricing Model

**Model:** `Paid` (monthly/annual SaaS subscription per rental-company tenant; usage add-on for high OCR volume).

| Tier | Price | What's Included | Limit / Gate |
|------|-------|-----------------|-------------|
| Starter | PHP 4,500/mo (illustrative) | Quotation engine, OCR billing + reconciliation, fleet + basic reports, 1 admin + 2 field seats | Up to ~15 units; OCR page cap; email support |
| Growth | PHP 9,000/mo (illustrative; UES-E1) | Everything in Starter + weather module, KYC onboarding, full reporting, PayMongo deposits, more seats | Up to ~40 units; higher OCR cap |
| Scale | Custom | Multi-yard, priority support, higher OCR/API limits | Negotiated |

**Pricing rationale:** The Growth tier is the anchor (Almara's tier) and the UES reference unit: illustrative ARPU PHP 9,000/mo against roughly PHP 1,650 cash COGS gives about 82% gross margin (UES-E1..E3), so the tier covers variable cost and CAC payback (about 3.4 months illustratively). Starter lowers the entry barrier for the smallest firms without going below variable cost. This honors Capital Doctrine UES-D1 (do not lose money) and UES-D5 (margins fund growth): no tier is priced below its Azure DI + Open-Meteo + hosting variable cost. Final amounts are validated during the anchor pilot (BRD-M8 recovered-leakage anchors willingness to pay).

*Trace: tier prices map to `UES-E1` (revenue per unit) and `UES-E3` (contribution) in the [UES](ues-arkilaunch.md). Pricing that cannot cover variable cost and CAC payback is a launch blocker; the illustrative numbers clear that bar and are confirmed in the pilot.*

**Payment processor:** PayMongo (subscription billing for tenants; also the hosted-checkout rail for the tenants' own client deposits, PRD-F2).

---

## 4. Positioning & Messaging

**Tagline:** `Scan the paper. Keep the money.`

**Primary message (for landing page hero):** ArkiLaunch reads your handwritten field logs, prices every rental against today's diesel in under a minute, and flags weather risk before it becomes a liability, so your one-person back office stops leaking revenue and your records survive the next flood.

**Proof points:**
- OCR reads the EDTRs your crew already fills out by hand; no field-workflow change (adoption bridge, UES-M1).
- Double-entry reconciliation means the hours you bill match two independent logs before a peso is deducted (UES-M2 trust moat).
- Live diesel-indexed quotes in under a minute, versus 20 to 30 minutes by hand.

**Objection handling:**

| Objection | Response |
|-----------|----------|
| "A system is too expensive for a firm our size." | Starter tier is priced under one recovered mis-billing a month; the pilot measures recovered hours before you commit annually. |
| "My field crew will never use an app." | They do not have to. They keep filling out paper; ArkiLaunch scans it. The app is for the office. |
| "Our data is sensitive; is this safe?" | Per-tenant isolation, encrypted storage, PH Data Privacy Act alignment (CLR), and deposits run through PayMongo hosted checkout so we never store card data. |

---

## 5. Launch Channels & Tactics

**Owned channels:**

| Channel | Audience Size | Planned Action |
|---------|--------------|----------------|
| Anchor-tenant case study (Almara) | 1 reference customer | Publish recovered-hours + quote-time results as the primary proof asset |
| Facebook business page + direct message outreach | build from zero | Short demo video (scan EDTR -> reconciled bill); DM outreach to rental firms already advertising there |

**Community / earned channels:**

| Channel | Tactic | Timing |
|---------|--------|--------|
| Contractor / equipment-rental associations | Present the Almara case study at a chapter meeting or group | Beta phase |
| Referral chain (rental firm -> contractor -> rental firm) | Referral incentive for a tenant who introduces another rental firm (UES-V3 acquisition efficiency) | Post-launch |
| Equipment dealers | Partner page / co-marketing (dealers see many rental buyers) | Post-launch |

**Content assets needed before launch:**

- [ ] Demo video (60 to 90 sec): scan a handwritten EDTR, watch it reconcile, see the deposit deduct.
- [ ] Landing page with the Almara results and a clear "book a pilot" CTA.
- [ ] One-page case study (anchor tenant: recovered hours, quote-time drop).
- [ ] Standalone onboarding guide for a new tenant admin.

---

## 6. Launch Phases

| Phase | Criteria to Enter | Target Date | Goal |
|-------|------------------|-------------|------|
| **Alpha** (anchor only) | Core F3+F1+F7 slice complete; QAD Must-Have sign-off | TBD | Almara live on OCR billing + quotation; measure recovered hours (BRD-M8) |
| **Beta** (invite, 3 to 5 firms) | Alpha stable; no P0; OCR accuracy SLO met | TBD | 1 to 3 additional tenants (BRD-M7); validate retention + real CAC (UES-E5) |
| **Public Launch** | Beta retention target hit; pricing live; **CLR cleared (no open counsel flags, `clr-arkilaunch.md`)**; **AIA escalations cleared (`aia-arkilaunch.md` §4: Azure DI residency + KYC counsel review)** | TBD | Steady tenant adds within CAC-payback discipline (UES-D1/D5) |
| **Post-launch** | Public launch stable | TBD | First cohort of firms defaulting to daily deductions; expansion within tenants |

---

## 7. Success Metrics (30-day post-launch)

| BRD-M# | Metric | Target | How to Measure (event / source) |
|--------|--------|--------|----------------------------------|
| BRD-M7 | New paying tenants beyond anchor | 1 to 3 in first 30 days | `tenant_onboarded` count (PRD §5.6) |
| BRD-M8 | Recovered billable hours at a tenant | measurable positive delta vs paper baseline | `billable_hours_reconciled` vs pre-pilot baseline |
| BRD-M4 | Quote turnaround | under 1 min median | `quote_generated.latency_ms` (PRD §5.6) |
| BRD-M1 | Tenant active on core modules | anchor + beta tenants live | `tenant_module_active` |

*Metrics trace to the BRD business case and the PRD §5.6 event taxonomy; targets do not contradict the UES unit economics (adds are paced to CAC payback, not vanity signups).*

---

## 8. Answer Surfaces (AI Visibility)

**Stance (one line):** A niche PH B2B buyer does not search via AI heavily yet, so foundations first: a clear entity, an accurate product page, and a citation-grade case study, not keyword packing.

### Target prompts

| Prompt (how someone asks an AI) | Surface | Desired citation / mention | Owner asset URL |
|---------------------------------|---------|----------------------------|-----------------|
| "equipment rental management software Philippines" | Google AI Overviews / ChatGPT | ArkiLaunch named with its one-liner | product landing page (TBD) |
| "how to digitize heavy equipment rental billing" | ChatGPT / Perplexity | ArkiLaunch cited via the case-study/how-it-works page | how-it-works page (TBD) |
| "OCR for equipment daily time records" | Perplexity / Claude | ArkiLaunch cited as the OCR-of-paper approach | case study (TBD) |

### Citation-grade assets checklist

- [ ] Anchor-tenant case study with method and measured results (recovered hours, quote-time).
- [ ] Question -> short answer -> detail pages for the top three prompts.
- [ ] A "how the OCR + reconciliation works" explainer.

### Entity consistency

| Field | Canonical value |
|-------|-----------------|
| Product / brand name | ArkiLaunch |
| One-liner | The operating system for Philippine heavy-equipment rental MSMEs: scan the paper, keep the money. |
| sameAs profiles (list) | Facebook page, LinkedIn, product domain (TBD at launch) |

### Third-party consensus

**Coverage plan:** Real customer results and earned association / dealer mentions. No fake-mention spam or purchased citation farms; what gets cited must match real, useful content.

### Metrics

| Metric | Cadence / target | Notes |
|--------|------------------|-------|
| Prompt pack review | Quarterly | Re-run the three target prompts |
| Citation / mention rate | Track from launch | Against the target-prompts table |
| Classic conversion | Primary | Pilot bookings and tenant adds from §7 still win |

**Cross-links:** technical crawler policy -> [BUILD §5.2](build-arkilaunch.md); training vs search crawl decision -> [CLR](clr-arkilaunch.md).

---

## Self-Check

- [x] §2 ICP is specific (PH rental MSME owner/admin; Almara archetype); real firms fit it
- [x] §3 pricing has a clear gate (tiers by units/seats/OCR volume) and traces to UES-E1/E3; no tier below variable cost
- [x] §5 content assets are named and pre-launch
- [x] §6 phases have binary criteria; public launch gated on CLR + AIA clearing
- [x] §7 metrics trace to BRD-M# and PRD §5.6 events; measurable
- [x] §8 filled (stance, prompts, citation assets, entity row, third-party plan, metrics); BUILD §5.2 linked
- [x] Drafted before launch, not a retrospective
- [x] AGENTS hard bans applied (no em-dashes)
