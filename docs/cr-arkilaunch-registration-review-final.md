# Change Record

**Title:** Registration review is approve-or-reject on what the customer submitted; rejections carry a reason and a cure
**Project:** ArkiLaunch
**Date:** 2026-09-26
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user feedback 2026-09-26 (item 2)
**Docs touched by this record:** [cr-arkilaunch-feedback-batch.md](cr-arkilaunch-feedback-batch.md) (supersedes its "reviewer comments and unlocks fields" row), [index.md](index.md) §2

---

## 1. What changed

| Area | Change | Migration |
|---|---|---|
| Admin review card | What the customer submitted (name off the National ID, registered name, TIN, SEC and DTI numbers) is shown read-only beside the scan hint. The "Re-read" buttons and the "Ask the customer to fix something" comment/unlock form are removed. | none |
| API | `PATCH /customers/:id/review` (comment + unlock) is removed. `PATCH /customers/:id/kyc` no longer takes `companyName`, `tin`, `secNumber`, `dtiNumber` or the name fields; unknown keys are stripped. Approval writes the name the customer confirmed on their National ID (else the scan they saw) onto their user account. | none |
| Rejection | Requires `rejectionReason` (`bir_cor_invalid`, `sec_not_active`, `dti_expired`, `registry_mismatch`, `id_invalid`, `document_unreadable`, `other`); `other` also requires `rejectionNote`. The reason, note and the documents that would cure it (`REJECTION_REASONS`) are stored in `customers.review_comment` and sent in the `company_rejected` notification. | none (reuses `review_comment`) |
| Finality | A rejected company cannot be decided again (`already_decided`). The customer registers the company anew from `/account/companies/new` with valid documents; the rejected record stays as history. | none |

`customers.unlocked_fields` is kept (always `[]` from now on) so the customer-side form and old rows stay readable. Removing it is a separate, paired migration if ever wanted.

## 2. Why

A reviewer editing the values meant the verified record could say something the customer never submitted, and the unlock round-trip blurred a decision that should be binary. The reviewer now judges the customer's own submission, and when that fails the customer is told exactly what fixes it.

## 3. Rejection reasons and what cures them

| Reason | What the customer brings to a fresh registration |
|---|---|
| BIR COR outdated or not matching ORUS | An updated BIR Form 2303, reissued after any change in address, line of business or tax type, that matches ORUS. (The 2303 has no expiry; since the 2024 Ease of Paying Taxes Act the annual ₱500 registration fee is gone, so an "expired" COR really means an outdated one.) |
| SEC suspended, revoked or delinquent | An SEC Certificate of Good Standing, or the SEC Order lifting the suspension/revocation, with the latest GIS and its filing acknowledgement. A revoked corporation that has not been reinstated cannot be cured; reject it. |
| DTI business name expired | The renewed DTI Business Name Certificate (5-year validity). |
| Details do not match the registry | Documents matching SEC/BIR/DTI exactly, or the amended certificate after a name change. |
| National ID invalid | A clear PhilSys ID or ePhilID of the owner or an authorized officer, plus a Secretary's Certificate or board resolution if they are not the owner. |
| Document unreadable | A full, uncropped scan of the same documents. |

## 4. National ID: recommended verification (not built here)

1. **PhilSys QR check.** Scan the QR on the PhilSys ID / ePhilID with PSA's official verifier (verify.philsys.gov.ph or the PhilSys Check app). The signed QR proves the card data was issued by PSA; compare its name, birth date and photo to the upload. This is the strongest check available without an API agreement.
2. **Name match to the registrant.** The ID holder must be the sole proprietor on the DTI certificate, or an officer/incorporator on the SEC GIS; otherwise require a Secretary's Certificate or board resolution naming them.
3. **Image integrity.** Front and back, no cropping over the PCN, photo or QR; look for mismatched fonts or edited digits (the "Edited by customer" tag already flags a PCN that differs from the scan).
4. **Later, if volume justifies it:** a selfie-with-liveness match against the ID photo, or PSA's PhilSys authentication service (needs a PSA relying-party agreement and a privacy impact assessment under the Data Privacy Act).
