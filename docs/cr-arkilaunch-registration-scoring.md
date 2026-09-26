# Change Record

**Title:** Registration review: one clean field list, a server-side confidence score with a per-check breakdown
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Draft` (code in progress)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow; admin feedback 2026-09-27 (item 3 of 6)
**Docs touched by this record:** [prd-arkilaunch.md](prd-arkilaunch.md) PRD-F6 US-06 (review screen), [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §KYC (scoring is advisory; the human gate is unchanged), [index.md](index.md) §2

---

## 1. Why

The pending-review screen tagged every customer-edited field "Edited by customer", listed some fields twice, and had no overall read of how trustworthy an application is.

## 2. Decisions (confirmed with the user 2026-09-27)

- Each field is shown once, in a two-column list grouped as **Company**, **Contact person**, **ID document** and **Business documents**. Document thumbnails open full size.
- A field that disagrees with its scan shows a subtle `scan: …` hint instead of a tag.
- **Confidence** is a small pill (`92% · High`) that expands to a checklist (✓ / ! with a one-line reason per check).

## 3. `scoreRegistration()` (`packages/shared/src/kyc.ts`, pure, unit-tested)

Weighted checks:

| Check | Weight | Pass when |
|---|---|---|
| OCR field confidence | 25 | mean confidence of the read fields ≥ 0.90 (scaled below) |
| Typed vs scan agreement | 25 | normalised compare for IDs and dates; token-sorted Levenshtein ≥ 0.85 for names and addresses |
| ID formats | 20 | PCN 16 digits, TIN `###-###-###(-###)`, SEC registration number pattern |
| Date of birth | 10 | age 18–100 |
| Duplicates | 10 | no other customer in the tenant with the same TIN, PCN or mobile |
| Document quality | 10 | every required document present and its lowest field confidence ≥ 0.70 |

A failed **hard** check (duplicate, invalid ID format) caps the score at Low. Bands: High ≥ 85, Medium ≥ 60, else Low.

The score is **advisory**. It never approves or rejects; the staff decision stays the human gate (RFC-2 KYC path).

## 4. Deliberately not claimed

The score is not calibrated against labelled outcomes; the weights are a reasoned starting point to tune once there are enough decided applications.
