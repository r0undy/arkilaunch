# Change Record

**Title:** Standard pricing for every client; fixed mobilization/demobilization; quotes change only in a negotiation
**Project:** ArkiLaunch
**Date:** 2026-09-26
**Version:** 0.1
**Status:** `Draft`
**Trigger doc:** user request 2026-09-26 (admin side item 1), answers to 4 clarifying questions
**Docs touched by this record:** [index.md](index.md) §2; amends [rfc-arkilaunch-quotation-pricing-engine.md](rfc-arkilaunch-quotation-pricing-engine.md) (RFC-003, Locked) §3 API and PRD-F1; extends [cr-arkilaunch-customer-journey.md](cr-arkilaunch-customer-journey.md) and [cr-arkilaunch-truck-booking-and-kyc-docs.md](cr-arkilaunch-truck-booking-and-kyc-docs.md)

---

## 1. Why

- The admin Quotes tab built a quote by hand for one company at a time. The owner wants one standard price that applies to every client, including potential clients who have not registered yet.
- Mobilization and demobilization could be typed per quote. They should be fixed fees that the admin sets once.
- A customer should see the price as soon as they order. Staff should change it only when the customer negotiates.

## 2. Decisions (confirmed with the user 2026-09-26)

- **Keep the formula engine (RFC-003).** The admin sets its inputs; there is no flat price list. The Quotes tab becomes the standard pricing screen, grouped by service:
  - **Equipment rental:** mobilization and demobilization, operator/maintenance per hour, fuel per hour, buffer, and rate cards.
  - **Trucking:** transport and fuel per km, truck fees and formula, and tolls.
  - **Both services:** diesel price.
- **Mobilization and demobilization are fixed fees on equipment rental only.** Trucking has none. Staff cannot change them on a quote, not even in a negotiation.
- **Every booking is quoted automatically** from the standard pricing and sent to the customer. There is no per-company quote builder (`POST /quotes` is removed).
- **In a negotiation, staff may change only line prices (an agreed price per line) and a discount.** A negotiation is open once the customer has posted in the booking's thread or declined the quote. Trucking works the same way: staff can always accept the standard price, and any other price needs a customer message in the truck request's thread.
- **Public rates page** (`/rates`) for potential clients. It shows the storefront's upfront equipment rates, the fixed mobilization/demobilization and the trucking fees.

## 3. What changes

- **API:**
  - `POST /quotes` is removed.
  - `POST /quotes/:id/revise` takes `{ discount, agreedPrices: [{ itemId, subtotalPhp }] }`. The schema is strict, so a mobilization field is rejected. The endpoint returns `409 negotiation_required` before a negotiation is open. It copies the parent's lines, rate snapshot and mobilization/demobilization unchanged. The parent keeps its numbers (QAD-T47).
  - `QuoteRequestSchema` loses `mobilizationPhp`/`demobilizationPhp`. The engine always uses `billing_settings`.
  - New `POST /quotes/auto/:rentalId` re-runs the standard quote for a booking the auto-quote could not price (a missing rate card or pricing input). It only runs when the booking has no open quote. The auto-quote now notifies staff (`quote_pending_setup`) instead of leaving the booking silently unquoted.
  - `PATCH /truck-requests/:id/agree` returns `409 negotiation_required` for a price other than the request's standard total until the customer has written in the thread.
  - New `GET /catalog/pricing` (@Public, throttled) returns the storefront's standard fees.
  - `GET /quotes/:id` line items now carry their `id`.
- **DB:** migration `0054_public_standard_pricing.sql` adds `catalog_standard_pricing(slug)`. This is the same narrow, active-tenant-only SECURITY DEFINER pattern as `catalog_list_testimonials` (0015). It returns fee columns only and no customer data. No new tables, no RLS change.
- **Web:**
  - `/app/quotes` is the standard pricing screen. Rate cards and diesel moved there from Settings, and truck fees and tolls moved there from Truck service.
  - The booking page's "Quote this booking" is replaced by "Quote from standard pricing" (unquoted bookings only) and a revise panel (agreed prices and a discount, then approve).
  - New public `/rates` page, linked from the storefront nav and footer.

## 4. Guardrails

- `tenant_id` always comes from the verified JWT (RFC-1). The public function resolves the tenant from the host slug server-side and runs read-only.
- An agreed price or discount is a staff decision, and it is audit-logged. Nothing here triggers a deposit deduction (RFC-2).
- A revision never reprices off a newer rate card or diesel reading. It carries the parent's snapshot (RFC-003 reproducibility).

## 5. Not done

- The cart does not yet show mobilization/demobilization before the order is placed. The customer sees them on the instant quote right after booking, and on `/rates`.
- The public rates page shows each machine's rate card price, not the all-in hourly price (operator, maintenance and fuel are added in the quote).
