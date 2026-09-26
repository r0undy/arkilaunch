# Change Record

**Title:** A standard price book with quotes that change only in a negotiation; an approve-or-reject registration review with reason-coded rejections, PhilSys QR and a selfie; proof documents for project sites; per-equipment PAGASA weather levels with a "used despite warning" incident
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [cr-arkilaunch-scan-first-company.md](cr-arkilaunch-scan-first-company.md) (selfie decision reversed), [index.md](index.md) §2 (Change Log)

---

## 1. Why this pass exists

Admin feedback in three parts, plus one requirement the user added while answering the scoping questions:

1. **Quotes.** The Quotes tab drew up a quote per registered company. The user wants one set of prices for every client or prospect. They want the rental-only mobilization/demobilization fee fixed by the admin. They want a quote available the moment a customer books, changed only when the customer negotiates. The flow is: booking → automatic approved quote → customer negotiation message → staff revised quote → acceptance → checkout.
2. **Pending registrations.** The reviewer could edit what the customer submitted and could unlock fields for a piecemeal re-upload. The user wants approve-or-reject only. They also asked for the best course of action when a main document is expired (BIR) or the company shows as suspended on SEC, including which documents can prove legitimacy. They asked how best to verify the National ID.
3. **Weather.** The user wants standard levels per equipment in PAGASA terms, easy to understand on both sides. The levels should drive automatic warnings and anchor the incident log when a customer keeps using a machine despite the warning.
4. **Added in scoping:** adding a project site must require proof of legitimacy. The admin must be able to see that proof when the site is used for a booking or a truck trip.

Scoping answers, asked before implementation:

- **Instant quote:** yes, with no staff step.
- **After a rejection:** resubmit as a new application with the documents that cure it.
- **National ID:** PhilSys QR plus a selfie.
- **Weather:** PAGASA-aligned four levels, with thresholds per equipment class.

The user chose to rebuild this from scratch rather than revive the closed PR #108.

## 2. What changed

### 2.1 Standard price book (quotes)

- `/app/quotes` is the price book, in two tabs:
  - **Equipment rental:** the fixed mob/demob fees, operating costs (operator, maintenance, fuel burn, transport per km, buffer), diesel price and rate cards.
  - **Trucking:** per-trip fees, extra charges and tolls.
- These forms moved out of Settings and the Trucks page. Settings keeps business hours and deposit/billing.
- The per-company quote builder is gone. `QuoteRequestSchema.rentalId` is now required, so every quote prices a booking.
- Mob/demob always come from the price book (`billing_settings`), never from the request. They apply to rental only; trucking has none.
- The booking's automatic quote (`autoQuoteBooking`, which already existed) is sent approved.
- Staff may create a revision or `revise` only while the quote is **in negotiation**, which means one of:
  - it is still a draft;
  - the customer declined it;
  - the customer wrote in the booking's thread after it was issued.

  Otherwise the call returns `quote_not_in_negotiation`.
- `GET /bookings/:id` exposes `quotation.inNegotiation` so the admin sees **Revise quote** only then. `/app/quotes?bookingId=` is the revision builder: lines, agreed line price, discount. It has no customer or site picker and no mob/demob fields.
- Fixed while tracing: revising a booking on a daily or monthly card crashed. `hireDays()` called `.getTime()` on the API's string dates.

### 2.2 Registration review: approve or reject, never edit

- The review card is read-only. Every submitted value sits beside what the upload-time scan read, with an "Edited by customer" tag where they differ.
- `PATCH /customers/:id/review` (comment + unlock) and the correction fields on `PATCH /customers/:id/kyc` are removed. A pending, complete company can no longer change its fields or documents.
- **Approval** requires:
  - the ID, a selfie and a primary registration on file (`documents_incomplete` otherwise);
  - every SEC/BIR/DTI paper ticked as checked on its public registry (unchanged);
  - three identity checks (`identity_checks_required` otherwise). They are stored on `customers.identity_checks` with who ticked them and when.

  The three identity checks are:
  1. The National ID's QR verified on **PhilSys Check** (`verify.philsys.gov.ph`), the PSA's own verifier. The QR is PSA-signed and carries the holder's name, birth date and photo, so a printed fake, an edited photo or a borrowed card will not match. This is stronger than reading the printed text or trusting our OCR.
  2. The selfie shows the same person as the ID photo.
  3. The holder may act for the company: listed on the GIS, named in a Secretary's Certificate or Board Resolution, or the DTI registrant.
