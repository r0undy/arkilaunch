# Compliance & Legal Readiness Register (CLR)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with code)
**PRD:** [prd-arkilaunch.md](prd-arkilaunch.md)
**SDD:** [sdd-arkilaunch.md](sdd-arkilaunch.md)
**Event / context:** FMD engine v1.28.1; Scale Full. Forward gates: [aia-arkilaunch.md](aia-arkilaunch.md) (AI component) and [gtm-arkilaunch.md](gtm-arkilaunch.md) (public launch).

---

> ⚠️ **Structural and regulatory awareness only; NOT legal advice.** This register maps the data ArkiLaunch handles and surfaces the obligations that attach to it. It does not draft the Privacy Notice or the Terms of Use, and it does not replace a licensed attorney or a designated Data Protection Officer. Every item flagged **"counsel needed"** must be reviewed by a lawyer qualified in the Philippines (and, for the cross-border transfer, one who knows RA 10173 transfer rules) before ArkiLaunch goes to public launch. Section 3 carries multiple "Yes" flags, so this banner stays pinned to the top.

---

> **Reading order.** This CLR draws its data facts from [PRD](prd-arkilaunch.md) (§3 features, §5.6 event taxonomy, §7 AI component) and [SDD](sdd-arkilaunch.md) (§3 data architecture, §4 external integrations, §5 security). The OCR/IDP component is assessed in depth in the AIA; this register maps the privacy and cross-border obligations around it and escalates them. The diesel-price scraper decision lives in [rfc-arkilaunch-quotation-pricing-engine.md](rfc-arkilaunch-quotation-pricing-engine.md) (RFC-3); its lawful-access posture is registered here.

---

## 0. Target Markets (drives the rest of this document)

ArkiLaunch is a B2B SaaS for Philippine heavy-equipment rental MSMEs. The anchor tenant, Almara Construction Corporation, is in Quezon City. Data subjects are expected to be PH-based: rental-firm staff, field timekeepers, and PH construction contractors. The Philippines is the only intended market.

| Region | In scope? | Notes |
|--------|-----------|-------|
| European Union / UK (GDPR / UK GDPR) | No | Not a target market. No EU/UK establishment, no intentional offering to EU/UK data subjects. The public booking portal (`/t/:tenantSlug`) is not geo-blocked, so an EU/UK visitor could reach it; if any EU/UK resident actually transacts, escalate to counsel (see §3, flag E9). Not modeled here. |
| California, USA (CCPA / CPRA) | No | Not a target market. Same public-portal caveat as EU/UK. Not modeled here; consult counsel if US residents transact. |
| Philippines (Data Privacy Act 2012, RA 10173) | **Yes** | Primary and only intended market. NPC is the regulator. RA 10173 (Data Privacy Act) and RA 10175 (Cybercrime Prevention Act) both apply. The full obligations matrix (§2) is filled for this column only. |
| Other: N/A | No | No other market declared. A public web app with no geo-blocking reaches everyone; treat any non-PH transaction as a counsel trigger, not an in-scope market. |

**Geo-blocking:** None in V1. The public catalog and booking portal (`/t/:tenantSlug/*`) are globally reachable. Authenticated tenant surfaces (`/app/*`, `/field/*`, `/platform/*`) are behind login and expected to be PH-based staff. Because there is no geo-fence, honesty requires the caveat above: PH is the only in-scope market, but reachability is worldwide. A jurisdiction notice on the portal or a geo-limit is a decision for counsel + GTM (flag E9).

---

## 1. Data Inventory / Record of Processing

One row per processing activity, modeled on GDPR Article 30 and NPC record-keeping expectations. The **Source** column traces each activity to the PRD feature that collects it and the SDD store that holds it. All PII stores sit in Supabase managed Postgres with RLS by `tenant_id`; document images sit in Supabase Storage behind short-TTL signed URLs (SDD §3, §4).

