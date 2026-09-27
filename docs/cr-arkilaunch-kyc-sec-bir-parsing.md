# Change Record

**Title:** KYC reads the SEC Certificate of Incorporation and BIR Form 2303 by their printed labels, and accepts 5-digit TIN branch codes
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Draft` (awaiting user testing; no PR)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §3 KYC sub-flow (TIN format), [index.md](index.md) §2

---

## 1. Why

KYC extraction was Azure DI `prebuilt-layout` + `queryFields` alone. It was run on 2026-09-27 against five real certificates: a pre-eSPARC SEC COI, a 2022 eSPARC COI, the official 2024 SEC digital COI sample, a 1997 BIR 2303, and an annotated 2019 BIR 2303 template. Measured results:

| Paper | SEC number | Registration date | Address offered |
|---|---|---|---|
| SEC COI legacy | right | unparsed text ("this 24th day of April, Twenty Twenty Three.") | the SEC's own Mandaluyong office |
| SEC COI eSPARC 2022 | **missing** (returned under `BusinessNameNumber`) | **wrong**: Feb 23, 2019, the Revised Corporation Code's effectivity date | the SEC's Baguio office |
| SEC digital COI 2024 | **missing** (same) | **wrong** (same) | the SEC's Makati HQ |
| BIR 2303 1997 | n/a | right, but not kept for BIR | right |

The SEC address was prefilled into the customer's billing address. Separately, BIR is moving TINs to a 5-digit branch code (`000-000-000-00000`, eBIRForms under RMC 36-2026), which `TIN_REGEX` rejected.

## 2. What changed

- **Page text through the port.** `DocumentExtractionResult.text` carries the content, words (with confidence) and lines (with page-normalised polygons), following the `tables?` precedent. It is used in memory only and never persisted.
- **`parseRegistrationCertificate()`** (`packages/shared/src/kyc-certificate.ts`) is pure and unit-tested offline.
  - **SEC:** the number comes after `COMPANY REG. NO.`. The name sits between "Articles of Incorporation and By-Laws of" and "were duly approved", with the `DOING BUSINESS UNDER` trade name and any watermark line excluded. The date is taken only from the IN WITNESS WHEREOF clause, with written-out years.
  - **BIR:** read by position, each label's value being what sits in its ruled box. Four fields are read:
    - TIN, with a 3- or 5-digit branch
    - taxpayer name
    - registered address
    - business-block registration date (never `TIN ISSUANCE DATE`)

    For an individual (sole proprietor) the company name is the **trade name** (user decision), falling back to the taxpayer name.
  - A value's confidence is its weakest OCR word.
- **Merge.** For SEC/BIR the parser is primary and queryFields fill gaps, except that the query's date is dropped on a recognised SEC certificate. The SEC certificate no longer offers an address. BIR now keeps its registration date.
- **Wrong paper.** A scan whose text is not the chosen paper returns `layoutRecognized:false`, and the customer is shown a warning with a Retake button. The stored read gets `ocr_payload.layout='unrecognized'`, shown to the reviewer as a note, and the advisory score's document-quality check drops to warn. The upload is still accepted; the reviewer rejects with a reason, as before.
- **TIN.** `TIN_REGEX`, `normalizeTin`, `TinSchema` and the web pattern accept 14 digits. Scoring compares TINs with `sameTin`, so a missing branch equals `000`.
- **SEC number.** `normalizeSecNumber` removes OCR/typed spaces.

## 3. Verified

- All needed fields on the four real certificates were read correctly after the change, at confidence ≥ 0.95. The template's placeholders (`000-000-000-0000`) are not read as a TIN.
- New `kyc-certificate.spec.ts`, fixtures shaped like the captured output with synthetic identifiers. Covered:
  - all five layouts
  - a 2° tilted photo
  - sole proprietor vs corporation
  - a wrapped name
  - OCR digit repair
  - wrong-paper cases

## 4. Not claimed

- No real filled 2019/ORUS 2303 was available; that layout is verified on the template's geometry plus a synthetic fill.
- On F0 (`AZURE_DI_MAX_PAGES=2`) the 3-page eSPARC digital COI PDF hard-fails in dev.
- For a sole proprietor, the ORUS link copies the trade name. The reviewer reads the taxpayer name off the image.
- DTI parsing and the legacy `/kyc` endpoint are unchanged. AIA-R7 (cross-border transfer) is still open; the live run used user-supplied public samples.
- Pre-merge gates `ai-ocr-abuse-runner` and `restraint-guardian`: pending, to run before the PR.
