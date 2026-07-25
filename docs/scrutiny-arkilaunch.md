# IDEA Scrutiny Gate (SCRUTINY)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled)
**IDEA:** [idea-arkilaunch.md](idea-arkilaunch.md)

---

> **Note:** Build gate run as step 1 of "Build the FMD". Claims fact-checked against real sources per the trust rule; unresolved items marked "Unverified; needs check", never fabricated. Web verification performed 2026-07-25.

---

## 1. Verdict

**Decision:** PROCEED WITH FIXES

**One-line rationale:** The IDEA has a named user, a concrete pain moment, a repeatable one-liner, and a clear "ship one thing"; the load-bearing market and technical claims that resolve are verified, and the open items are Minor/Significant gaps (external-API licensing, standard currency, unnamed data sources) that the suite can carry as explicit TBDs rather than blockers.

**Items carried into the build as TBD / risk:**
- **Open-Meteo commercial licensing** (free tier is non-commercial only): SDD §4/§6 (integration + fallback), OPS (cost/quota alerting), UES (COGS line). Significant.
- **ISO/IEC 25010 version:** thesis uses the 2011 8-characteristic model; 25010:2023 has 9 (added Safety) and renames Usability/Portability. QAD (choose 2011 for academic consistency and note it, or adopt 2023). Significant.
- **Diesel-price data source unnamed:** RFC-3 (quotation-pricing-engine) decides scrape (DOE) vs admin input vs feed. Significant.
- **Multi-tenancy not modeled in the thesis schema:** RFC-1 + SDD §3 add Tenant/Subscription and tenant_id + RLS. Significant (resolved by design).
- **Azure DI region / data residency for PH corporate + ID images:** AIA §5 + CLR. Significant.
- **OCR accuracy target 90.06% (de Jager & Nel, 2019) unresolved this session:** QAD treats it as a measured target behind a confidence gate + HITL, not a guarantee. Minor.
- **Market "7.6% CAGR by 2032" not confirmed against the cited source:** BRD/UES cite the confirmed 5.06%/2029 (Arizton) as the primary figure. Minor.

*No DO NOT BUILD YET blockers; §7 is empty.*

---

## 2. Claim & Reference Audit

*Checkable details extracted from the IDEA/thesis and grouped by category. Trust rule honored.*

**Coverage:** Claims extracted: 13; checked: 13; verified: 8; unverified: 3; contradicted (as stated): 2 (both Minor/Significant, reframed in fixes).

