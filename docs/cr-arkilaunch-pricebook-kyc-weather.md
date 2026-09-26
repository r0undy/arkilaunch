# Change Record

**Title:** Fixed price book, approve-or-reject registration review with cure documents, per-equipment PAGASA weather levels
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Applied` (code and migrations 0054-0056 on branch `feat/pricebook-kyc-weather`; migrations not yet run against the shared database)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow (admin feedback)
**Docs touched by this record:** [rfc-arkilaunch-quotation-pricing-engine.md](rfc-arkilaunch-quotation-pricing-engine.md) RFC-3 (quote origination, §1), [prd-arkilaunch.md](prd-arkilaunch.md) PRD-F1 quotes, customer KYC review, PRD-F5 weather (§1-§3), [cr-arkilaunch-feedback-batch.md](cr-arkilaunch-feedback-batch.md) (reviewer comment/unlock superseded, §2), [sdd-arkilaunch.md](sdd-arkilaunch.md) §4 endpoints (new routes below), [index.md](index.md)

---

## 1. Quotes: one fixed price book

**Before:** the Quotes tab was a free builder. Staff picked a customer company and priced lines by hand, with mobilization and demobilization defaults that could be overridden per quote.

**Now:**

- **The Quotes tab is the price book.** It is one set of prices for every client and prospect:
  - equipment rental rates, one price per **equipment type × size class** (mini, small, medium, large, extra large; each type gets its own bands, e.g. excavator under 6 t / 6-15 t / 15-30 t / 30-50 t / over 50 t);
  - the rental-only **mobilization and demobilization** fees.
- **Trucking is separate.** It keeps its per-trip truck and toll pricing and has no mob/demob.
- **Size classes.** Each fleet unit carries a size class (`equipment.size_class`) and a card can name one (`rate_cards.size_class`). Migration 0054 adds both; nullable, so every existing card and unit stays type-wide.
- **Auto-quote lookup.** When a booking is made, the machine is priced from, in order: the unit's own card, then its type × size-class card, then the type-wide card. That quote is sent to the customer straight away (unchanged mechanism).
- **Admin changes only through negotiation.** `POST /quotes` from staff now requires a booking (`quote_requires_booking`). Once the booking has a quote, a new one or a `/revise` needs an open negotiation: the customer declined the quote, or wrote in the thread after it was issued (`quote_not_in_negotiation`). The builder opens only from a booking ("Send a revised quote").
- **Settings.** The rate-card list and the mob/demob fields moved out of Settings into the Quotes price book.

## 2. Registration review: approve or reject, never edit

Supersedes the reviewer comment/unlock flow from [cr-arkilaunch-feedback-batch.md](cr-arkilaunch-feedback-batch.md).

- **Read-only review.** The reviewer sees what the customer submitted, with the scan beside it. They cannot edit fields, and `PATCH /customers/:id/review` (comment + unlock) is removed.
- **Approval requires every check:**
  - each SEC/BIR/DTI registry check (unchanged);
  - three identity checks (`identity_check_required`): the **PhilSys QR** verified at the official verifier, the **selfie with ID** compared with the card, and the ID holder matched to the owner or signatory on the SEC/DTI/BIR papers.
- **Legal name.** The name written to the customer's account on approval is the one the customer confirmed off their own ID.
- **Rejection carries a reason** (`rejection_reason`, `rejected_at`, migration 0055) and an optional note.

| Reason | To reapply, upload at least one of | Strengthens the case |
|---|---|---|
| BIR registration expired / not on ORUS | Current BIR 2303 | BIR 1905 update, Mayor's/Business Permit, BIR-stamped audited FS |
| SEC suspended / revoked / delinquent | SEC order lifting the suspension or revocation; SEC Certificate of Good Standing / Compliance | Latest GIS, business permit, audited FS |
| National ID mismatch / unverifiable | New National ID; selfie holding the ID | Latest GIS (names the officers) |
| Document unreadable | A clear re-upload of the ID, 2303, SEC or DTI paper | none |
| Fraudulent document | **Final: cannot reapply** | none |

- **Reapply.** A rejected company may upload any paper again. `POST /me/companies/:id/reapply` returns it to the pending queue once a required cure document is dated after the rejection (`cure_document_required`, `rejection_final`). The reviewer then decides afresh.
- **New document types:** `selfie_with_id`, `bir_1905`, `sec_good_standing`, `sec_lifting_order`, `sec_gis`, `business_permit`, `audited_fs`.
- **The selfie is never sent to OCR** (biometric; data minimisation under RA 10173). A person compares it.
- **Suggested practice for reviewers.**
  - Check SEC status at Check with SEC.
  - Check the TIN on BIR ORUS.
  - Treat a "delinquent" or "suspended" SEC status as a rejection with the SEC reason rather than an edit.
  - For the National ID, rely on the signed PhilSys QR over the printed text: OCR and the customer's own entry are typing aids, not proof.

## 3. Weather: per-equipment levels on PAGASA terms

**Before:** each site had one severity (none / watch / warning) from wind and rain thresholds.

**Now each machine on the site has its own level: Normal, Advisory, Caution or Stop work.** The level comes from the machine's weather category plus:

- the PAGASA warnings staff record for the site's province (`pagasa_advisories`, migration 0056, RLS five-element form, append-only, cleared rather than edited);
- live Open-Meteo readings. The adapter now also fetches gusts and apparent temperature.

| Category | Caution | Stop work |
|---|---|---|
| Cranes & aerial lifts | Wind ≥ 30 km/h, Signal No. 1 | Wind/gust ≥ 38 km/h, Signal No. 2, orange/red rain, thunderstorm |
| Earthmoving | Wind ≥ 45, Signal No. 2, thunderstorm | Wind ≥ 60, Signal No. 3, orange/red rain |
| Compaction & paving | as earthmoving | as earthmoving |
| Trucks & haulage | Wind ≥ 45, Signal No. 2, orange rain, thunderstorm | Wind ≥ 62, Signal No. 3, red rain |
| Generators & power | Wind ≥ 60, Signal No. 2, orange rain, thunderstorm | Wind ≥ 89, Signal No. 3, red rain |

These rules apply to every category:

- **Heat index** (PAGASA bands): 33-41 °C Advisory, 42-51 Caution, 52+ Stop work.
- **Measured rain** maps to the PAGASA colours: 7.5-15 mm/h yellow, 15-30 orange, above 30 red.
- **Signal No. 1** is an Advisory for categories where it is not a Caution.

The crane and aerial-lift wind limits are the common manufacturer figures (38 km/h lifts; 12.5 m/s platforms). A tenant with stricter OEM limits should get a per-category override. That is **not built** (restraint ladder) and is listed in §5.

**How levels reach people:**

- **Customer notification.** When a machine rises to Caution or Stop work, the customer gets `equipment_weather_warning` naming the machine and saying what to do. The event of the same name records the warning.
- **Customer booking page.** While machines are on site, it shows each machine's level (`GET /me/sites/:id/equipment-weather`).
- **Incident-log anchor.** An EDTR (digital or OCR) that logs hours on a machine rated Stop work at that site that day writes `equipment_used_despite_warning`, with the warning time and the reasons. The incident log adds the kinds "Machine warnings" and "Used despite warning". **Money is never touched** (RFC-2).
- **Site severity** is still written for existing consumers: the worse of the old wind/rain rule and the machines' levels (Stop work → warning; Advisory/Caution → watch).
- **Staff** record PAGASA bulletins and see the per-site machine matrix on the Incident log page: `GET/POST /pagasa-advisories`, `POST /pagasa-advisories/:id/clear`, `GET /sites/:id/equipment-weather`.

## 4. Migrations

- `0054_pricebook_size_class`: size class on `rate_cards` and `equipment`, plus a column UPDATE grant for `equipment.size_class`.
- `0055_kyc_rejection_reapply`: `customers.rejection_reason` and `customers.rejected_at`.
- `0056_pagasa_advisories`: new tenant table with full RLS; SELECT/INSERT, and UPDATE of `cleared_at` only.

All three are additive. No backfill is needed.

## 5. Open items

- Per-tenant overrides of the category limits. Wait until a tenant asks.
- PAGASA bulletins are entered by hand; there is no stable public API.
- Integration tests covering these changes (`customer-onboarding`, `customer-journey`, `quotes-engine`) are updated but have not been run: the migrations are not yet applied to the shared Supabase database.
