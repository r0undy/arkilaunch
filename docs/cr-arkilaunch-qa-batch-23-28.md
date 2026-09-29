# Change Record

**Title:** QA batch 23–28: sites deployed vs idle, minimum rental days and real booking errors, expiring date holds, notification targets, booking filters, WebP equipment photos
**Project:** ArkiLaunch
**Date:** 2026-09-29
**Version:** 0.1
**Status:** `Applied` (branch `fix/qa-batch-23-28`)
**Trigger doc:** Owner QA feedback items 23–28 (2026-09-29)
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §3 (`rentals`, `billing_settings`, `tenant_applications` trigger) and the bookings, sites, notifications and upload contracts

---

## 1. Sites: deployed now, upcoming, idle (QA 23)

**Before:** the Sites tab listed every project site with its weather, and nothing more. An expanded site listed every assignment that had not been cancelled, whether past, current or future, under "No machines deployed to this site yet".

**After:**
- **`GET /sites`** returns, per site:
  - `activeUnits`: assignments `active`, or the legacy site-deployment path's `scheduled` assignment on a unit marked `deployed`.
  - `upcomingUnits` and `nextArrival`: `scheduled` units on a `confirmed` rental that start between yesterday and 14 days from now.
  - `customerName`: null for the yard's own sites.
- **Filter:** `?deployment=active|upcoming|idle`. The total always matches the filter.
- **Sort:** deployed sites first, then upcoming ones.
- **Sites tab:** filter chips (All · Deployed now · Upcoming · Idle, kept in the URL), a status badge, and a Customer column.
- **Expanded site:** the hub's units now carry `onSite` and `returned`, so the list is split into On site now / Upcoming / Past by assignment status rather than by date.

## 2. Booking refusals and the minimum rental (QA 24)

**Before:**
- The cart showed "The booking was not created, and nothing has been charged. Try again in a moment." for most refusals. The worst case was `site_proof_required`, because the cart let a customer pick a site with no proof.
- The four non-date `equipment_unavailable` reasons all read "not in service".
- The tenant minimum (`billing_settings.min_hours`) was a flat floor that ignored the dates. A 500-hour minimum demanded 500 hours of a 16-day rental, which 16 working days cannot hold.
- There was no upper bound on hours.

**After:**
- **Minimum is a length:** `minRentalDays = ceil(min_hours / daily_hours)`. Hours run from `days × daily_hours` up to `days × 24`.
  - `POST /bookings` refuses with 422 `rental_too_short {minDays}`, `hours_below_minimum` or `hours_above_maximum {maxHours}`.
  - The cart and the Configure Rental modal say "This company rents for at least N days" before the customer submits.
  - Hours left blank take the minimum.
  - The `min_hours` column is unchanged; the admin hint now states the days it implies.
- **Every refusal has its own sentence:** `explainBookingError` covers every code `create` answers, plus 401, 403, 429 and a dropped connection. A test pins that none falls through to the generic line.
- **Site proof:** the cart flags a site with no proof before submit and shows the upload inline.

## 3. Expiring date holds (QA 25)

**Before:** an unpaid `pending` request's `scheduled` assignments blocked the unit for every other customer, with no end.

