# ArkiLaunch Model / System Card

*Materialized from [docs/aia-arkilaunch.md](docs/aia-arkilaunch.md) §1. Governance and assurance-readiness documentation, not a certification or audit. Edit the AIA and re-materialize; do not hand-edit as a source of truth.*

**System:** ArkiLaunch OCR / Intelligent Document Processing component
**Date:** 2026-07-25
**Owner:** ArkiLaunch Team (Almara Construction capstone)

## Intended use

ArkiLaunch uses Azure AI Document Intelligence to (1) read handwritten Equipment Daily Time Reports and extract active/idle hours and breakdown status to assist billing (PRD-F3), and (2) extract SEC number and TIN from corporate documents to assist KYC onboarding (PRD-F6). Extraction only. A human confirms every result before any billing or onboarding effect.

- **Intended users:** the tenant rental-company administrator and field timekeeper who review extractions.
- **Affected parties:** the rental company's clients (whose deposits are billed) and the corporate applicants whose KYC documents are read.
- **Human-in-the-loop:** low-confidence or reconciliation-mismatch EDTRs route to admin review before any deduction; KYC extraction always requires a human to confirm SEC/BIR status on the government portals before onboarding.

## Out-of-scope / prohibited uses

No autonomous deposit deduction or onboarding on model output alone; no machine-learning demand forecasting; no biometric identification; no automated adverse decision without human review; no use of extracted data beyond billing/onboarding for that tenant.

## Models and data

| Stage | Model | Role |
|-------|-------|------|
| EDTR extraction | Azure AI Document Intelligence custom neural extraction (doc-intel 4.x) | Extract handwritten hours + breakdown with per-field confidence and bounding regions |
| KYC extraction | Azure DI layout + query fields (doc-intel 4.x) | Extract SEC number + TIN (the prebuilt ID model does not cover PH corporate documents) |

- **Training data:** Microsoft-trained base models plus a small labeled EDTR sample set from the anchor tenant, collected with consent.
- **Run-time input:** user-uploaded document images, treated as untrusted data and never as instructions.
- **Output contract:** per field value, bounding region, and confidence. Validated; below the 0.90 confidence gate or on reconciliation mismatch, output is quarantined to human review; unreadable input hard-fails to manual entry.
- **Provider terms:** documents are processed by Azure under its AI Services data-handling terms (customer data is not used to train foundation models; region and retention to be verified). Microsoft is a sub-processor; reconcile with the CLR.

## Limitations and performance caveats

- Handwriting recognition accuracy varies with legibility, ink, water damage, and writer. The >=90.06% target is a measured objective behind a confidence gate, not a guarantee.
- Known failure modes: misread digits on smudged EDTRs; a forged corporate document that extracts cleanly but is fraudulent (caught by human portal verification, not by OCR).
- Fallback: on model error, low confidence, or reconciliation mismatch, the system routes to human review or manual entry; it never auto-proceeds.

For the full risk register (NIST AI RMF), SMACTR self-audit, and regulatory awareness (NPC Advisory 2024-04), see [docs/aia-arkilaunch.md](docs/aia-arkilaunch.md).