- On approval, the legal name written to the user account is the name **the customer confirmed** off the ID, not a reviewer edit.
- **New document:** `selfie_with_id`. It is now part of a complete submission and is never sent to OCR. The customer takes it on the ID step of the document wizard (front camera on a phone), or from the company card.
- **A rejection needs a reason**, and the reason decides the documents that cure it:

  | Reason | Customer is told to bring |
  |---|---|
  | `bir_registration_invalid` (2303 outdated / TIN not on ORUS) | Update with the RDO via BIR Form 1905. Then a new **Form 2303** and a current **Mayor's/Business Permit**. |
  | `sec_not_in_good_standing` (Check with SEC: suspended, revoked, delinquent) | **SEC order lifting the suspension/revocation, or a Certificate of Good Standing**, plus the **latest GIS stamped received**. |
  | `dti_expired` | **Renewed DTI BN certificate** and a **Mayor's Permit**. |
  | `id_not_verified` (QR fails on PhilSys Check, unreadable) | **A clear National ID/ePhilID photo with the whole QR visible** and **a new selfie**. |
  | `id_holder_mismatch` | **Secretary's Certificate or Board Resolution** (SPA for sole proprietors), plus the ID and a new selfie. |
  | `document_unreadable` | The documents the reviewer ticks. |
  | `fraudulent` | Nothing. The rejection is **final**: no uploads, no reapplying. |

- **Reapplying:** the customer uploads each cure document and calls `POST /me/companies/:id/reapply`. The company returns to `pending` for a fresh decision; the rejection stays on the row so the reviewer sees what it answers.
  - Reapplying is refused until every cure document has been uploaded **since the rejection** (`cure_documents_missing`) and the set is complete.
  - A rejected, non-final company may replace documents and correct TIN, SEC number and billing address; the replaced paper is kept as `superseded` evidence.
- The customer gets the reason in the notification feed. Staff get `company_reapplied`.
- **Admin guidance** is built into the screen. Each registry link says to reject with that reason if the paper is expired, suspended or not found, and the reject dialog shows the customer text before it is sent.

### 2.3 Site proof of legitimacy

- Adding a site now takes **a photo of the site** (rear camera) plus **one document tying the company to it**: a building/excavation permit, Notice to Proceed or contract, title/lease/owner's authorization, or barangay clearance.
- These go in the new `site_documents` table (migration 0055, full RLS) on the KYC bucket, uploaded via `POST /me/sites/:id/documents`. OCR never reads them.
- A **customer's** site takes a booking or a truck trip only once its proof is on file (`site_proof_required`). The yard's own sites (`customer_id` null) need none.
- Truck requests now name the site they serve (`truck_requests.project_site_id`, required on create, null on older rows).
- Staff open the proof (300s signed URLs, `GET /sites/:id/documents[/…/url]`, `quote:approve`) from the booking detail and from the truck request.
- The customer sees which sites still need proof on the company card, the cart site list and the truck site picker.

### 2.4 Per-equipment PAGASA weather levels

- **Levels:**
  - **Normal:** work as usual.
  - **Advisory:** work with care.
  - **Caution:** limit operations, no lifting at height.
  - **Stop work:** stop this machine now.

  Each level has an English action and a Tagalog line, shared by the customer and admin screens (`WEATHER_LEVEL_INFO`).
- **Classes:** each catalog type maps to a weather class by name (`EQUIPMENT_TYPE_CLASS`), so the reference table is unchanged. An unknown type falls back to `general`.
  - `lifting`: crane, boom truck.
  - `material_handling`: forklift.
  - `earthmoving`: excavator, backhoe, dozer, loaders, grader, skid steer.
  - `hauling`: dump truck, mixer.
  - `compaction`: roller.
  - `power`: generator.
- **Inputs:**
  - **Live reading:** wind, **gusts** (new), rain rate, thunderstorm codes 95/96/99, and the **PAGASA heat index** from temperature + **humidity** (new).
  - **PAGASA warnings:** TCWS, rainfall colour and thunderstorm, recorded per province by staff (migration 0056 `pagasa_advisories`, full RLS). PAGASA publishes no machine-readable feed.
  - Rain rate is converted with the PAGASA Rainfall Warning System colours: Yellow 7.5–15, Orange 15–30, Red above 30 mm/h. The worse of the PAGASA colour and the observed colour applies.