| # | Category | Claim (from IDEA) | Finding | Source (required if Verified) | Severity if wrong |
|---|----------|-------------------|---------|-------------------------------|-------------------|
| FC-1 | Problem | PH heavy-equipment rental MSMEs run paper EDTRs / manual quotes / file-cabinet archives, causing revenue leakage and flood-vulnerable data loss | Verified (consistent with market driver: equipment demand tied to flood-mitigation/infra projects; internal domain evidence from Almara) | [Arizton PH CE rental market](https://www.arizton.com/market-reports/philippines-construction-equipment-rental-market); [PRNewswire (flood mitigation demand)](https://www.prnewswire.com/news-releases/philippines-construction-equipment-rental-market-assessment--forecasts-2024-2029-need-of-construction-equipment-in-natural-calamities-and-flood-mitigation-and-adaptation-projects-to-increase-demand-302095841.html) | Significant |
| FC-2 | Market | PH construction equipment rental market grows at 5.06% CAGR to 2029 | Verified (USD 175.9M in 2023 to USD 236.5M by 2029, 5.06%) | [Arizton](https://www.arizton.com/market-reports/philippines-construction-equipment-rental-market) | Minor |
| FC-3 | Market | 7.6% CAGR by 2032 | Unverified; needs check (Arizton report is 2024 to 2029; the 2032 figure is a different source, not confirmed) | not resolved | Minor |
| FC-4 | Technical | Azure AI Document Intelligence extracts handwritten text; custom models handle handwritten fields | Verified | [MS Learn: Read OCR](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/read?view=doc-intel-4.0.0); [MS Learn: overview](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview?view=doc-intel-4.0.0) | Significant |
| FC-5 | Technical | Prebuilt ID model can extract PH corporate identifiers (SEC/TIN) | Contradicted as implied (prebuilt idDocument supports only US driver licenses + international passport bio pages; PH SEC/TIN needs custom or layout+query fields) | [MS Learn: id-document](https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/document-intelligence/prebuilt/id-document.md) | Significant (design already routes to custom; see RFC-2) |
| FC-6 | Technical | Open-Meteo provides real-time weather via API | Verified, with caveat | [Open-Meteo](https://open-meteo.com/); [About](https://open-meteo.com/en/about) | Significant |
| FC-7 | Cost | Open-Meteo is free for this system's use | Contradicted as stated (free tier is non-commercial, up to 10k calls/day, CC BY 4.0; ArkiLaunch is commercial and needs a paid plan) | [Open-Meteo pricing/about](https://open-meteo.com/en/about) | Significant |
| FC-8 | Technical | PayMongo hosted checkout accepts cards + GCash + Maya + banks without the platform storing card data | Verified (BSP-regulated, PCI-DSS L1, hosted checkout reduces PCI scope) | [PayMongo Hosted Checkout](https://www.paymongo.com/products/payment-channels/hosted-checkout) | Significant |
| FC-9 | Technical | Spatial Index Pairing / zonal extraction lifts accuracy from ~60.18% to >=90.06% (de Jager & Nel, 2019) | Unverified; needs check (specific study/figure not resolved this session) | not resolved | Minor |
| FC-10 | Compliance | RA 10173 (Data Privacy Act 2012) and RA 10175 (Cybercrime Prevention Act 2012) govern data + scraping conduct | Verified | [NPC RA 10173](https://privacy.gov.ph/data-privacy-act/); [Cybercrime Prevention Act (overview)](https://en.wikipedia.org/wiki/Cybercrime_Prevention_Act_of_2012) | Significant |
| FC-11 | Compliance | BIR ORUS uses CAPTCHA, blocking automated verification, forcing human-in-the-loop | Verified | [BIR ORUS verification (CAPTCHA)](https://www.respicio.ph/commentaries/online-verification-of-bir-registered-business-name-philippines) | Significant |
| FC-12 | Technical | Evaluation follows ISO/IEC 25010, 8 sub-characteristics | Verified w/ currency caveat (standard exists; but 25010:2023 has 9 characteristics and renames Usability to Interaction Capability, Portability to Flexibility; the 8-list is the superseded 2011 model) | [ISO 25010:2023](https://www.iso.org/standard/78176.html) | Significant (eval instrument) |
| FC-13 | Metrics | Targets: OCR >=90.06% accuracy, 0% reconciliation discrepancy, 99.5% uptime | Design targets, not external claims (accept as QAD/OPS objectives to measure, not facts to verify) | n/a (internal targets) | Minor |

### 2.1 References Integrity

*The thesis is a capstone with an extensive academic literature review (dozens of citations). The load-bearing, externally checkable references are audited below. The remaining literature-review citations (e.g. Ayalp & Arslan 2025; Han et al. 2024; Oliveira et al. 2017; Pingili 2025; and similar) are academic sources supporting the review narrative and were not independently resolved this session; they are marked Unverified rather than fabricated, and none is load-bearing for a build decision.*

| # | Reference (as cited in IDEA) | Backs claim | Resolves? | Supports the claim? | Finding |
|---|------------------------------|-------------|-----------|---------------------|---------|
| R-1 | Arizton Advisory & Intelligence, 2024 (PH CE rental market) | FC-2 | Yes | Yes | Verified (5.06%/2029) |
| R-2 | "Deep, 2024" (7.6% CAGR by 2032) | FC-3 | No | Unknown | Unverified; needs check |
| R-3 | de Jager & Nel, 2019 (zonal OCR / Index Pairing accuracy) | FC-9 | No | Unknown | Unverified; needs check |
| R-4 | ISO/IEC 25010 | FC-12 | Yes | Partly (thesis uses 2011 model; current is 2023) | Verified w/ caveat |
| R-5 | RA 10173 / RA 10175, 2012 (Official Gazette / NPC; https://privacy.gov.ph/data-privacy-act/) | FC-10 | Yes | Yes | Verified |
| R-6 | Microsoft Azure AI Document Intelligence docs | FC-4/FC-5 | Yes | Partly (handwriting yes; prebuilt ID scope narrower than implied) | Verified w/ caveat |
| R-7 | Open-Meteo API | FC-6/FC-7 | Yes | Partly (real-time yes; "free" only non-commercial) | Verified w/ caveat |
| R-8 | PayMongo, 2026 (https://www.paymongo.com/products/payment-channels/hosted-checkout) | FC-8 | Yes | Yes | Verified |
| R-9 | Remaining academic literature-review citations (bulk) | review narrative | Not this session | Assumed | Unverified; not load-bearing |

---

## 3. Gap Analysis

| # | Missing input | Needed by (doc) | Blocker or TBD |
|---|---------------|-----------------|----------------|
| G-1 | Multi-tenant data model (Tenant, SubscriptionPlan, Subscription, tenant_id, RLS) absent from the thesis 29-entity schema | SDD §3, RFC-1 | TBD (resolved by design) |
| G-2 | Identity ownership: thesis names both Supabase Auth and Passport-JWT | SDD §5, RFC-1 | TBD (resolved: NestJS/Passport owns identity) |
| G-3 | Diesel-price data source and refresh strategy | RFC-3, SDD §4 | TBD |
| G-4 | Open-Meteo commercial plan + quota/cost + fallback behavior | SDD §4/§6, OPS, UES | TBD |
| G-5 | Azure DI model choice per source (custom EDTR vs layout+query for SEC/TIN), confidence threshold, HITL gate, data residency | RFC-2, SDD §8, AIA | TBD (resolved by design) |
| G-6 | Persistent backend host for the cron scheduler + async OCR workers (Vercel serverless cannot run them) | SDD §6, BUILD §3 | TBD (resolved: persistent host, e.g. Azure Container Apps) |
| G-7 | Likert scale (thesis inconsistent: 4-point once vs 5-point elsewhere) | QAD | TBD (resolved: 5-point) |
| G-8 | Unit economics for a SaaS: pricing tiers, CAC, LTV, subscription model | UES, GTM | TBD |
| G-9 | Concept visuals (UI reference frames) not yet generated | DSD §0.5 | TBD |
| G-10 | PayMongo webhook + idempotency + refund/dispute handling detail | SDD §4, RFC-2 (or SDD), QAD abuse | TBD |

---

## 4. Assumption Stress-Test

**Load-bearing assumption:** Rental-company field workers will keep using paper EDTRs, so the highest-leverage digitization is to OCR the existing paper (plus a second independent log for double-entry reconciliation) rather than force a born-digital field workflow.

**Strongest argument against it:** If clients/trackers would in fact adopt a simple mobile entry form, then OCR of messy handwriting is unnecessary complexity and a lower-accuracy path than direct digital entry; the OCR investment and its error surface would be wasted.

**Does it hold?** Holds with caveat. The thesis and the domain (low digital literacy, entrenched paper, dual-tracker reconciliation for trust) support OCR-of-paper as the adoption bridge; but the system should still offer direct digital EDTR entry as the primary path where a tracker is willing, with OCR as the fallback for paper. That keeps accuracy high and de-risks the assumption. Carry into PRD §3 / SDD §8 as "digital-first, OCR-fallback".

**Second-order effects worth noting:** Double-entry reconciliation creates a neutral evidence trail that reduces client disputes (a moat and a trust feature), but it also doubles data-entry effort per equipment-day; the reconciliation tolerance and low-confidence routing must be tuned so admins are not buried in review queues.

### 4.1 Audience / 10-second stress

| Check | Finding | Severity if fail |
|-------|---------|------------------|
| Stranger hook (10 seconds): who hurts and why? | Pass. "A one-person back office at a PH equipment-rental firm loses money because paper field logs get mis-billed, quotes take 30 minutes by hand, and floods destroy the records." | Critical if Fail and no internal-tool exception |
| Named user + pain present in IDEA §2 | Pass (Rhea, Almara's sole admin; flooded EDTRs / client waiting on hand-calculated quote) | Critical if Fail |
| One-liner repeatable (not generic SaaS) | Pass (concrete: scans field time-sheets, diesel-indexed pricing, weather risk) | Critical if Fail |
| Substitute indifference: why not keep coping with status quo? | Pass. Status quo actively loses billable hours and data to floods; a faster-quoting competitor wins jobs. The pain is bleeding money, not mild annoyance. | Significant; Critical if Fail and insight hollow |

**Audience verdict:** Holds. A stranger grasps the wound (money leaking through paper) and why existing PH tools (contact-form "quick quotes") do not fix it.

---

## 5. Feasibility & Scope

| Check | Finding |
|-------|---------|
| Time box realistic for the scope? | This is a capstone-scale build productized as SaaS; the full 8-feature scope is large. Feasible if sequenced: F3 (OCR billing) + F1 (quotation) + F7 (tenancy/auth) first; F5/F6/F4/F8/F2 follow. Flagged in PRD priorities. |
| "If we ship only one thing" actually shippable? | Yes. F3 OCR usage-based billing with reconciliation is a coherent vertical slice (upload, extract, reconcile, deduct) buildable on the chosen stack. |
| Production-grade reachable (security, data, rollback) in the window? | Yes, but non-trivial: multi-tenant RLS, JWT rotation, Azure DI HITL, PayMongo webhooks, and PH data-privacy compliance are all required for "done". Covered by SDD/CLR/AIA/OPS. |
| Scope honest, or is the cut line hiding work? | Mostly honest. Hidden work surfaced: multi-tenancy (not in thesis schema), Open-Meteo commercial licensing, persistent backend host for cron/workers, PayMongo webhook robustness. All now carried as gaps. |

---

## 6. Risk & Compliance Pre-flight

| Flag | Present? | Pulls in |
|------|----------|----------|
| Collects user data / PII | Y (customer identity, KYC docs with SEC/TIN, personnel, ID images) | CLR (required) |
| Children, health, payment, or biometric data | Partial (government IDs / KYC document images = sensitive personal info under RA 10173; payment via PayMongo hosted, no card storage) | CLR §3 escalation + counsel (KYC/ID handling, NPC registration) |
| AI component with untrusted input or tools | Y (Azure DI OCR over user-uploaded EDTR/ID images; extraction drives billing) | SDD §8.1 + QAD red-team + Context Hygiene + AIA (launch gate alongside CLR) |
| Security-critical paths (auth, money, deletes) | Y (multi-tenant auth, deposit deduction, invoicing, payments, tenant isolation) | SDD §5 + QAD abuse paths |
| Public deploy | Y (customer-facing booking portal on a public URL) | OPS + CLR |

---

## 7. Blocking Questions

*None. Verdict is PROCEED WITH FIXES; blockers do not apply.*

---

## Self-Check

- [x] Verdict (§1) is set and matches the findings (PROCEED WITH FIXES)
- [x] §2 coverage line filled; every checkable IDEA detail has a row
- [x] No claim row reports Verified without a source (trust rule honored)
- [x] §2.1 audits the checkable references; bulk academic citations explicitly marked Unverified, not fabricated
- [x] §4.1 audience / 10-second stress filled
- [x] Critical list honored; no narrative blockers (all real gaps are Minor/Significant TBDs)
- [x] §7 empty because verdict is not DO NOT BUILD YET
- [x] Risk flags (§6) name the docs they pull into scope
- [x] Every fix in §1 names the doc it lands in
- [x] AGENTS hard bans applied (no em-dashes)
- [x] On PROCEED: index row added; build sequence continues
