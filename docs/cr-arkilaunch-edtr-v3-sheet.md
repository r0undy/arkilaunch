# Change Record

**Title:** EDTR v3 paper sheet: tenant-branded, Letter/Legal, one hour column per cause, hour-meter readings
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Draft` (code in progress)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow; admin feedback 2026-09-27 (item 6 of 6)
**Docs touched by this record:** [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §3 (sheet layout / parser contract), extends [cr-arkilaunch-edtr-v2-weather.md](cr-arkilaunch-edtr-v2-weather.md), [index.md](index.md) §2

---

## 1. Problems with v2

1. One idle number and one reason tick per day: a day with customer idle **and** breakdown cannot be written down, so billable hours are wrong either way.
2. "TOTAL HOURS" did not say whether it included idle or downtime.
3. No hour-meter reading, so running time was self-reported with no objective check.
4. Days outside the rental were printed like any other day.
5. The header lacked the booking code, site rep, operator and rental period; the footer ref was a UUID slice.
6. A4 was hard-coded twice (the SVG size and the PDF page), so changing one silently stretched the scan.
7. The customer never saw, on the paper they sign, what they are billed for.

## 2. v3 layout

- **Header band:** tenant logo (embedded as a data URI so the PNG/PDF are self-contained), name, address and contact on the left. The title and "Form EDTR v3 · Sheet i of n" in the centre. The QR and the booking code in large mono type on the right. Colour only in the header rule; the grid is black ink only.
- **Job details:** the Almara 2×2 (`CHARGE TO / EQPT. TYPE / PROJECT LOCATION / DATE COVERED`) kept in place, plus `OPERATOR`, `CLIENT SITE REP`, `RENTAL PERIOD`, `HOUR METER AT START OF WEEK`.
- **How to fill:** four numbered one-line steps.
- **Grid (7 rows):** `DATE`, `DAY`, `AM`/`PM`/`OVERTIME` `IN`/`OUT`, `TOTAL HOURS`, `RUNNING HRS`, `IDLE HRS`, `BREAKDOWN HRS`, `WEATHER HRS`, `OTHER HRS`, `METER START`, `METER END`, `WEATHER AM`/`PM` ticks, `INITIAL`. The rule `TOTAL = RUNNING + IDLE + BREAKDOWN + WEATHER + OTHER` is printed under it. The `IDLE REASON` tick group is gone.
- **Outside-rental days** keep their date (the parser needs one in every DATE cell), get a light hatch and "OUTSIDE RENTAL — DO NOT FILL". The API rejects them (cr-arkilaunch-edtr-site-hub-approval.md).
- **Week summary**, **"What you are billed for"**, four signature blocks (operator, timekeeper, client site rep, office verified/approved by) and a footer with booking code, unit serial, week, printed date and page size.
- **Page:** one `PAGE` constant drives the SVG size, the PNG pixels and the PDF points. Letter 279.4 × 215.9 mm or Legal 355.6 × 215.9 mm landscape; Legal is the default.
- **File name:** `edtr-v3-EQR-2026-0001-<serial>-<week>.pdf`.

## 3. Parser contract

- QR prefix `ARKI-EDTR3:` marks a v3 sheet; the payload is otherwise unchanged (`rental:equipment:week`, no tenant, RFC-1).
- New header labels `RUNNING HRS`, `IDLE HRS`, `BREAKDOWN HRS`, `WEATHER HRS`, `OTHER HRS`, `METER START`, `METER END`. On a v3 sheet `hoursActive` = RUNNING (not TOTAL), and `TOTAL` becomes a cross-check.
- **v2 sheets keep parsing unchanged** during the transition: no `RUNNING HRS` column means v2 semantics.
- `EdtrSheetContext` gains `bookingCode`, `customerName`, `siteRep`, `rentalStart`/`rentalEnd`, per-unit `operatorName` and `lastHourMeter`, and `tenant { name, address, contact, logoUrl }`. Built server-side (tenant from the JWT, RFC-1).

## 4. Tests

`packages/shared/src/edtr-sheet.spec.ts`: v3 columns, v2 back-compat, an outside-rental hatch row left blank. `packages/shared/src/edtr.spec.ts`: `classifyHours` and `validateDayEntry`.

## 5. Deliberately not claimed

- The round trip through the real Azure DI layout model on a printed v3 sheet has not been run: there is no DI fixture for v3 yet. Until one is captured, v3 sheets go through manual transcription, which is how every sheet is read while `ENABLE_OCR_PIPELINE` is off.
