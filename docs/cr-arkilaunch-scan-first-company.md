# Change Record

**Title:** Scan-first company onboarding: sequential Government ID then Company Registration, with the manual form last
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

## 3. What changed

- `POST /me/kyc/scan` (new): `booking:create`, throttled 5/min, multipart `file`, validated by the existing `validateUpload`. Returns `{ suggestions: { companyName, tin, secNumber }, extractionAvailable }`.
  - It is a typing aid, not a KYC step. It writes **no** `kyc_documents` row, makes no verification decision, and emits no confidence events. Staff review the uploaded document under RFC-2's human gate exactly as before.
  - A suggestion that fails `TIN_REGEX` or `SEC_REGEX` is dropped rather than offered.
  - With no extraction adapter available (the `ENABLE_OCR_KYC` flag off, or no credentials) it returns nulls and `extractionAvailable: false`, and the form opens empty. Nothing is invented (`cr-arkilaunch-pilot-honesty.md` §2).
- `KYC_QUERY_FIELDS` gains `CompanyName`, mapped to the port key `company_name`. Azure DI allows up to 20 query fields; this is the third.
- `CustomersModule` now binds `DOCUMENT_INTELLIGENCE_PORT` through the same fail-closed `createDocumentIntelligenceAdapter()` factory `KycModule` uses.
- Web `/account/companies/new` is three steps: Government ID, Company Registration, then the prefilled form. The form says whether it was filled from the scan or not, and offers "Rescan".
- Web `/account/companies/$companyId/documents` is two steps in the same order.

## 4. Deliberately not claimed

- Each scan is an Azure DI page spend charged to the tenant, now triggerable by a customer. The rate limit is 5/min per login, tighter than the staff endpoint's 10/min. No monthly cap per tenant exists yet.
- The scanned bytes are not stored by the scan endpoint. The document is stored when the form is submitted and the upload runs, so a customer who abandons the flow leaves nothing behind. A scan of one document and a submission of another is therefore possible, and is exactly what staff review catches.
- `companyName` has no format check to fail, so it is suggested at whatever confidence Azure DI returns. The customer corrects it, and staff verify against the document.
- The billing address, contact person and contact mobile are still typed. They are not on the registration certificate.
- The government ID is not read at all. It is captured for staff review only.