**After (migration `0068_qa_batch_23_28.sql`):**
- **How long a hold lasts:**
  - `rentals.hold_expires_at` is set to `now + billing_settings.hold_hours` (default 48, range 1–720) when the booking is created.
  - It resets when a quote is approved and sent (the customer's turn).
  - Payment (`confirmed`) is the hard lock and ignores it.
  - Existing pending rows were backfilled with a full window.
- **Availability:** `overlappingAssignments` skips a lapsed hold unless an online (non-cash) payment on it is still pending.
  - A live hold is reported as blocker `hold` (refusal reason `on_hold`), with `heldUntil`.
  - The calendar shows held days in their own style ("On hold, frees up if unpaid").
- **Checkout:** checkout and staff-recorded cash call `renewLapsedHold`.
  - A lapsed hold whose dates are still free re-holds and carries on.
  - One whose dates another booking has taken is refused with 409 `hold_expired`, so the unit is never double-booked.
- **Staff:** `PATCH /bookings/:id/hold` (`quote:approve`, audit-logged) gives another `hold_hours`. The drawer shows the deadline, and the setting sits in Billing settings.
- **Sweep:** `jobs/src/hold-expiry.ts` runs hourly (Terraform `hold_expiry_cron`, `apply` is an ops step).
  - It cancels lapsed holds, voids their unpaid booking/deposit invoices and pending cash intents, and cancels their assignments.
  - It records a `booking_hold_expired` event and notifies the customer and the admins/owners (`hold_expired`).
  - It skips any request with an online payment in flight.

## 4. Notification targets (QA 26)

- **The console is the signed-in role's, not the URL's.** A customer's bell on the storefront (`/equipment`) had resolved to staff links, which bounced.
- **Staff:**
  - Payment events open their booking drawer (the email's target).
  - Change requests open the Actions tab, and customer messages open Negotiation.
  - Company registrations open the company in the queue (`?open=`).
  - Maintenance opens the inventory searched to the unit: the job now writes `serial_no`, and `/app/inventory` takes `?q=`.
  - `hold_expired` opens the booking drawer.
- **Customer:** company verified opens the company; `hold_expired` opens the booking.
- **Timekeeper:** a correction opens the scanner.
- **Platform admin:**
  - "See more" opens `/admin/notifications`, not `/app/notifications`.
  - Migration `0069_platform_registration_notify.sql` adds an AFTER INSERT trigger on `tenant_applications` that notifies every active platform admin (`tenant_registered`, linking to the application). It is SECURITY DEFINER, with a fixed type and a payload built from the new row only, and nothing new can call it.
- **Owners:** they now receive staff and weather alerts (`STAFF_ALERT_ROLES = ['admin', 'owner']`), except the three that open admin-only screens (company registrations, password resets).
- **Test:** the feed test checks that every written type lands on a route registered in `router.tsx`, inside its own console, with its path params filled.

## 5. Bookings list filters and the review queue (QA 27)

- **`GET /bookings`** takes:
  - `status` (a comma list of pending, confirmed, active, completed and cancelled);
  - `from`/`to` (Manila days; a booking whose dates touch the range);
  - `q`, which also matches the customer's company name, with wildcards escaped;
  - `sort=start`.
  - It returns `statusCounts` under every filter except `status`.
  - Rows carry `customerName`, `startDate`, `endDate` and `holdExpiresAt`.
- **Staff Bookings tab:** status chips with counts (All · New requests · Paid · On site · Completed · Cancelled), a date range and a sort, all kept in the URL. The table has new Customer, Dates and hold columns.
- **Review queue:** the app bar's review-queue pill links to `/app/ocr?status=review` (a new `status` search param on the field-logs page), or to `/admin/applications` for the platform admin. The dashboard's "Needs you" link uses the same filter. The field-logs `?week` validator regex (missing backslashes) is fixed.

## 6. Equipment photos as WebP (QA 28)

- **Browser:** `prepareUpload(file, { maxEdge, quality, type, maxBytes })`. With no options, its defaults (2200px / 0.82 JPEG) are unchanged, so the EDTR and KYC bytes Azure DI reads are unchanged (RFC-2).
  - Equipment photos encode WebP at 1920px / 0.8. Where the browser cannot encode WebP (older Safari), they fall back to JPEG.
  - They step down in quality, then size, until they fit **1 MB**. Web images of this kind typically land at 150–400 KB, so the 5 MB first suggested was far above need.
- **API:**
  - `validateUpload` recognises WebP by its magic bytes, with a dimension cap like PNG's.
  - The equipment endpoint takes JPEG/PNG/WebP only (no longer PDF) at 1 MB. Branding takes WebP too.
  - KYC and EDTR keep their allow-list.
- **Display:** photos lazy-load.
- **Ops:** add `image/webp` to the `equipment-photos` bucket's allowed MIME types in Supabase. Keep the bucket's 10 MB size limit, because branding shares it.
- Existing photos are not re-encoded.