- **Thresholds** (`RULES` in `packages/shared/src/equipment-weather.ts`), at a glance:

  | Class | Advisory | Caution | Stop work |
  |---|---|---|---|
  | Cranes / boom trucks | gust ≥ 30 km/h, Yellow | gust ≥ 38, Orange | gust ≥ 50 (≈13.8 m/s), **any TCWS**, **lightning**, Red |
  | Forklifts | gust ≥ 30, Yellow | gust ≥ 40, Orange, thunderstorm | gust ≥ 50, any TCWS, Red |
  | Earthmoving | Yellow | Orange, TCWS 1, thunderstorm, gust ≥ 62 | Red, TCWS ≥ 2 |
  | Hauling | Yellow, thunderstorm | Orange, TCWS 1, gust ≥ 62 | Red, TCWS ≥ 2 |
  | Rollers | Yellow, thunderstorm | Orange, TCWS 1 | Red, TCWS ≥ 2 |
  | Generators | Orange, TCWS 1 | Red, thunderstorm, TCWS 2 | TCWS ≥ 3 |
  | Every operator (heat index) | 33–41 °C | 42–51 °C | ≥ 52 °C |

- **The poll** (`jobs/src/weather-poll.ts`):
  - It stores each machine's level, reasons and the PAGASA advisory on the reading (`weather_alerts.observed`).
  - It raises the legacy site severity so it is never calmer than the worst machine.
  - When a machine **rises** to Caution or Stop work, it notifies the renting customer (`equipment_weather_warning`) and the admins (`equipment_weather_alert`), and records an `equipment_weather_warning` event. A level that stays up does not re-notify.
- **Used despite warning:**
  - An EDTR (digital or OCR) that logs hours on a machine that received a **Stop work** warning that Manila day is written to the S14 incident log as `equipment_used_despite_warning`. The entry records hours, reasons and when the warning went out, once per EDTR.
  - It is evidence only: never money, never the EDTR status (RFC-2).
  - Caution is left to the reviewer, because it allows limited work.
- **Screens:**
  - The customer booking (confirmed/active) shows *Weather for your equipment*: only their own machines, never a neighbour's (`GET /me/sites/:id/equipment-weather`).
  - The admin booking shows every machine on the site (`GET /sites/:id/equipment-weather`).
  - The incident log gains a **Used despite warning** filter and the **PAGASA advisories** panel (record / lift).

## 3. Migrations

All three are additive. Run `pnpm db:migrate`.

- `0054_kyc_rejection_reasons`: `customers.rejection_reason`, `rejection_note`, `cure_documents`, `rejected_at`, `identity_checks`. `review_comment`/`unlocked_fields` are retired but kept so old rows still read.
- `0055_site_documents`: the `site_documents` table and `truck_requests.project_site_id`.
- `0056_pagasa_advisories`: the `pagasa_advisories` table.

## 4. Verification

- `pnpm typecheck` and `pnpm lint` are clean.
- Unit tests:
  - Shared: 138 pass. New: equipment-weather rules, the decision schema and cure lists, completeness with the selfie.
  - Web: 38 files pass, including the rewritten Quotes tests (price book tabs; revision builder).
  - Weather adapter: 16 pass.
  - EDTR worker: 11 pass.
- **Not yet run green:** the DB integration specs.
  - `apps/api/test/*` and the new `jobs/src/equipment-weather.spec.ts` run against the shared Supabase database, where 0054–0056 are not applied. Every failure observed traced to `column "rejection_reason" does not exist`.
  - The specs are updated for the new rules: quotes need a booking, the negotiation guard, approve/reject/reapply, site proof before booking, and warning → incident.
  - Run `pnpm db:migrate`, then `pnpm test`, before merging.
- **Environmental, not caused by this change:** `jobs/src/weather-poll.spec.ts` fails because the shared test DB holds 259 active sites, above the 200-site free-tier ceiling, so every poll cycle is skipped.

## 5. Deliberately not claimed

- **PhilSys QR is verified by a person on PhilSys Check**, not in-app. We do not hold the PSA public key or an eVerify API agreement. The tick records that a reviewer did it; it does not prove it.
- **The selfie is compared by a person, not by face-matching software.** It reverses the "liveness/selfie declined" line in `cr-arkilaunch-scan-first-company.md` at the user's explicit choice. A selfie is still sensitive personal information under RA 10173. The consent text, retention period and DPO sign-off are **open**.
- **PAGASA warnings are entered by staff.** There is no feed, so a signal that is not entered does not count. The live reading still applies on its own.
- **Rain rate** reads Open-Meteo's current precipitation as the past-hour amount the PAGASA colours are defined on. If it is actually a shorter interval, the levels under-read rain. **Verify against Open-Meteo's `current` semantics before relying on the Red/Orange stop rules.**
- **Thresholds are defaults drawn from common crane-manufacturer wind limits, the PAGASA rainfall/TCWS/heat-index scales and DOLE OSH practice.** They are not engineering sign-off for any specific machine. They are constants in one file, not a per-tenant setting.
- **Site proof is required only going forward.** Existing customer sites without proof will refuse new bookings and truck trips until the customer uploads it.
