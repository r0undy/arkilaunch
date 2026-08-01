# ArkiLaunch Model / System Card

*Materialized from [docs/aia-arkilaunch.md](docs/aia-arkilaunch.md) §1 (contract: AIA §6). Governance and assurance-readiness awareness only; NOT an audit and NOT a certification. Edit the AIA and re-materialize; do not hand-edit as a source of truth.*

**System:** ArkiLaunch OCR / Intelligent Document Processing component
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with code)

## Intended use

ArkiLaunch uses Azure AI Document Intelligence to (1) read handwritten Equipment Daily Time Reports and extract active/idle hours and breakdown status to assist billing (PRD-F3), and (2) extract SEC number and TIN from corporate documents to assist KYC onboarding (PRD-F6). Extraction only. A human confirms every result before any billing or onboarding effect.

- **Intended users:** the tenant Administrator (**Rhea**) and Field Timekeeper who review extractions.
- **Affected parties:** the rental company's clients (whose deposits are billed) and the corporate applicants whose KYC documents are read.
- **Human-in-the-loop:** low-confidence or reconciliation-mismatch EDTRs route to admin review before any deduction (RFC-2). KYC extraction always requires a human to confirm SEC/BIR status on the government portals before onboarding (ORUS CAPTCHA blocks automation); a provisional lock holds the calendar meanwhile.

## Out-of-scope / prohibited uses

No autonomous deposit deduction or onboarding on model output alone; no machine-learning demand forecasting; no biometric identification; no automated adverse decision without human review; no use of extracted data beyond billing/onboarding for that tenant.

## Models and data

| Stage | Model | Role | Source of data it sees |
|-------|-------|------|-------------------------|
| EDTR extraction | Azure AI Document Intelligence custom neural extraction (doc-intel 4.x) | Extract handwritten hours + breakdown with per-field confidence and bounding regions | Tenant-uploaded EDTR images (untrusted) |
| KYC extraction | Azure DI **`prebuilt-layout`** + query fields (doc-intel 4.x) | Extract SEC number + TIN (the prebuilt `idDocument` model does not cover PH corporate identifiers; layout + query fields are used instead, which needs per-layout validation) | Tenant-uploaded corporate/ID documents (untrusted, **sensitive personal information**) |

- **Training data:** Microsoft-trained base models (Azure DI), plus a small labeled EDTR sample set collected from the anchor tenant with consent for the custom model. Provenance recorded; licensing is the tenant's own operational records. **No third-party scraped training data.**
- **Run-time input:** user-uploaded document images, treated as untrusted data and never as instructions.
- **Output contract:** per field `{ value, boundingRegion, confidence }`. Validated (type/format/regex for SEC/TIN; numeric bounds for hours); below the 0.90 confidence gate or on reconciliation mismatch, output is quarantined to human review; unreadable input hard-fails to manual entry.
- **Provider terms:** documents are processed per the **Azure OpenAI/AI Services** data-handling terms (customer data is not used to train foundation models; verify current retention + region). Microsoft is a sub-processor; reconcile with the CLR §1 sub-processors. **Region/data-residency for PH document images is an open escalation item (AIA §4), not yet resolved.** This is the dossier's one launch-blocking item.

## Limitations and performance caveats

- Handwriting recognition accuracy varies with legibility, ink, water damage, and writer. The >=90.06% target is a measured objective behind a confidence gate, not a guarantee.
- The prebuilt ID model does not cover PH SEC/TIN corporate documents; layout + query fields are used instead, which needs per-layout validation.
- **Known failure modes:** misread digits on smudged EDTRs; **low confidence on damaged pages**; a forged **or altered** corporate document that extracts cleanly but is fraudulent (caught by human portal verification, not by OCR).
- **Fallback:** on model error, low confidence, or reconciliation mismatch, the system routes to human review or manual entry; it never auto-proceeds. **On Azure DI outage, uploads queue and the admin can key values manually (OPS runbook).**

For the full risk register (NIST AI RMF), SMACTR self-audit, and regulatory awareness (NPC Advisory 2024-04), see [docs/aia-arkilaunch.md](docs/aia-arkilaunch.md).
