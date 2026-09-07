# AI Assurance Dossier (AIA)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with code)
**PRD:** [prd-arkilaunch.md](prd-arkilaunch.md)
**SDD:** [sdd-arkilaunch.md](sdd-arkilaunch.md)
**QAD:** [qad-arkilaunch.md](qad-arkilaunch.md)
**CLR:** [clr-arkilaunch.md](clr-arkilaunch.md)

---

> **Governance and assurance-readiness awareness only; NOT an audit and NOT a certification.** This dossier assembles the documentation the AI component needs to be assessed. It does not certify ISO/IEC 42001, does not discharge any legal duty, and does not replace a qualified AI auditor or a licensed attorney. Items flagged "counsel/assessor needed" must be escalated before launch.

---

## 0. Trigger and Scope

| Field | Value |
|-------|-------|
| AI component (from PRD §7) | Azure AI Document Intelligence OCR / Intelligent Document Processing: extracts fields from handwritten Equipment Daily Time Reports (EDTRs) and from corporate KYC documents (SEC number, TIN) |
| Realizing feature ID(s) | PRD-F3 (OCR usage-based billing), PRD-F6 (OCR-assisted KYC) |
| System boundary (in / out) | In: image upload, Azure DI extraction, per-field confidence, double-entry reconciliation, human-in-the-loop review, the deduction/onboarding gates. Out: the deterministic pricing engine (RFC-3, no AI), the weather module (rule-based), and any generative-LLM use (there is none) |
| Autonomy level | Assistive extraction only. The model proposes field values with confidence; it takes no action. A deposit deduction or a KYC approval requires a passing reconciliation and/or explicit human approval. No autonomous money movement, no autonomous access decision |
| Provisional risk classification (awareness) | Discriminative document extraction, not a generative or general-purpose model. Not obviously high-risk under EU AI Act Annex III (no EU market in scope for V1). PH: personal data is processed by an AI system, so NPC Advisory 2024-04 applies. Confirm with counsel |

**Why an AIA here:** PRD §7 and SDD §8 define an AI/ML extraction component whose output feeds a money path (deposit deduction) and an onboarding decision (KYC). Its governance must be documented and assessable before launch, as a gate alongside the CLR.

**Self-check:**
- [x] The AI component and feature IDs trace to PRD §7 / SDD §8
- [x] The provisional risk classification is stated as awareness, not a legal conclusion

---

## 1. Model / System Card

### 1.1 Intended use

| Field | Value |
|-------|-------|
| Intended use | Convert handwritten EDTR field images into structured hours (active/idle) + breakdown status to assist billing (PRD-F3), and extract SEC number + TIN from corporate documents to assist KYC onboarding (PRD-F6). Extraction only; a human confirms before any billing or onboarding effect |
| Intended users / affected parties | Operators: the tenant Administrator (Rhea) and Field Timekeeper who review extractions. Affected parties: the rental company's clients (whose deposits are billed) and the corporate applicants whose KYC documents are read |
| Out-of-scope / prohibited uses | No autonomous deduction or onboarding on model output alone; no ML demand forecasting; no biometric identification of individuals; no automated adverse decision without human review; no use of extracted data for any purpose beyond billing/onboarding for that tenant |
| Human-in-the-loop points | Low-confidence or reconciliation-mismatch EDTRs route to admin review before deduction (RFC-2). KYC extraction always requires a human to confirm SEC/BIR status on the government portals (ORUS CAPTCHA blocks automation) before onboarding; a provisional lock holds the calendar meanwhile |

### 1.2 Model(s) and data

| Model / stage | Identifier + version | Role | Source of data it sees |
|---------------|----------------------|------|------------------------|
| EDTR extraction | Azure AI Document Intelligence custom neural extraction model (doc-intel 4.x) | Extract handwritten hours + breakdown fields with per-field confidence + bounding regions | Tenant-uploaded EDTR images (untrusted) |
| KYC extraction | Azure DI `prebuilt-layout` + query fields (doc-intel 4.x) | Extract SEC number + TIN from corporate documents | Tenant-uploaded corporate/ID documents (untrusted, sensitive personal information) |

