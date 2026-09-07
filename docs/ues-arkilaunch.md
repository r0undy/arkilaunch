# Unit Economics Sheet (UES)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with reality)
**IDEA:** [idea-arkilaunch.md](idea-arkilaunch.md)
**BRD:** [brd-arkilaunch.md](brd-arkilaunch.md)
**Event / context:** FMD engine v1.28.1; Scale Full. B2B SaaS for PH heavy-equipment rental MSMEs; Almara Construction (Quezon City) is the pilot / anchor tenant.

---

> **Note:** This UES holds the numbers the [BRD](brd-arkilaunch.md) deferred. It is the sheet the BRD's §3 Business Model, §4 BMC Cost/Revenue, §5 impact variables (`BRD-V1..V3`), and §6 Capital Philosophy Gate all point to. Pricing set here (`UES-E1`) and contribution (`UES-E3`) feed the GTM later; do not re-decide them there. This document is also the resolution of [scrutiny G-8](scrutiny-arkilaunch.md) (unit economics for a SaaS: pricing tiers, CAC, LTV, subscription model).
>
> **Every money figure in this document is an ILLUSTRATIVE planning assumption.** ArkiLaunch has no live financials: it is a capstone build with an anchor tenant not yet in paid production. Figures are grounded in PH-market norms and the public pricing shape of the named vendors (Azure AI Document Intelligence, Open-Meteo, Supabase, PayMongo), not in booked revenue or measured cost. Anything that needs pilot data to be real (recovered leakage, actual CAC, actual churn, actual OCR page volume) is marked **TBD** with the measure named. No invented figure is presented as an established fact.
>
> **Currency convention:** amounts are stated in PHP with a USD reference at **USD 1 ≈ PHP 58** (illustrative 2026 rate; the real rate floats and is a TBD for any locked pricing).

---

## 0. Business Model Fit

