# Change Record

**Title:** Scan-first company onboarding: sequential Government ID then Company Registration, the manual form last, and an OCR-assisted staff review
**Project:** ArkiLaunch
**Date:** 2026-09-22
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user request, 2026-09-22; supersedes "Uploaded documents are not OCR'd" in [cr-arkilaunch-customer-prerequisites.md](cr-arkilaunch-customer-prerequisites.md) §4
**Docs touched by this record:** [index.md](index.md) §2

---

## 1. Why

"Add New Company" asked for both verification documents on the same screen as every field. Two problems:

- A customer on a phone was asked to frame two different papers at once, with a viewfinder for each open side by side.
- Every field was typed by hand, although the registration certificate carries the registered name and the TIN, and Azure DI already reads exactly those for staff (`POST /kyc/extract`).

## 2. Decisions (confirmed with the user 2026-09-22)

- **The two captures are sequential.** Government ID is step 1, Company Registration is step 2. They are never on screen together.
- **The scan comes first and the form comes last.** The registration capture is sent for extraction, and the form opens on what was read, for final edits.
- **Both the add-company flow and the upload-later screen are sequential.** The upload-later screen does not scan: the company already exists, so there is nothing to prefill.
- **The reviewer gets the same help, on demand.** A reviewer clicks "Read document" on a company in the queue, the fields fill in from the registration certificate, the reviewer corrects whatever is wrong, and approving writes what they confirmed onto the company.
- **Extraction on the admin side is a click, not automatic on upload.** Nothing is spent on a document nobody reviews, and a reviewer can re-run it.
- **Liveness/selfie verification was considered and declined for now** (discussed 2026-09-22): it verifies the person, not the company registration, which is what this gate is about; it makes face templates sensitive personal information under RA 10173, with the consent, retention and NPC obligations that follow; and the existing human review already holds the payment gate. Revisit if forged registration certificates actually appear, or a client demands it.

## 3. What changed

- `POST /me/kyc/scan` (new): `booking:create`, throttled 5/min, multipart `file`, validated by the existing `validateUpload`. Returns `{ suggestions: { companyName, tin, secNumber }, extractionAvailable }`.
  - It is a typing aid, not a KYC step. It writes **no** `kyc_documents` row, makes no verification decision, and emits no confidence events. Staff review the uploaded document under RFC-2's human gate exactly as before.
  - A suggestion that fails `TIN_REGEX` or `SEC_REGEX` is dropped rather than offered.
  - With no extraction adapter available (the `ENABLE_OCR_KYC` flag off, or no credentials) it returns nulls and `extractionAvailable: false`, and the form opens empty. Nothing is invented (`cr-arkilaunch-pilot-honesty.md` §2).
- `KYC_QUERY_FIELDS` gains `CompanyName`, mapped to the port key `company_name`. Azure DI allows up to 20 query fields; this is the third.
- `CustomersModule` now binds `DOCUMENT_INTELLIGENCE_PORT` through the same fail-closed `createDocumentIntelligenceAdapter()` factory `KycModule` uses.
- Web `/account/companies/new` is three steps: Government ID, Company Registration, then the prefilled form. The form says whether it was filled from the scan or not, and offers "Rescan".
- Web `/account/companies/$companyId/documents` is two steps in the same order.
- `POST /customers/:id/documents/:documentId/read` (new): `quote:approve`, throttled 10/min. Downloads the stored document through a signed URL, extracts it, and saves `ocr_payload`, `format_valid` and `confidence` on that `kyc_documents` row, moving it to `needs_review`. It never sets `verified` and never touches `kyc_status`. The reported confidence is the **lowest** of the fields found, so a reviewer judges a document by its weakest field. A value failing its format check is returned *with* `formatValid: false` rather than hidden, because "TIN read as 12-34, format invalid" informs a reviewer and silence does not.
- `PATCH /customers/:id/kyc` accepts optional `companyName`, `tin` and `secNumber`. On **approve** the name and TIN are written onto the company; on **reject** nothing is written. `customers` has no SEC column, so the confirmed SEC number is stored on the registration document's `ocr_payload` as `confirmed_sec_number` with `confirmed_by`.
- Web `/app/registration/pending`: each company card gains "Read document", three editable fields (registered name, TIN, SEC/DTI number), a confidence line naming any format failure, and Verify/Reject that submit the reviewer's values.
- No migration: `ocr_payload`, `format_valid` and `confidence` already exist on `kyc_documents` from the prerequisites CR.

## 4. Deliberately not claimed

- Each scan is an Azure DI page spend charged to the tenant, now triggerable by a customer. The rate limit is 5/min per login, tighter than the staff endpoint's 10/min. No monthly cap per tenant exists yet.
- The scanned bytes are not stored by the scan endpoint. The document is stored when the form is submitted and the upload runs, so a customer who abandons the flow leaves nothing behind. A scan of one document and a submission of another is therefore possible, and is exactly what staff review catches.
- `companyName` has no format check to fail, so it is suggested at whatever confidence Azure DI returns. The customer corrects it, and staff verify against the document.
- The billing address, contact person and contact mobile are still typed. They are not on the registration certificate.
- The government ID is not read at all. It is captured for staff review only, on both the customer and admin sides.
- The reviewer's corrections are not diffed against what the customer typed. The company row is overwritten, and the audit log records that an approval happened, not which fields moved.
- There is no SEC or BIR portal check behind the reviewer's SEC number. It remains what RFC-2 says it is: a human reading a document, with the BIR ORUS CAPTCHA still blocking automation.
- Re-reading a document overwrites the previous `ocr_payload` for that row rather than keeping a history of reads.