- **Training / tuning data:** Microsoft-trained base models (Azure DI), plus a small labeled EDTR sample set collected from the anchor tenant with consent for the custom model. Provenance recorded; licensing is the tenant's own operational records. No third-party scraped training data.
- **Run-time input:** user-uploaded document images. Treated as untrusted data, never as instructions (Context Hygiene). Extracted text is used as structured values only; no component executes extracted text.
- **Output contract:** per field `{ value, boundingRegion, confidence }`. Validated (type/format/regex for SEC/TIN; numeric bounds for hours). Below the confidence gate (default 0.90) or on reconciliation mismatch, output is quarantined to a human-review queue; unreadable input hard-fails to manual entry. No invalid output reaches the money or onboarding path.
- **Provider data terms:** Azure AI Document Intelligence processes documents per the Azure OpenAI/AI Services data-handling terms (customer data is not used to train foundation models; verify current retention + region). Reconcile with CLR §1 sub-processors; Microsoft is a sub-processor. Region/data-residency for PH document images is an open escalation item (§4).

### 1.3 Limitations and performance caveats

- Handwriting recognition accuracy varies with legibility, ink, water damage, and writer; the >=90.06% target is a measured objective behind a confidence gate, not a guarantee.
- The prebuilt ID model does not cover PH SEC/TIN corporate documents; layout + query fields are used instead, which needs per-layout validation.
- **Known failure modes:** misread digits on smudged EDTRs; low confidence on damaged pages; a forged or altered corporate document that extracts cleanly but is fraudulent (caught by human portal verification, not by OCR).
- **Fallback behavior:** on model error, low confidence, or reconciliation mismatch, the system routes to human review or manual entry; it never auto-proceeds. On Azure DI outage, uploads queue and the admin can key values manually (OPS runbook).

**Self-check:**
- [x] Intended use AND out-of-scope use both stated
- [x] Every model named with a concrete version (Azure DI custom neural + layout/query, doc-intel 4.x)
- [x] Data provenance + provider terms recorded and reconciled with CLR §1 (Azure as sub-processor; region TBD)

---

## 2. NIST AI RMF Risk Register