**The unit:** One paying rental-company tenant subscription per month. A tenant is a single PH heavy-equipment rental MSME with an isolated, row-level-separated workspace (PRD-F7). Almara Construction is the anchor (tenant #1). The subscription is tiered by fleet size and seats, so a firm pays more as it grows units and users.

**Who pays:** The rental company (the tenant), not the contractor who books equipment through it. The buyer and daily champion is the back-office administrator (persona Rhea at Almara); the economic sponsor is the rental-company owner. Contractor deposit payments flow through PayMongo hosted checkout (PRD-F2); that is pass-through client money between contractor and tenant, never an ArkiLaunch revenue line.

**Margin thesis (one line):** Each tenant's subscription clears its API-and-infra COGS with roughly 80% gross margin, so a small cohort of paying tenants funds fixed overhead and later growth from contribution, not from raised capital; every new tenant must pay back its acquisition cost inside 6 months.

*A business model fits when one unit, sold repeatedly, covers its variable cost, pays back acquisition, and leaves enough contribution to fund fixed overhead before cash runs out. ArkiLaunch fits on paper: a high-gross-margin recurring subscription against low, mostly step-fixed COGS. The unproven part is not the margin, it is whether the anchor proves trusted billing (`BRD-V1`) so tenants #2..#N are repeatable (`BRD-V3`).*

**BRD BMC handoff (from [BRD §4](brd-arkilaunch.md)):**

| BMC block | Feeds | Value |
|-----------|-------|-------|
| Customer Segments | Cohorts / UES-D8 | PH heavy-equipment rental MSMEs (the tenant), anchored by Almara. Primary in-tenant user: the back-office admin. Contractors are end users of a tenant's portal, not ArkiLaunch's paying customer. |
| Revenue Streams | UES-E1 | Recurring subscription per tenant, tiered by fleet size and seats. Illustrative tiers set below in §1. PayMongo deposits excluded (pass-through). |
| Cost Structure | UES-E2, UES-F# | Per-page Azure DI OCR (EDTR + KYC); Open-Meteo commercial plan; Supabase Postgres/Storage plus a persistent backend host for cron and async OCR workers; email/SMS OTP; per-tenant support. PayMongo fees are pass-through. |
| Impact variables (`BRD-V#`) | Asset allocation / experiments | BRD-V1 OCR/reconciliation billing-trust (rank 1); BRD-V2 anchor retention/expansion (rank 2); BRD-V3 tenant acquisition efficiency (rank 3). Capital concentrates on V1 and V2 first. |

---

## 0.5 Capital Doctrine Register

Stable IDs (`UES-D1`..`UES-D8`), never renumbered. Maps the eight capital principles to enforceable operating rules. [BRD §6](brd-arkilaunch.md) asks the research questions; this register holds the rules and evidence. All eight BRD rows were TBD by design; each is resolved or explicitly deferred here.

| ID | Principle | Operational rule | Evidence / metric link | Status |
|----|-----------|------------------|------------------------|--------|
| UES-D1 | DO NOT LOSE MONEY | No paid-acquisition or headcount spend until the anchor proves trusted billing (`BRD-V1`) and the venture stays default-alive. Red UES-E7, or payback longer than runway, stops scaling that channel. At the sweat-equity cost base, 1 to 2 paying tenants cover cash overhead, so the pilot is default-alive by construction. | UES-E7, UES-E8, §2 runway | Pass (rule enforced by design) |
| UES-D2 | ASSET ALLOCATION | Build/attention buckets (ops / anchor / experiments) sum to 100%. Experiments capped. Bets ranked by `BRD-V#`: V1 and V2 before V3, mirroring the BRD 90-day concentration rule. | Allocation table below | Pass |
| UES-D3 | Asymmetrical RISK-REWARD | Each integration and tenant bet caps downside (HITL gates, hosted checkout with no card storage, cancellable flat plans) while upside is open-ended if reconciliation trust generalizes across tenants. Kill any bet whose downside is not capped. | Bet register below | Pass |
| UES-D4 | Small risk; huge upside; 1 in 5 out | Max experiment cost <= expected annual contribution if success / 5. One new Growth-tier tenant is ~PHP 88,200/yr contribution, so a paid-acquisition test is capped near PHP 17,600 unless overridden in writing. | Experiment gate in §3 | Pass |
| UES-D5 | Margins run the business, not capital | After the anchor proves out, growth spend <= cumulative contribution margin. OCR and weather COGS stay inside subscription margin (target ~80% gross). | §3 reinvestment rule | TBD (needs first contribution actuals) |
| UES-D6 | Operating Cashflow | §2 tracks cash from subscriptions after variable API/infra costs minus fixed overhead, not headline tenant count. | §2 OCF row | TBD (needs first cash actuals) |
| UES-D7 | Capital Gains | Recurring subscription OCF is the default path. A capstone grant (for example DOST or academic) or a raise is the exception, taken only when §6 triggers fire, and kept separate from OCF health. | §6 raise triggers | Pass |
| UES-D8 | User Centric, Tailored | Serve the PH rental-MSME back-office segment (the anchor admin role) first. Cohort actions favor that segment's LTV; adjacent-vertical distractions are killed until the core segment is retained. | §5 + cohort table | Pass |

**Asset allocation (UES-D2):**

| Bucket | Attention % | Tied to (`BRD-V#` or channel) | Cap / notes |
|--------|-------------|-------------------------------|-------------|
| Ops / keep-the-lights-on | 45% | Fixed overhead UES-F1..F5; run the anchor in production | Infra, OCR-pipeline tuning, uptime (BRD-M6) |
| Anchor retention/expansion | 40% | BRD-V2 (reference-led, seeded by the anchor) | The closest thing to a proven channel; scale only once UES-E7 is green/yellow and BRD-V1 lands |
| Experiments | 15% | BRD-V3 next-tenant acquisition tests | Cap: <= PHP 17,600 cash per experiment (UES-D4 gate); no paid acquisition until BRD-V1 green |
| **Total** | **100%** | | |

**Bet register (UES-D3):**

| Bet | Max loss (illustrative) | Upside thesis | Asymmetry (upside : downside) | Kill if |
|-----|-------------------------|---------------|-------------------------------|---------|
| Onboard tenants #2..#4 via reference-led sales | ~PHP 25,000 CAC/tenant + onboarding labor | Proves the multi-tenant motion is repeatable (BRD-V3); each tenant is ~PHP 302,800 illustrative LTV | ~12:1 (recurring LTV vs one-time CAC), illustrative | Every new tenant needs bespoke OCR templates or hand-built pricing (BRD-V3 falsifier); onboarding never standardizes |
| Open-Meteo commercial plan + weather-liability module | ~PHP 2,030/mo flat plan (cancellable); **superseded to ~PHP 0 for the pilot, 2026-08-20, `cr-arkilaunch-open-meteo-free-tier.md`** | Weather-linked liability evidence (PRD-F5) differentiates on dispute defense | Modest upside, hard-capped downside | Tenants do not value the liability logs and weather adoption stays flat (a low-rank `BRD-V` by design) |

---

## 1. Unit Economics Sheet

Each row has a stable **ID** (`UES-E1`, `UES-E2`, ...), never renumbered. GTM pricing and launch metrics trace back to these IDs.

**Formulas (verified against sources before locking):**

| Metric | Formula | Source verified |
|--------|---------|-----------------|
| Contribution margin per unit | Revenue per unit minus variable cost per unit | [Stripe: Unit Economics](https://stripe.com/resources/more/unit-economics) (2026-07-25) |
| CAC | Total sales and marketing spend / new paying tenants (same period) | [Stripe: Unit Economics](https://stripe.com/resources/more/unit-economics) (2026-07-25) |
| LTV | (monthly contribution per tenant) / monthly churn (or cohort sum) | [Stripe: Unit Economics](https://stripe.com/resources/more/unit-economics) (2026-07-25) |
| LTV:CAC | LTV / CAC | Industry benchmark 2.5:1 to 4:1 healthy; below 2:1 concerning ([Eightx guide](https://eightx.co/ltv-cac), 2026-07-25) |
| CAC payback (months) | CAC / monthly contribution per tenant | Under 12 months typical; under 6 for bootstrapped ([Wildfront SaaS template](https://wildfront.co/saas-unit-economics-template), 2026-07-25) |

**Critical rule:** LTV is computed on **contribution margin**, not revenue. Revenue-based LTV overstates profitability by 50 to 70% in transactional businesses.

**Illustrative subscription tiers (UES-E1 basis):** these set the GTM's ceiling; GTM may discount but not re-price above these without a CR.

| Tier | Fleet / seats (illustrative) | Monthly (PHP) | USD ref | Annual (PHP, ~2 months free) |
|------|------------------------------|---------------|---------|------------------------------|
| Starter | up to ~10 units, 3 seats | 4,500 | ~USD 78 | 45,000 |
| Growth (modeled unit) | up to ~30 units, 8 seats | 9,000 | ~USD 155 | 90,000 |
| Fleet | 30+ units, unlimited-ish seats | 18,000 | ~USD 310 | 180,000 |

*The worked unit below uses the **Growth** tier (PHP 9,000/mo), a realistic fit for the anchor and for a typical target MSME. Almara may in practice sit at Starter/Growth; the tier is an assumption pending the pilot contract.*

| ID | Metric | Value (illustrative) | Status | Notes |
|----|--------|----------------------|--------|-------|
| UES-E1 | Revenue per unit | PHP 9,000/mo (Growth tier) | Green | Assumption; tier boundaries and price are pilot-contract TBD. A blended ARPU across a mixed Starter/Growth/Fleet cohort would differ; every downstream figure in this sheet uses the single Growth-tier value, never a blend. |
| UES-E2 | Variable cost per unit | ~PHP 1,430/mo cash COGS at steady state | Green | Azure DI OCR ~PHP 1,200; Supabase storage/compute marginal ~PHP 150; email/SMS OTP ~PHP 80. Open-Meteo is **not** counted here: it is a flat platform plan (UES-F4), booked once in fixed overhead, not a per-tenant step cost, so it is excluded from this line to avoid double-counting the same cost twice. PayMongo fees pass-through (PHP 0 net). Loaded with early high-touch support (~PHP 1,000/mo) it is ~PHP 2,430. |
| UES-E3 | Contribution margin per unit | ~PHP 7,570/mo (cash-COGS basis) | Green | UES-E1 minus UES-E2. ~PHP 6,570 on the support-loaded basis. |
| UES-E4 | Gross margin % | ~84% (cash COGS); ~73% support-loaded | Green | Healthy SaaS gross margin; the driver is OCR page volume (Azure DI), which is a per-tenant TBD |
| UES-E5 | Fully-loaded CAC | ~PHP 25,000/tenant (illustrative) | Yellow | **TBD**: measured over tenants #2..#4 onboarding. Early motion is reference-led (low cash, high founder labor); this figure likely understates true founder time. Anchor CAC is near-zero marginal (design partner). |
| UES-E6 | LTV (contribution-based) | ~PHP 302,800/tenant (illustrative) | Yellow | monthly contribution PHP 7,570 / churn 2.5%/mo (illustrative). **TBD**: churn is unproven; LTV moves directly with it |
| UES-E7 | LTV:CAC ratio | ~12:1 (illustrative) | Yellow | Far above the 2.5:1 to 4:1 target. Read as a signal, not a trophy: either CAC understates founder labor, or the venture is under-investing in acquisition. Real ratio is TBD on E5 and E6 actuals |
| UES-E8 | CAC payback (months) | ~3.3 months (illustrative) | Green | CAC PHP 25,000 / contribution PHP 7,570. Inside the bootstrapped <6-month gate even at the illustrative CAC |

**Cohort view (preferred over blended averages):**

| Cohort / Channel | CAC | LTV (contrib.) | LTV:CAC | Payback (mo) | Action |
|------------------|-----|----------------|---------|--------------|--------|
| Anchor (Almara, design partner, reference-led) | ~PHP 0 marginal (onboarding labor only) | high (retention is BRD-V2) | n/a (near-zero CAC) | ~0 | Prove BRD-V1 trusted billing in production, then use as reference |
| Reference-led (tenants #2..#4) | ~PHP 25,000 (TBD) | ~PHP 302,800 (TBD) | ~12:1 (TBD) | ~3.3 (TBD) | Prove repeatability (BRD-V3), then scale if standardized |
| Paid / cold outbound | not yet run | unknown | unknown | unknown | Hold until BRD-V1 is green; then gate at LTV:CAC >= 3 and payback <= 6 |

**Red flags (stop scaling until fixed; UES-D1):**

- LTV:CAC below 1.0 (buying loss-making tenants).
- Payback longer than available runway (liquidity trap regardless of ratio).
- Contribution margin falling as tenant count rises, for example Azure DI OCR page volume per tenant running far above the ~400 pages/mo assumption, or Open-Meteo call volume forcing a higher plan tier faster than revenue grows.

---

## 2. Cash Budget and Runway

**Initial capital:** Illustrative operating fund of ~PHP 150,000 (~USD 2,600) for vendor subscriptions and infra during the pilot. The dominant input is **sweat equity**: the capstone team's unpaid build and support time. There is no external investment assumed. A market-rate salary for that time is deliberately modeled at PHP 0 in the base case and stress-tested below.

**Fixed overhead ledger** (mostly platform-level and flat; changes little as tenants are added):

| ID | Item | Monthly cost (illustrative PHP) | Notes |
|----|------|---------------------------------|-------|
| UES-F1 | Team salary (capstone; sweat equity) | 0 (base case) | Modeled at 0; real market cost stress-tested below. This is the single biggest hidden cost |
| UES-F2 | Supabase (Postgres + Storage + Auth baseline) | ~1,450 | ~USD 25 Pro plan; flat platform baseline |
| UES-F3 | Persistent backend host (cron + async OCR workers) | ~2,320 | ~USD 40; Vercel serverless cannot run the scheduler/workers (SCRUTINY G-6), so a persistent host is required |
| UES-F4 | Open-Meteo commercial plan | **~0** (2026-08-20, `cr-arkilaunch-open-meteo-free-tier.md`: real adapter shipped against the FREE tier for the pilot; the ~2,030/mo commercial-plan figure below is superseded, not deleted -- the non-commercial-use restriction is an accepted, open exposure, and this line reverts to ~2,030 the moment that changes) | ~USD 35 flat. The free tier is non-commercial only ([SCRUTINY FC-7](scrutiny-arkilaunch.md)), so a paid plan is real. Flat today; converts to step-COGS as sites scale (see UES-E2) |
| UES-F5 | Other SaaS (domain, transactional email, monitoring, diesel-price source) | ~1,500 | Diesel source cost is a TBD (SCRUTINY G-3, RFC-3) |
| | **Total fixed overhead (base, sweat-equity)** | **~7,300** | Excludes any team salary |

**Variable spend (scales with volume):**

| Item | Monthly estimate | Driver |
|------|------------------|--------|
| Azure DI OCR (EDTR + KYC extraction) | ~PHP 1,200 per tenant | Pages scanned/mo (~400/tenant assumed; custom extraction ~USD 50 per 1,000 pages, Azure DI public pricing shape) |
| Supabase storage + compute (marginal) | ~PHP 150 per tenant | EDTR/KYC image volume and query load per tenant |
| Email / SMS OTP | ~PHP 80 per tenant | Logins and notifications per tenant |
| PayMongo processing | PHP 0 net to platform | Pass-through on contractor deposits; not platform revenue or platform COGS unless the platform ever absorbs fees |

**Cash summary (illustrative; two snapshots):**

| Metric | Anchor only (1 paying tenant) | Salaried scenario (team paid) |
|--------|-------------------------------|-------------------------------|
| Cash on hand | ~PHP 150,000 | ~PHP 150,000 |
| Monthly revenue (current) | ~PHP 9,000 (1 Growth tenant) | grows with tenant count |
| Monthly fixed overhead | ~PHP 7,300 | ~PHP 67,300 (adds ~PHP 60,000 combined team stipend) |
| Monthly variable spend | ~PHP 1,430 | ~PHP 1,430 per tenant |
| Net monthly burn (pre-margin growth) | ~+PHP 270 (comfortably breakeven) | negative until ~9 paying tenants |
| **Operating cashflow (OCF)** | ~+PHP 270/mo: ops fund themselves at 1 tenant | negative until breakeven tenant count reached |
| **Runway (months)** | effectively unbounded at the sweat-equity base (default-alive) | ~PHP 150,000 / net burn until tenants ramp |

*OCF for early ventures: cash from tenants after variable API/infra costs, minus fixed overhead. Tracked alongside burn so the story is cash from operations, not capital alone (UES-D6). Actual OCF is a TBD until the anchor is billed in production.*

**Default-alive check:** At the sweat-equity cost base (UES-F1 = 0), fixed cash overhead is only ~PHP 7,300/mo, so **1 to 2 paying tenants make the pilot default-alive.** The real test is the salaried scenario: with a ~PHP 60,000/mo combined stipend, breakeven moves to ~**9 paying tenants** (fixed PHP 67,300 / contribution PHP 7,570 = ~8.9). That tenant count, not the pilot, is the honest trigger for a raise or grant discussion (see §6).

*Runway = cash on hand / net monthly burn. Fixed overhead stays flat as tenants are added, which is how margins fund growth instead of new capital. The one line that breaks that is team salary, which is why it is called out separately.*

---

## 3. Margins Run the Business (not Capital)

**Reinvestment rule:** No paid acquisition until the anchor proves trusted billing in production (`BRD-V1`) and expansion (`BRD-V2`). This mirrors the [BRD §5 concentration rule](brd-arkilaunch.md) (first 90 days after anchor go-live go to V1 and V2, not V3). After that, all growth spend comes from cumulative contribution margin, never from the initial capital fund.

**Expense gates:**

| Gate | Rule |
|------|------|
| New hire | Contribution margin must cover the fully-loaded cost within 12 months. At ~PHP 7,570 contribution/tenant, one hire at ~PHP 40,000/mo needs ~6 net-new paying tenants attributable to that hire inside a year |
| Paid acquisition | Only channels with LTV:CAC >= 3 and payback <= 6 months, and only after BRD-V1 is green |
| Tool / vendor | Must replace manual time or cut variable cost; fixed-overhead impact noted in UES-F#. Anything that raises COGS per tenant (for example a higher Azure DI tier) must be offset in price or volume |
| Experiment (UES-D4) | Max cost <= expected annual contribution if success / 5, so ~PHP 17,600 for a one-tenant-win test; else do not run (or document the override) |
| Discretionary | "Behave like you will never earn money again": any discretionary spend over ~PHP 10,000/mo needs a 30-day ROI hypothesis tied to a `BRD-V#` |

**Growth funded by margins, not investment:** Target adding tenants only while UES-E7 stays green/yellow and payback stays under 6 months. Pause acquisition if per-tenant contribution falls (for example OCR page volume or Open-Meteo plan tier climbing faster than revenue). Do not spend ahead of contribution to hit a tenant-count vanity number.

---

## 4. Moat Register

*A great business has at least one moat. Name which you have, which you are building, and the evidence.*

| Moat type | Status | Evidence | UES-M# |
|-----------|--------|----------|--------|
| **Distribution** | Building | OCR-of-paper adoption bridge (PRD-F3): back-end the existing handwritten EDTRs instead of forcing a born-digital field workflow. This lowers the adoption barrier competitors' contact-form tools never cross, and the client booking portal (PRD-F8) puts a tenant's catalog online as a distribution surface | UES-M1 |
| **Data / Information** | Building | The double-entry reconciliation evidence trail (PRD-F3): two independent logs reconciled within tolerance before any deposit deduction, producing a neutral, timestamped record that neutralizes billing disputes. This is the trust asset the whole product is sold on (BRD-V1) and it compounds as tenant billing history accumulates | UES-M2 |
| **Regulatory** | Building | PH-compliance and KYC integration: OCR-assisted SEC/TIN extraction with human-in-the-loop verification (PRD-F6), plus RA 10173 / RA 10175 handling of sensitive KYC/ID data. The BIR ORUS CAPTCHA forces HITL (SCRUTINY FC-11), which is friction a foreign entrant cannot skip | UES-M3 |
| **Hardware** | None | No custom device; the product is deliberately software-only over cheap Android (out of scope: IoT/GPS telemetry) | UES-M4 |
| **Switching cost** | Building | Tenant data plus workflow lock-in: once a firm's fleet, billing history, quotation logic, and archived contracts live in ArkiLaunch, reverting to paper/Excel means losing the reconciliation record and re-keying everything. Switching cost rises with tenure | UES-M5 |
| **Pricing IP** | Weak / watch | Diesel-indexed dynamic pricing engine (PRD-F1): mobilization/demobilization km plus live diesel indexing. A differentiator today, but the formula is copyable; it is a feature edge, not a durable moat on its own | UES-M6 |

**Primary moat:** Data/Information (UES-M2), the reconciliation evidence trail, reinforced by switching cost (UES-M5). These two compound with tenant tenure and are the direct expression of `BRD-V1` (billing trust). They are the reason a tenant stays and the reason disputes stop.

**Moat gap (what we must build):** UES-M2 only becomes a moat once the anchor trusts the reconciliation gate in production and stops re-keying by hand (the BRD-V1 falsifier). Until pilot data shows admins relying on the gate rather than overriding it, every moat here is "Building", not "Have". The measure is BRD-M2 (OCR accuracy >= 90.06% behind a confidence gate) and BRD-M3 (0% discrepancy at the reconciliation gate).

---

## 5. Positioning and Pockets of Value

**Who we do not fight (and why):**

| Competitor / incumbent | Why we avoid direct competition | Our alternative |
|------------------------|--------------------------------|-----------------|
| Hastings, Monark (established PH rental firms and their web quote tools) | They are large rental operators, not software vendors; their online presence is a contact-form "quick quote" emailed back hours later. Fighting them on fleet or brand is a losing battle | Sell them nothing; serve the firms below them. Compete on the workflow they do not automate (OCR billing, minute-quotes, weather liability), not on equipment |
| Generic global fleet/rental SaaS | Cloud-only, English-first, priced for large operators, and blind to PH specifics: handwritten paper EDTRs, diesel-indexed pricing, Luzon weather liability, SEC/TIN KYC, PayMongo | Localize hard. Back-end the paper and index diesel/weather/compliance to the PH context, where a foreign entrant has no wedge |

**Underserved niche:** Paper-based PH heavy-equipment rental MSMEs whose growth is capped by a one-person back office and whose margin leaks through mis-billed and unbilled equipment-hours. Almara is the exemplar.

**Pocket of value / opportunity:** OCR-of-paper billing trust plus diesel-indexed pricing plus weather-linked liability evidence, bundled. No incumbent owns even one of these for this segment, let alone all three.

**Wedge:** Back-end the paper (PRD-F3) instead of forcing a born-digital field workflow. Ship the one thing no competitor offers (OCR usage-based billing with double-entry reconciliation), then expand across the tenant's back office from that beachhead.

**Primary segment (UES-D8):** The PH rental-MSME back-office admin role (persona Rhea), from [BRD §4 BMC Customer Segments](brd-arkilaunch.md). Cohort actions favor this segment's LTV. Adjacent verticals (non-rental construction, non-Luzon geographies, ML forecasting buyers) are vanity distractions and stay killed until the core segment is retained.

*Position where incumbents are overpriced, overbuilt, or uninterested. Incumbent PH rental firms are uninterested in back-office software; global SaaS is overbuilt and un-localized. The pocket is the one-person back office bleeding money to paper.*

---

## 6. Raise Triggers and KPIs

**Default stance:** Margins fund growth; raising is the exception, not the plan (UES-D7). Capital gains and equity upside are separate from operating cashflow; a raise story is not OCF health. For a capstone, the realistic "exception capital" is a grant (for example DOST or academic/industry) rather than an equity round.

**Raise only if these triggers are true:**

| Trigger | Threshold | Current | Met? |
|---------|-----------|---------|------|
| Proven unit economics but capital-constrained to go full-time | Contribution positive and repeatable across 3+ tenants (BRD-V3 proven), and the salaried breakeven of ~10 tenants is reachable only with bridge capital for team salary | Pre-revenue; unit economics illustrative | No |
| Runway below 6 months with no path to default-alive | In the salaried scenario, net burn would exhaust the ~PHP 150,000 fund inside 6 months and reference-led tenant ramp cannot close the gap in time | Sweat-equity base is default-alive; salaried scenario not yet entered | No |

**KPIs screened if forced to raise** (know them before you need them):

| ID | KPI | Formula / definition | Target for raise | Current |
|----|-----|----------------------|------------------|---------|
| UES-K1 | Revenue growth rate | MoM or YoY % | Positive MoM once tenants #2..#4 land | Pre-revenue (TBD) |
| UES-K2 | Net revenue retention (NRR) | (starting MRR + expansion - churn) / starting MRR | > 100% (seat/module expansion within tenants; BRD-V2) | TBD (needs anchor expansion data) |
| UES-K3 | Gross margin % | (revenue - COGS) / revenue | >= 75% | ~84% illustrative (UES-E4) |
| UES-K4 | LTV:CAC | UES-E7 | >= 3:1 | ~12:1 illustrative (TBD) |
| UES-K5 | CAC payback (months) | UES-E8 | <= 6 | ~3.4 illustrative (TBD) |
| UES-K6 | Burn multiple | net burn / net new ARR | < 2x | TBD (needs booked ARR) |
| UES-K7 | Rule of 40 | revenue growth % + profit margin % | >= 40 | TBD (needs revenue actuals) |

---

## 7. Venture Stage Map

Maps the venture-building lifecycle (Ideate -> Build -> Deploy -> Scale) to FMD phases and the UES numbers that must hold to advance.

| Stage | FMD phase | Gate (UES numbers / criteria) | Status |
|-------|-----------|-------------------------------|--------|
| **Ideate** | Phase 0 (IDEA, SCRUTINY, BRD, UES §0-§5) | Unit defined (one paying tenant); doctrine D1/D5/D6 drafted; niche and moat hypothesis stated (UES-M2); VALIDATION kill criteria resolved (all four signals read "Go", [val-arkilaunch.md](val-arkilaunch.md) §4) | Complete |
| **Build** | Phases 1-4 (PRD -> BUILD) | Contribution margin positive on paper (UES-E3 ~PHP 7,570, done); fixed-overhead ledger drafted (§2, done); OCF path stated (§2, done) | In progress |
| **Deploy** | OPS + Production Readiness Gate | UES-E7 green/yellow; runway >= 6 months (sweat-equity base clears this); default-alive path documented; anchor billed in production (BRD-M1) | Not started |
| **Scale** | GTM + WRAP | LTV:CAC >= 2.5:1; payback <= 6 months; growth spend <= cumulative contribution margin; BRD-V3 repeatability proven | Not started |

**Current stage:** Ideate complete, in Build. Phase 0 docs (IDEA, SCRUTINY, BRD, this UES, VALIDATION) are in place; the PRD and full technical suite (SDD, RFCs, DSD, QAD, SAD, BUILD, CLR, AIA, OPS) exist and are in this same Draft state, pending implementation.

**Next stage gate:** Before Deploy, the anchor must run core modules in production (BRD-M1) with the reconciliation gate trusted (BRD-M2/M3), and the first real UES-E5 (CAC) and churn readings must replace the illustrative figures here so UES-E7 and UES-E8 move from Yellow to a measured Green/Red.

---

## Self-Check

- [x] Section 0 names a specific unit (one paying rental-company tenant subscription per month) and payer (the rental MSME, not the contractor)
- [x] BRD BMC handoff rows filled (Segments, Revenue, Cost, `BRD-V#`)
- [x] Section 0.5 has all `UES-D1` through `UES-D8` rows
- [x] Asset allocation percentages sum to 100%; experiment bucket is capped (<= PHP 17,600/experiment)
- [x] Bet register states max loss and kill condition for each active bet
- [x] Section 1 LTV is computed on contribution margin, not revenue
- [x] Section 1 cites authoritative sources with verify date (Stripe, Eightx, Wildfront; 2026-07-25)
- [x] Section 2 fixed overhead is separated from variable spend
- [x] Section 2 includes OCF / contribution-funded ops and runway / default-alive (plus salaried stress test)
- [x] Section 3 ties growth to margins (not capital) and includes the UES-D4 experiment gate
- [x] Section 4 names moats with evidence and states the gap honestly (all "Building", not "Have")
- [x] Section 5 names who to avoid fighting and the primary segment (UES-D8)
- [x] Section 6 treats raising as the exception; KPI table filled; capital gains separated from OCF
- [x] Section 7 maps current stage (Ideate -> Build) to UES numbers
- [x] GTM can trace pricing back to UES-E1 (tiers) and UES-E3 (contribution)
- [x] All money figures labeled illustrative; pilot-dependent figures marked TBD with the measure named
- [x] AGENTS hard bans applied (no em-dashes); cross-linked to `idea-arkilaunch.md` and `brd-arkilaunch.md`