| Activity | Source (PRD-F# / SDD store) | Purpose | Data categories | Data subjects | Recipients / sub-processors | Cross-border transfer | Retention | Legal basis (RA 10173) |
|----------|-----------------------------|---------|-----------------|---------------|-----------------------------|-----------------------|-----------|------------------------|
| Tenant onboarding & corporate identity | PRD-F6, F7 / `tenants`, `subscriptions`, `subscription_plans` | Register a rental firm and stand up its tenant | Legal name, slug, subscription status, KYC state | Rental company; its authorized representative | Hosting only (Supabase, Azure Container Apps) | None (host region, target SG/SE Asia) | Life of account + statutory record period; then dispose | Contract (Sec. 12(b)) |
| KYC document capture & extraction | PRD-F6 / `kyc_documents` (`file_uri` -> Supabase Storage, `ocr_payload`, `confidence`) | Verify a rental firm before production access | **SEC certificate, BIR forms, government ID images, SEC number, TIN.** Sensitive personal information under RA 10173 §3(l) | Corporate officers / authorized reps of rental firms | **Azure AI Document Intelligence** (OCR extract); Supabase Storage | **Yes: images sent to Azure DI. SE-Asia region availability confirmed (cr-arkilaunch-azure-di-provisioning.md); RA 10173 cross-border TRANSFER BASIS still UNVERIFIED, pending counsel (flag E1).** | Minimized capture; retain only as long as needed to verify + meet statutory KYC record duty, then secure disposal (schedule via DPO, flag E4) | Consent (explicit, for sensitive PII, Sec. 13) + legitimate interest for fraud prevention; confirm with counsel |
| User identity & authentication | PRD-F7 / `users` | Log in staff; gate access; 2FA for timekeepers | Email, argon2id password hash, role, TOTP secret (encrypted at rest) | Tenant staff (admin, owner, timekeeper) | None external | None | Life of account; disable + purge on offboarding | Contract |
| Personnel / field-timekeeper records & attribution | PRD-F3, F7 / `users`, `edtr` (`source`, attribution), `audit_logs` | Attribute each EDTR to a timekeeper and site; enforce active-site check | Timekeeper identity, assigned site, per-log timestamp + attribution, access-attempt logs | Field timekeepers (tenant employees) | None external | None | Operational + audit period (audit logs immutable, long-lived) | Contract / employment; legitimate interest (accountability) |
| Customer / contractor identity & booking | PRD-F8 / `customers`, `customer_contacts`, `addresses`, `customer_addresses` | Let contractors browse, book, and track rentals | Name, company name, contact details, addresses, KYC status | Customers / contractors of a tenant | None external | None | Life of relationship + statutory; then dispose | Contract |
| Project-site geodata | PRD-F5 / `project_sites` (`latitude`, `longitude`) | Poll weather per site; risk advisories; liability evidence | Precise site coordinates (lat/long) | Tenant / customer project sites (site, not person) | **Open-Meteo** (commercial plan) receives lat/long | **Yes: coordinates sent to Open-Meteo (EU/Germany-hosted).** Non-personal commodity weather query; note in transfer review | Advisory life + incident-evidence retention | Legitimate interest (safety evidence) / contract |
| EDTR capture & OCR | PRD-F3 / `edtr`, `edtr_line_items`, `edtr_reconciliations` (`raw_file_uri` -> Supabase Storage, `ocr_payload`) | Back-end the paper: extract active/idle hours; reconcile before billing | Handwritten EDTR images (may carry operator names / handwriting), active/idle hours, equipment refs | Equipment operators, timekeepers | **Azure AI Document Intelligence**; Supabase Storage | **Yes: images sent to Azure DI. Region availability confirmed (cr-arkilaunch-azure-di-provisioning.md); RA 10173 transfer basis still UNVERIFIED, pending counsel (flag E1).** | Image + payload retention limited to billing-evidence need; audit trail immutable | Contract / legitimate interest (billing integrity) |
| Billing & deposit ledger | PRD-F3 / `invoices`, `invoice_line_items` | Deduct reconciled hours; cite evidence; issue invoices | Invoice amounts, deposit balances, deduction history, source-log citations | Customers | None external | None | Statutory bookkeeping period (BIR); then dispose | Legal obligation (tax/accounting) + contract |
| Deposit payments via PayMongo | PRD-F2 / `payments` (`method`, `provider_ref`, `status`) | Take rental deposits through hosted checkout | Payment channel (card/GCash/Maya/bank), amount, **PayMongo `provider_ref` and status only. NO PAN / account number stored.** | Paying customers | **PayMongo** (BSP-regulated, PCI-DSS L1); hosted checkout | Processing within PH (PayMongo). Confirm any PayMongo sub-processor transfer via their DPA | Reference + status for reconciliation/dispute window + statutory | Contract; PayMongo is the card-data controller in its own scope |
| Weather liability incident logging | PRD-F5 / `weather_alerts` | Auto-log environmental liability incidents for disputes | Observed conditions snapshot, severity, site ref, timestamp, staleness flag | Tied to a site (largely non-PII) | None external (data from Open-Meteo poll) | None (data at rest in PH/SG region) | Long-lived (evidence value) | Legitimate interest (evidence) |
| Security & audit logging | PRD-F7 / `audit_logs` (append-only, immutable) | Prove who did what; cross-tenant denial logging | Actor id, action, entity, entity id, timestamp | All users | None external | None | Immutable, long-lived (accountability) | Legal obligation / legitimate interest (security) |
| Diesel-price ingestion | PRD-F1 / snapshot into `quotations.diesel_price_snapshot` (RFC-3) | Index quotes to live diesel price | **Public, non-PII commodity pricing** from the DOE price-watch | None (no personal data) | DOE public price-watch (source), if the RFC-3 scrape option is chosen | Inbound public data | Snapshot per versioned quotation (reproducibility) | Not personal data; RA 10175 lawful-access posture registered (flag E5) |
| Product analytics / telemetry | PRD §5.6 / first-party `events` table on Supabase Postgres, resolved in [OPS §2](ops-arkilaunch.md) (not PostHog; no new sub-processor added) | Wire BRD-M# metrics | Event names + identifiers only; **no PII in property values, no raw SEC/TIN, no card/account numbers, no ID images** (PRD §5.6 naming rule) | Users | None external; sink is first-party Supabase Postgres, already a named sub-processor | Same PH/EU-residency posture as the primary DB (no new residency question) | Rolling analytics window, same retention as the primary DB | Legitimate interest |
| Application logs | SDD §7 / structured logs (Winston / Nest Logger), sink resolved in [OPS §2](ops-arkilaunch.md): Azure Monitor / Log Analytics (API + Jobs), Vercel logs (frontend), Supabase logs (DB/Storage) | Ops + debugging | Structured app logs; identifiers only, no PII values, no secrets (password hash / TOTP never logged) | Users (indirect) | Azure Monitor / Log Analytics; Vercel; Supabase (all already named sub-processors) | Keep in-region | 30 to 90 days (SDD §7) | Legitimate interest (operations) |

**Sensitivity flags** (any Yes pulls the row into Section 3):

| Data type | Collected? | Notes |
|-----------|-----------|-------|
| Basic PII (name, email) | **Yes** | Staff emails, customer names, company contacts, addresses. |
| Special-category / sensitive (health, biometric, genetic, race, religion, sexuality, politics, union) | **Yes (per RA 10173 definition)** | Not GDPR "special category," but RA 10173 §3(l) classes **government-issued identifiers (TIN, government ID) as sensitive personal information.** SEC number + TIN + ID images qualify. Explicit consent + tighter handling apply. |
| Children's data (under 16 EU / under 13 COPPA) | No | B2B only; users are corporate staff and business contractors. Age eligibility 18+ set in ToU (§4). |
| Precise location | **Yes** | Project-site lat/long; transmitted to Open-Meteo for the weather poll (PRD-F5). Site coordinates, not live person tracking. |
| Photos / camera / microphone | **Yes** | EDTR photos and KYC document / government ID images, captured via phone camera (PRD-F3, F6). No microphone. |
| Device IDs / advertising IDs | No | No ad SDKs, no advertising identifiers. |
| Analytics / telemetry | **Yes** | First-party `events` table on Supabase Postgres (OPS §2); identifiers only, no PII in values (PRD §5.6). |
| Crash logs | **Yes (app logs)** | Structured logs, 30 to 90 days, no PII values, no secrets. |
| Payment / card data | **No (out of scope by design)** | PayMongo hosted checkout; ArkiLaunch stores only `provider_ref` + channel + status. No PAN or account number ever touches our boundary (SDD §5). |

**Self-check:**

| Item | Done? | Evidence link | Counsel needed? |
|------|-------|---------------|-----------------|
| Every processing activity has a retention period | In progress | SDD §7 (retention row: KYC/ID minimized, audit immutable, app logs 30 to 90d) | **Yes.** Final retention + disposal schedule for KYC/ID images must be set by the DPO/counsel (flag E4). |
| Every sub-processor is named and has a DPA in place | Named, DPAs not executed | SDD §4 integrations table; SDD §8.1 "data sent to model providers" | **Yes.** Execute DPAs with Azure (Microsoft), PayMongo, Supabase, Open-Meteo, and the analytics sink (flag E3). |
| Inventory is dated and treated as a living document | Yes | This document, dated 2026-07-25 | No (revisit each release) |

---

## 2. Multi-Jurisdiction Obligations Matrix

Only the **Philippines DPA 2012** column is in scope (Section 0). The EU/UK and California cells state the generic obligations for reference only; ArkiLaunch does not target those markets, so their "Our status / action" rows say so.

| Dimension | EU / UK GDPR | California CCPA / CPRA | Philippines DPA 2012 (RA 10173) |
|-----------|--------------|------------------------|----------------------------------|
| **Consent / legal basis** | Opt-in; one of 6 lawful bases; special-category prohibited by default | Opt-**out** of sale/share + "Limit use of sensitive PI" link | Consent or another lawful criterion (Sec. 12); **sensitive personal information needs explicit consent** (Sec. 13). KYC SEC/TIN/ID images = sensitive PII, so explicit consent + purpose limitation. |
| **Data subject rights** | Access, rectify, erase, port, object, restrict, no solely-automated decisions | Know, delete, correct, opt-out of sale/share, limit SPI, non-discrimination | Access, correct, erase/block, object, data portability, be informed, claim damages. A working data-subject-request path must exist. |
| **Breach notification** | Authority ≤72h; subjects without undue delay if high risk | Without unreasonable delay; CA AG if >500 residents | **NPC and affected subjects within 72h of knowledge** if the breach involves sensitive PII and a real risk of serious harm. Runbook: [OPS §4.7](ops-arkilaunch.md). |
| **DPO / representative** | DPO if large-scale/special data; EU/UK rep if no establishment | No DPO mandate; contact method required | **Mandatory Data Protection Officer** + Privacy Impact Assessment + Privacy Management Program. **Registration of the Data Processing System with the NPC** where thresholds are met (sensitive PII processing). |
| **Cross-border transfer** | Adequacy / SCCs / BCRs + transfer risk assessment | Contractual flow-down to service providers | The personal information controller **stays accountable** for data transferred abroad and must ensure comparable protection (Sec. 21). Applies to KYC/EDTR images sent to Azure DI (flag E1). |
| **Our status / action** | Out of scope (Section 0). Not modeled. If an EU/UK resident transacts via the ungated public portal, escalate to counsel before treating them as in-scope (flag E9). | Out of scope (Section 0). Same public-portal caveat (flag E9). | **In scope, primary market.** Actions: (1) designate + register a DPO (flag E2); (2) run a PIA (flag E11); (3) stand up the Privacy Management Program, Privacy Notice, and consent flow; (4) confirm NPC Data Processing System registration threshold; (5) map controller/processor roles (below); (6) build the data-subject-request path; (7) breach runbook in OPS at the 72h line. |

**Controller / processor mapping (RA 10173 roles).** This is load-bearing and needs counsel confirmation:

- **Each tenant (rental firm) is a Personal Information Controller (PIC)** for its own customers', employees', and timekeepers' data. ArkiLaunch processes that data on the tenant's instructions.
- **ArkiLaunch is a Personal Information Processor (PIP) / sub-processor** for tenant-owned data. This requires a data processing agreement between ArkiLaunch and each tenant (flag E3).
- **ArkiLaunch is itself a PIC** for the KYC data it collects to verify a rental firm (SEC number, TIN, government ID images of the firm's officers). ArkiLaunch owns the lawful basis, retention, and disposal for that set directly.
- **Azure AI Document Intelligence, PayMongo, Supabase, Open-Meteo, and the analytics sink are sub-processors.** Each needs a DPA and a documented cross-border/residency posture (flag E1, E3).

**Multi-tenant segregation as a technical control.** Postgres **row-level security keyed on a transaction-scoped GUC (`app.current_tenant_id`)**, plus an application-layer `tenant_id` filter as defense in depth, keep one tenant's personal data invisible to another (SDD §3, §5; RFC-1). This is the technical measure that supports the "appropriate organizational, physical, and technical security measures" duty under RA 10173. It is a control, not a legal basis; it does not by itself discharge the consent, retention, or DPO obligations.

**OCR component cross-reference.** The Azure DI OCR/IDP pipeline that reads KYC and EDTR images is assessed for AI-specific risk (prompt injection on document text, sensitive-info disclosure, forged documents, provider retention/training terms) in the **AIA** ([aia-arkilaunch.md](aia-arkilaunch.md), and SDD §8.1). This CLR registers the privacy and cross-border obligations; the AIA registers the model assurance. Both must clear before launch.

**Watch list (changes in effect):** NPC circulars on registration and breach reporting (confirm current thresholds under the latest NPC Circular before registering); CCPA clarifying regulations effective 2026-01-01 (only relevant if the US caveat ever triggers); evolving automated-decision rules (ArkiLaunch stays clear by keeping HITL on every gate, see §3). Re-check NPC guidance at each release.

**Self-check:**

| Item | Done? | Evidence link | Counsel needed? |
|------|-------|---------------|-----------------|
| Consent model implemented for each in-scope region | Not built | PRD §5.4 friction budget (collect only what KYC needs); this CLR §1 | **Yes.** Explicit-consent flow for sensitive PII + Privacy Notice; counsel drafts. |
| A working data-subject-request path exists (access/delete) | Not built | RLS + `audit_logs` give the technical footing (SDD §3) | **Yes.** DSR intake + fulfillment path is unbuilt; needs design + counsel sign-off. |
| Breach response runbook exists with the tightest applicable timeline | Yes | [ops-arkilaunch.md](ops-arkilaunch.md) §4.7 (tenant-isolation breach response, including the NPC 72h notification clock); SDD §5 security controls | **Yes.** Counsel confirms the runbook's NPC-notification threshold judgment call is correct for a given incident (the runbook cannot substitute legal judgment, only structure the timeline). |
| DPO / representative designated where required | No | RA 10173 mandate | **Yes (blocking).** Designate + register a DPO before launch (flag E2). |

---

## 3. Escalation Flags; Counsel Required

Any "Yes" means: do not launch this surface without a Philippine-qualified lawyer (and, for the OCR component, the AIA assessor). The top-of-document disclaimer banner is set because this section carries several.

| Flag | Present? | Why it escalates |
|------|----------|------------------|
| Children's data | No | B2B; 18+ only. No processing of minors' data. |
| Health / medical data | No | Not collected. |
| Payments / card data | **Yes (scope minimized)** | Deposits are taken. PayMongo hosted checkout keeps card data out of ArkiLaunch's boundary (we store only `provider_ref` + status), so we target PCI-DSS SAQ-A eligibility. Still needs the PayMongo processor agreement and confirmation that no integration path pulls card data in-scope (flag E6). |
| Biometric data | No (V1) | Government ID images are photographs of documents, not biometric templates; no face-match or biometric identification is performed. If facial biometric matching is added later, re-flag immediately. |
| Large-scale / systematic monitoring or profiling | No | No behavioral profiling, no cross-context tracking. Weather-per-site and audit logs are operational, not profiling of individuals. |
| Automated decisions with legal/significant effect | **No, by design** | KYC verification and billing deduction could have significant effect, but **HITL gates every one**: extraction only proposes fields; a human confirms SEC/TIN against SEC + BIR portals, and a human approves every reconciled deduction (PRD §7, SDD §8). No solely-automated decision. This is the control that keeps us out of Art-22-style territory; it is registered and assessed in the AIA. |
| Sale / share / cross-context behavioral advertising | No | No data sale, no ad tech, no cross-context advertising. |
| Operating in a market with no local entity | Flag | ArkiLaunch operates in its home market (PH). Confirm the operating legal entity's registration (SEC/DTI) and its standing to act as PIP; a capstone team is not automatically a registered processor (flag E10 covers entity + capstone IP). |

**DPIA / PIA required?** **Yes.** ArkiLaunch processes sensitive personal information (government IDs, TIN) across multiple tenants. NPC guidance expects a Privacy Impact Assessment for such a system. A PIA (and, for the AI component, the AIA) must be completed before processing at launch. The PIA itself is out of scope for this register; it is owned by the DPO + counsel (flag E11).

### 3.1 ArkiLaunch escalation register (counsel / assessor required)

Each row is a concrete item that cannot be closed by engineering alone. This is the launch-gate punch list for legal readiness.

| ID | Item | Owner to engage | Blocking launch? | Source |
|----|------|-----------------|------------------|--------|
| **E1** | **Cross-border transfer of KYC/ID + EDTR images to Azure AI Document Intelligence.** SE-Asia (Singapore) region availability is confirmed (cr-arkilaunch-azure-di-provisioning.md) -- still needed: confirm the RA 10173 Sec. 21 accountability posture and comparable-protection guarantee; confirm Microsoft does not train on customer data and its retention terms. | Counsel + DPO | **Yes** | SDD §4, §8.1; PRD §8 (G-5) |
| **E2** | **Designate and register a Data Protection Officer with the NPC.** Mandatory under RA 10173. | Owner + counsel | **Yes** | RA 10173; §2 |
| **E3** | **Data processing agreements.** Tenant DPAs (ArkiLaunch as PIP; each tenant as PIC) and sub-processor DPAs with Azure/Microsoft, PayMongo, Supabase, Open-Meteo, and the analytics sink. | Counsel | **Yes** | §1 self-check; §2 mapping |
| **E4** | **KYC/ID image retention + secure disposal schedule.** Sensitive PII: define how long images and `ocr_payload` are kept and the secure-deletion mechanism after purpose is met. | DPO + counsel | **Yes** | SDD §7; §1 |
| **E5** | **RA 10175 (Cybercrime Prevention Act) posture for the diesel-price scraper.** If RFC-3 selects the DOE price-watch scrape, it MUST read only the public presentation layer, respect `robots.txt`, never circumvent authentication, and avoid request overload. Public, non-PII commodity pricing. Flag for legal review before enabling the scrape option. | Counsel | Yes if scrape option chosen | RFC-3; build-context |
| **E6** | **PayMongo processor agreement + PCI scope confirmation.** Confirm SAQ-A eligibility given hosted checkout; get the processor/DPA in place. | Counsel | Yes | SDD §5; PRD-F2 |
| **E7** | **Trademark clearance for "ArkiLaunch."** Knockout search at IPOPHL for the name/mark in the relevant Nice classes (software/SaaS: class 9 and 42). | Counsel | No (pre-launch advisable) | §5 |
| **E8** | **Terms of Use + Privacy Notice drafting.** Use the lessee contract terms from the thesis as ToU inputs; governing law = Philippines. Counsel drafts the actual text. | Counsel | Yes (Privacy Notice) | §4 |
| **E9** | **Ungated public portal reaches non-PH users.** Decide geo-limit or jurisdiction notice; confirm whether any EU/US obligations attach if non-PH residents transact. | Counsel + GTM | No (advisable) | §0 |
| **E10** | **Operating entity + capstone IP.** Confirm the ArkiLaunch operating entity is registered and can act as PIP; resolve IP ownership of the capstone work (student team + school policy) and get written IP assignment. | Counsel | Yes (entity) | §5; §3 |
| **E11** | **Privacy Impact Assessment (PIA) + AIA.** Complete the PIA for sensitive-PII processing and the AIA for the OCR/IDP component. | DPO + AIA assessor | **Yes (joint launch gate)** | §3; [aia-arkilaunch.md](aia-arkilaunch.md) |

**Launch gate.** This CLR MUST clear (E1 through E6, E8, E10, E11 resolved or formally accepted by counsel) before GTM / public launch, **alongside the AIA** for the AI component. ArkiLaunch's own Production Readiness Gate ([index.md](index.md) §4, backed by [pitch-arkilaunch.md](pitch-arkilaunch.md) §5 and [wrap-arkilaunch.md](wrap-arkilaunch.md) §5, not the external FMD engine's generic `AGENTS.md`) and [gtm-arkilaunch.md](gtm-arkilaunch.md) both treat compliance as a hard launch gate.

---

## 4. Terms of Use / EULA Readiness

Presence-check only. Nothing is drafted yet; counsel drafts and reviews the actual text. The thesis lessee contract terms are the raw input for the rental/ToU clauses.

| Clause | Present? | Evidence link | Counsel needed? |
|--------|----------|---------------|-----------------|
| License grant + scope | No (not drafted) | | |
| Acceptable use / prohibited conduct | No | | |
| Limitation of liability + warranty disclaimer | No | | Yes |
| Governing law + jurisdiction | No (target: Philippines) | | Yes |
| Dispute resolution (arbitration / class-action waiver; enforceability varies) | No | | Yes |
| Termination + suspension rights | No | | |
| User-generated content license + DMCA reference | No | EDTR/KYC uploads are user content; need a processing license clause | |
| Modification / notice mechanism | No | | |
| Payment / refund terms | No | Ties to deposit + PayMongo (PRD-F2); refund/dispute detail is carried gap G-10 | Yes |
| Age eligibility | No (target: 18+) | B2B; no minors | |
| Privacy Policy incorporated by reference | No | Privacy Notice must exist first (flag E8) and be linked from the portal | Yes |

**Note:** The rental/lease relationship (deposit, deduction against reconciled hours, lessee obligations) comes from the thesis contract terms. Feed those to counsel as ToU + rental-agreement inputs rather than reinventing them.

---

## 5. IP Infringement & Protection Readiness

| Item | Status | Evidence link | Counsel needed? |
|------|--------|---------------|-----------------|
| Product/brand name trademark knockout search (per target market + class) | Not done | IPOPHL search for "ArkiLaunch," class 9 + 42 | **Yes** (flag E7) |
| Open-source license compliance; SBOM maintained (SPDX or CycloneDX) | Not yet | Stack pinned in build-context / BUILD §3 (React 19.2, NestJS 11.1, Drizzle, Vite 8, Tailwind, TanStack, Zod) | Generate SBOM in BUILD |
| Copyleft scan (GPL/AGPL/LGPL); no license incompatible with distribution | Not yet | Pinned stack is predominantly MIT/Apache; scan to confirm | Low risk; confirm |
| Third-party assets licensed (fonts, icons, images, audio); proof retained | Not yet | DSD assets ([dsd-arkilaunch.md](dsd-arkilaunch.md)) | Retain license proof |
| AI training-data provenance + model-output ownership/indemnity reviewed | Partial | Azure DI is a managed extraction service, not a generative model trained by us; confirm Microsoft does not train on customer data and confirm output ownership/indemnity | Cross-ref AIA §5, SDD §8.1 (flag E1) |
| AI search vs training crawl policy decided and reflected in robots.txt (see BUILD §5.2) | Not decided | Public landing + tenant portals ship a public surface; decide AI-crawler vs search-crawler policy in [build-arkilaunch.md](build-arkilaunch.md) §5.2 and [gtm-arkilaunch.md](gtm-arkilaunch.md) §8. Note: ArkiLaunch is also the *crawler* of the DOE price-watch (flag E5), the other side of the same coin. | Decide in BUILD §5.2 |
| DMCA / takedown process + registered agent | N/A (US); note PH analog | Notice-and-takedown under RA 10175 / the E-Commerce Act if UGC disputes arise; low priority for B2B | |
| Written IP assignment from every contractor / employee / OSS contributor | Not done | Capstone team + school IP policy | **Yes** (flag E10): resolve capstone IP ownership + written assignment |

---

## 6. App Store / Platform Compliance

**Not applicable in V1.** ArkiLaunch ships as a responsive web application (React SPA on Vercel), mobile-first for the timekeeper console and the customer portal, but it is **not submitted to the Apple App Store or Google Play**. No native app package, no store data-safety forms.

| Item | Status | Evidence link |
|------|--------|---------------|
| Apple App Privacy ("nutrition label") completed in App Store Connect | N/A (no native app) | Web app; PRD §5.5 mobile-first web |
| Privacy Policy URL live (Apple Guideline 5.1.1) | Pending (web) | Privacy Notice needed regardless of store (flag E8) |
| Google Play Data Safety form completed | N/A (no native app) | |
| Account/data deletion mechanism declared (Google Play requirement) | N/A for store; still needed for RA 10173 | DSR/delete path required by DPA (§2) |
| All third-party SDKs / ad networks audited and disclosed | N/A (no ad networks; sub-processors listed in §1) | §1 inventory |

If a native or PWA-in-store distribution is added later, re-open this section and complete the store data-safety forms.

---

## Self-Check

- [x] Section 0 declares every market; geo-blocking reality is honest (PH in scope; public portal is worldwide-reachable, caveat stated)
- [x] Section 1 has one row per processing activity, each with a retention period (final KYC/ID retention flagged to DPO)
- [x] Section 2 columns are filled for the one in-scope region (PH); EU/CA marked out of scope in the action row
- [x] Every Section 3 "Yes" has a corresponding counsel action (§3.1 register E1 through E11) and the banner is set
- [x] Section 4 ToU clause presence checked (drafting left to counsel; thesis lessee terms flagged as input)
- [ ] Section 5 SBOM exists and copyleft has been scanned (SBOM generation deferred to BUILD; flagged)
- [x] Section 5 AI search vs training crawl policy row filled (decision deferred to BUILD §5.2 / GTM §8; diesel-scraper flip side noted)
- [x] Section 6 handled (N/A: web app, no app-store submission in V1)
- [x] This document maps obligations and escalates; it does not give legal advice
- [x] Data flows traced to PRD-F# and SDD stores (§1 Source column); cross-linked to prd/sdd; forward-linked to AIA + GTM
- [x] AGENTS hard bans applied (no em-dashes; sharp-teammate tone)