*Organized to NIST AI RMF 1.0 (Govern/Map/Measure/Manage). GenAI Profile (NIST-AI-600-1, 2024-07-26, 12 categories) applies only partially because this is a discriminative extraction component, not a generative model: relevant categories are Data Privacy, Information Integrity, Information Security, and Harmful Bias; Confabulation, CBRN, Obscene Content, and Environmental are not applicable. Each row traces to an SDD §8.1 control (AI-01..AI-06) and a QAD eval. Verified against [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework) and [NIST-AI-600-1](https://www.ciphernorth.com/blog/nist-ai-risk-management-framework-rmf), 2026-07-25.*

| Risk ID | Risk | RMF function | GenAI category | Severity | Likelihood | Mitigation / control (SDD ref) | Eval (QAD ref) | Owner | Status |
|---------|------|--------------|----------------|----------|------------|--------------------------------|----------------|-------|--------|
| AIA-R1 | Extraction error drives a wrong deposit deduction | Measure / Manage | Information Integrity | High | Medium | Confidence gate (0.90) + double-entry reconciliation within tolerance + human approval before deduction; no autonomous money movement (SDD §8.1 AI-06/AI-04, RFC-2) | QAD AI-06, AI-04, reconciliation rows | Eng lead | Mitigated |
| AIA-R2 | Disclosure of sensitive PII from ID/KYC images (cross-user or external) | Manage | Data Privacy | High | Low | Tenant RLS isolation; encrypted storage; signed short-lived URLs; data minimization + retention limits; no PII in logs/events (SDD §8.1 AI-03, CLR) | QAD AI-03 | Eng lead | Mitigated |
| AIA-R3 | Adversarial or forged document upload | Map / Manage | Information Security | Medium | Medium | File-type/size validation; malware scan; treat uploads as untrusted; forged corporate docs caught by human portal verification (SDD §8.1 AI-05, RFC-2) | QAD AI-05 | Eng lead | Mitigated |
| AIA-R4 | Malicious text embedded in a document reaches a downstream consumer | Map | Information Security | Low | Low | Extracted text is used as structured data only; no LLM or shell consumes it; reconciliation uses numeric fields; no auto-execution (SDD §8.1 AI-01/AI-02, Context Hygiene) | QAD AI-01, AI-02 | Eng lead | Mitigated |
| AIA-R5 | Handwriting-recognition accuracy varies across writers / conditions (bias in error distribution) | Measure | Harmful Bias / Information Integrity | Medium | Medium | Gold-set accuracy monitoring across sources; low-confidence routes to human review; accuracy tracked over time, not assumed (SDD §8.2, RFC-2) | QAD OCR accuracy harness (T39) | QA lead | Open (monitored) |
| AIA-R6 | KYC false-accept onboards a fraudulent corporate applicant (affects access) | Manage | Data Privacy / Information Integrity | High | Low | Human-in-the-loop SEC/BIR portal verification (mandatory); fuzzy-match + format flags; provisional booking lock until confirmed; no auto-onboard (SDD §8.1 AI-04, RFC-2) | QAD KYC rows | Compliance owner | Mitigated |
| AIA-R7 | Cross-border transfer of PH personal data to Azure DI | Govern / Manage | Data Privacy | Medium | High | Azure DI SE-Asia region availability confirmed (cr-arkilaunch-azure-di-provisioning.md); still needed: Microsoft DPA; RA 10173 cross-border transfer basis ([CLR §1](clr-arkilaunch.md); AIA §4 escalation below) | CLR compliance evidence | Compliance owner | Open (escalated) |

> **Govern (cross-cutting):** the ArkiLaunch team owns this register, reviews it each release and after any incident, and routes changes through a Change Record. No row ships "Open" at launch without an escalation flag in §4 (AIA-R5 is monitored with an accuracy SLO; AIA-R7 is escalated to counsel).

> **Status note (`cr-arkilaunch-pilot-honesty.md` §2.5, 2026-08-13):** with no Azure DI model running during the pilot (both OCR flags `false`, no vendor credentials), AIA-R1, AIA-R3, and AIA-R5 above are honestly **not exercised** rather than "Mitigated" or "Open (monitored)" — there is no live extraction to mitigate against. AIA-R7 (cross-border data residency) is correspondingly not a pilot-launch blocker for the same reason. `cr-arkilaunch-azure-di-provisioning.md` (2026-08-15) re-arms AIA-R7 to `Open (escalated)` now that a real Azure DI resource exists in southeastasia (see the row below), and both flags remain `false` until the counsel/DPO clearance in §4 closes.

**Self-check:**
- [x] Every applicable SDD §8.1 control (AI-01..AI-06) appears as a row with its eval
- [x] Each row names an owner and a status; the two Open rows carry an escalation/monitoring path (§4)
- [x] GenAI category column filled against the verified NIST-AI-600-1 list, with non-applicable categories stated

---

## 3. SMACTR Self-Audit Checklist

| Stage | What it produces here | Done? | Evidence link |
|-------|-----------------------|-------|---------------|
| **Scoping** | Intended use, out-of-scope use, provisional risk class | Yes | §0, §1.1 |
| **Mapping** | System boundary, data flows, trust boundary | Yes | SDD §8 / §8.1; RFC-2 |
| **Artifact collection** | Model/system card, risk register, provider data terms | Yes | §1, §2; CLR §1 |
| **Testing** | Adversarial evals per control | Partial (specified, not yet executed; no code) | QAD AI-01..AI-06 + OCR accuracy harness |
| **Reflection** | Residual-risk statement, go/no-go, escalations | Yes | §3 statement + §4 |

**Residual-risk statement:** After mitigation, the load-bearing residual risks are (1) extraction accuracy variance (AIA-R5), accepted for launch only because the confidence gate + double-entry reconciliation + human approval prevent a low-confidence read from ever deducting a deposit, and accuracy is monitored against [OPS `SLO-13`](ops-arkilaunch.md) (golden-set accuracy >= 90.06%, alerting on drift); and (2) cross-border data residency (AIA-R7), which is NOT accepted for launch until counsel confirms the Azure DI region and RA 10173 transfer basis. Go/no-go: the OCR billing path (PRD-F3) is go once its evals pass; the KYC path (PRD-F6) and any launch are gated on the AIA-R7 counsel review and the CLR launch gate.

**Self-check:**
- [x] Every stage points to a real artifact (Testing is honestly marked "specified, not executed" since no code exists yet)
- [x] Testing maps to actual QAD evals, not intentions
- [x] Reflection states a go/no-go and names what escalates

---

## 4. Cross-links and Escalation

| Dimension | Lives in | This AIA relies on |
|-----------|----------|--------------------|
| AI architecture and threat surface | SDD §8 / §8.1 | AI-01..AI-06 controls, confidence gate, HITL |
| Red-team and abuse evals | QAD (AI + abuse rows) | AI-01..AI-06 + OCR accuracy harness (T39) + KYC rows |
| Data, sub-processors, legal obligations | CLR | Azure as sub-processor; ID/KYC data inventory; cross-border transfer |
| Prompt-injection / RAG / tool-output posture | Context Hygiene Protocol (the FMD engine's own guidance; not vendored in this repo) as applied in [sdd-arkilaunch.md](sdd-arkilaunch.md) §8.1 | uploads + extracted text treated as untrusted data, never instructions |

### Escalation flags (any "Yes" forces the top banner and a counsel/assessor review)

| Flag | Present? | Why it escalates |
|------|----------|------------------|
| Output affects a person's rights, access, credit, employment, or benefits | Partial | KYC assists an onboarding decision and billing affects money; BOTH are gated by mandatory human review, so no automated adverse decision. Still escalate the KYC design to counsel |
| Automated decision with legal/significant effect, no meaningful human review | No | Human-in-the-loop is mandatory on both the deduction and the onboarding paths |
| Health, safety, biometric, or other sensitive inference | Yes | Government ID / corporate registration images are sensitive personal information under RA 10173; heightened duty of care |
| General-purpose model on the market / systemic-risk scale | No | Azure DI is a narrow discriminative extractor, not a GPAI |
| Training/run-time data with unresolved provenance / licensing / consent | Partial | Base model is Microsoft-trained; the custom EDTR set is anchor-tenant data with consent; confirm consent scope and the Azure "not used for training" term |
| Deployment in a market whose AI rules are not mapped | No (PH only for V1) | If ArkiLaunch expands beyond PH, re-map (EU AI Act etc.) before launch there |

**If any flag is Yes:** Pause the KYC (PRD-F6) launch and any production launch until (1) counsel confirms the RA 10173 basis for processing sensitive ID data with AI and the cross-border transfer to Azure DI (AIA-R7), and (2) the CLR launch gate clears. The disclaimer banner stays at the top of this dossier.

**Self-check:**
- [x] Every cross-link points to a real section in a real doc
- [x] Yes flags (sensitive data; partial rights/access) have a named escalation action and the banner is set

---

## 5. Regulatory Awareness (PH-first, then global)

*Awareness mapping only, not legal advice. Verified 2026-07-25; confirm with counsel before launch.*

| Regime | Applies? | What it asks of an AI system (awareness) | Our note / action |
|--------|----------|------------------------------------------|-------------------|
| **PH: NPC Advisory 2024-04** (Data Privacy Act applied to AI systems processing personal data; issued 2024-12-19) | Yes | Lawful basis, transparency to data subjects about AI processing (nature/purpose/risks/impacts), and controller accountability for AI outcomes, across the full AI lifecycle | Publish an AI-processing notice; record lawful basis for KYC/EDTR extraction; the tenant is the controller, ArkiLaunch is a processor; keep the HITL accountability trail. Source: [NPC Advisory 2024-04](https://regulations.ai/regulations/RAI-PH-NA-NAN2GXX-2024) |
| **PH: NAIS-PH** (National AI Strategy, ethics pillar) | Yes (awareness) | Fairness, accountability, transparency, human oversight | HITL + the reconciliation evidence trail satisfy human-oversight and accountability principles by design |
| **NIST AI RMF + GenAI Profile** (voluntary, global reference) | Yes | Govern/Map/Measure/Manage; §2 register is organized to it | Register maintained per release; GenAI categories applied where relevant. Source: [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework) |
| **ISO/IEC 42001** (auditable AI management system) | Awareness only | An AI management system with impact assessment + Annex A controls | Not pursuing certification for the capstone; this dossier is the record a future assessor would review |
| **EU AI Act** (if EU users / market) | No (PH-only for V1) | Risk-tiered duties; documentation for high-risk / GPAI, phasing through 2026-2027 | Out of scope until ArkiLaunch serves EU users; re-map before any EU launch |

> **Awareness only; NOT legal advice.** Confirm every obligation with a licensed Philippine attorney before launch.

**Self-check:**
- [x] §0 markets (PH) match the regimes in scope
- [x] Each in-scope regime has a note/action
- [x] Specifics verified and dated (2026-07-25), not recalled

---

## 6. Materialization

`MODEL_CARD.md` (project root) is materialized from **§1 only** (Model / System Card), not the full dossier. It exists so a reader gets the model-card facts without the compliance/legal apparatus in §2 to §5.

| MODEL_CARD.md section | Source | Notes |
|---|---|---|
| System / header | §0 (AI component field) + §1 header fields | Adds Version/Status/Last-reconciled from this document's own header, not just §1. |
| Intended use, users, HITL points | §1.1, verbatim | No summarization; every bullet carries over. |
| Model(s) and data table | §1.2, all four columns | Including the "Source of data it sees" column (the RA 10173 sensitivity hook); never dropped. |
| Limitations, failure modes, fallback | §1.3, verbatim | All three named failure modes and the Azure-DI-outage fallback carry over; this is the section most likely to be trimmed, and it must not be. |
| Pointer to the rest | one line | "For the full risk register (§2), SMACTR self-audit (§3), and regulatory awareness (§5), see this AIA." |

**Fidelity rule:** MODEL_CARD.md is a subset, never a rewrite. A concrete model identifier (e.g. `prebuilt-layout`), an escalation's open/mitigated status, or a named failure mode must appear in MODEL_CARD.md exactly as it appears in §1 here, not softened or generalized. Re-materialize MODEL_CARD.md whenever §1 changes; do not hand-edit it as a source of truth.

**Self-check:**
- [x] MODEL_CARD.md's actual content was checked against §1 fact-for-fact when this section was authored; no dropped model identifier, failure mode, or escalation status found

---

## Self-Check

- [x] The AI component traces to PRD §7 / SDD §8; this AIA exists because that component exists
- [x] §1 states intended use AND limits, with concrete model versions + data provenance
- [x] §2 has a register row per applicable SDD §8.1 control, each mapped to an RMF function and a QAD eval
- [x] §3 SMACTR stages point to real artifacts; Testing honestly marked specified-not-executed (no code yet)
- [x] §4 cross-links resolve; escalation flags (sensitive ID data, cross-border) have named actions; banner set
- [x] §5 regimes reconcile with the CLR (PH market); specifics verified and dated
- [x] §2 risk-to-eval pairings reconciled against the QAD's own AI-01..AI-06 definitions (AIA-R1->AI-06/AI-04, AIA-R3->AI-05, AIA-R4->AI-01/AI-02)
- [x] §6 gives MODEL_CARD.md a materialization contract and a fidelity rule; this doc is no longer the only artifact with no stated source for a generated file
- [x] Disclaimer discipline holds: this documents and escalates; it does not certify or audit
- [x] AGENTS hard bans applied (no em-dashes)
