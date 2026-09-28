# Change Record

**Title:** PH mobile format, faster company submit, application remarks and dedupe, per-unit booking dates
**Project:** ArkiLaunch
**Date:** 2026-09-28
**Version:** 0.1
**Status:** `Applied` (branch `fix/qa-feedback-batch`)
**Trigger doc:** QA feedback 2026-09-28 (contact mobile shown as "63+"; slow company submit; "Registration number Not provided" for a BIR-only company; repeat applications; header and sidebar inconsistency; "Notification centre"; booking dates per equipment)
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §3 (`rentals`, `equipment_assignments`) and the `POST /api/v1/bookings` contract, [index.md](index.md) §2

---

## 1. Every contact mobile is a PH mobile

**Before:** contact mobiles were free text of 7 to 50 characters, with no format check.

**After:**
- `PhMobileSchema` (`packages/shared/src/phone.ts`) normalizes `0917…`, `63917…` and `+63 917…` to `+639XXXXXXXXX` and refuses anything else.
- It applies to:
  - `CompanyCreate.contactMobile`
  - `TenantRegisterRequest.mobileNumber`
  - `UserSelfUpdate.phone`
  - the new `BookingCreateRequest.siteContactMobile`
- The web `MobileInput` shows a fixed `+63` and takes only the 10 digits after it.
- The cart's free-text "Name and mobile number" field is now two fields, a name and a `+63` mobile. The mobile is stored in `rentals.site_contact_mobile`, which has a CHECK constraint (migration `0064`).

**Not changed:**
- The tenant branding "Phone" field, which is a business line and may be a landline.
- Stored numbers. A settings number saved before this rule that isn't a PH mobile is left untouched until the user types a new one.

## 2. Company submit reuses the scan

**Before:** the form had already scanned each paper. Submit then uploaded the papers one at a time, and each upload re-ran Azure OCR inside an open database transaction.

**After:**
- **OCR reuse:** `CustomersService.analyzeCached` keeps each read keyed by tenant, user, model and the file's SHA-256, for 30 minutes and at most 200 entries, per instance. The upload finds the read the scan already made.
  - A miss runs OCR again, so the cache is only a speed-up.
  - The read is always the server's own; the client never supplies it.
  - A reviewer's manual re-read always asks Azure afresh.
- **Out of the transaction:** `addDocument` records the row, commits, then reads. A read that fails leaves the row `pending` for the reviewer's re-read.
- **Web:** uploads run in parallel, the selfie is compressed like every other capture, and the page navigates without waiting for the list to refetch.

## 3. Application remarks and one application per company

- **Card number:** the applications card shows the number from the paper actually uploaded, "TIN …" for a BIR Form 2303 or "SEC reg. no. …" for an SEC certificate. It also lists the documents submitted and gives one remark on where the application stands: still needed, under review, not verified (with the reason), or verified.
- **Duplicates:** `createCompany` refuses a company the same login already applied for with 409 `company_already_applied`. It counts as the same when any of these match:
  - the TIN, with a missing branch read as head office;
  - the SEC number, ignoring spaces and case;
  - the name, ignoring case, spaces and punctuation.
- **Web:** the form warns before submit and links to the existing application, where a rejected one is fixed and reapplied.
- Other customers applying with the same TIN are still only flagged to the reviewer, as before.

## 4. Uniform customer headers

- Each customer tab's title is its sidebar label, so the breadcrumb is always tenant › tab.
- Every tab has a one-line description, uses sentence case, and uses the shared `Tabs` component.
- The sidebar no longer repeats the tenant name, which is already beside the logo in the top bar.
- The notifications page is titled "Notifications", replacing "Notification centre".

## 5. Each unit keeps its own dates

**Before:**
- The booking page showed only the first unit's dates.
- An extension moved every unit to one return date.
- My bookings showed no dates.
- The same unit could go into one request twice with overlapping windows, because availability is checked only against other bookings.

**After (migration `0064_per_unit_dates_site_mobile.sql`):**
- **Detail:** `BookingDetailResponse.items[].id` is the assignment. Each machine card shows its own start, return, status and progress, and the summary shows the booking's span.
- **Extensions:** `booking_change_requests.assignment_id` names the unit being extended. `ChangeRequestCreate.assignmentId` is required for `extend`. Approval moves only that unit, and `rentals.end_date` follows the latest unit. A request from before this, with a null assignment, extends every unit as it did before.
- **My bookings:** `BookingSummaryResponse.items[]` lists each unit with its dates, loaded in one query.
- **Overlap:** `POST /bookings` refuses the same unit twice with overlapping windows (409 `equipment_unavailable`, `reason: overlaps_in_cart`), and the cart flags it first.

**Migration:** the two columns are nullable and added to tables that already carry `tenant_id` and RLS. No new table and no backfill.
