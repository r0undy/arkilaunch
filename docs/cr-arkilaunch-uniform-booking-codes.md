# Change Record

**Title:** One persisted booking code for both services (EQR-YYYY-NNNN / TRK-YYYY-NNNN), carried through every lifecycle step
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Applied` (code); migration 0058 waits for `make migrate` on each environment
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow; admin feedback 2026-09-27 (item 1 of 6)
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §3 catalog (`booking_code_counters`, `rentals.code`, `truck_requests.code`), §4 (booking, truck, invoice and payment responses gain the code; PayMongo description + metadata), [index.md](index.md) §2

---

## 1. Why

- A "booking code" was the first four hex characters of the UUID, drawn in the browser only (`apps/web/src/lib/format.ts` `shortCode`). It was not unique, not stored and not searchable.
- **One rental had two codes.** It read `BKG-xxxx` on bookings, cart, checkout and negotiation, but `RNT-xxxx` on the capture modal, the EDTR queue, the deployment scan list and the invoice.
- **Trucks borrowed `BKG-`** on the invoice page, so a truck invoice looked like a rental's.
- Server text named bookings by raw UUID or not at all: the EDTR deduction line (`EDTR reconciliation <uuid> (sources: <uuid>, <uuid>)`) and the PayMongo checkout description.

## 2. Decisions (confirmed with the user 2026-09-27)

| Decision | Why |
|---|---|
| `EQR-2026-0001` (equipment rental) and `TRK-2026-0001` (truck service), one generator, same length and shape | Fair and recognisable across both services; the prefix alone says which service. |
| One counter per tenant, per service, per **Asia/Manila** year | A booking made at 07:30 on 1 January Manila time is 23:30 UTC on 31 December; a UTC year would file it under the previous year. |
| Assigned by a `BEFORE INSERT` trigger, not by the service layer | Every insert path (API, seeds, fixtures, future jobs) gets a code; none can forget. A supplied code is refused, and an `UPDATE` of the code is refused (immutable). |
| Counter taken with `INSERT … ON CONFLICT DO UPDATE … RETURNING` | Row-locks the counter row for the rest of the booking's transaction, so concurrent bookings in one tenant serialise on it and never share a number. |
| Gaps allowed | A rolled-back booking leaves a gap. This is a reference, not a fiscal number; invoices keep their own numbering. |
| Padded to at least four digits, never truncated | `lpad` alone would cut 10000 to `1000`. SQL `booking_code_format` and `formatBookingCode` in `packages/shared` agree exactly. |
| Notification payloads enriched by a `BEFORE INSERT` trigger on `notifications` | The API, the jobs and `packages/db` all insert notifications; one trigger cannot be missed by the next writer. A payload naming `rental_id`, `truck_request_id` or (payments) `invoice_id` gains `booking_code` + `booking_service`. Existing rows are backfilled. |
| QR payload on the EDTR sheet unchanged | The QR is the OCR contract (RFC-1: no tenant in it); the code is printed beside it for people. |

## 3. Behaviour changes

- `BookingSummaryResponse`, `BookingDetailResponse`, `BookingCreateResponse`, `TruckRequestResponse` and the reference `RentalRef` gain `code`.
- `InvoiceSummaryResponse` / `InvoiceDetailResponse` gain `bookingCode` (the rental's or the truck's).
- `GET /bookings` and `GET /trucks` accept `q`: an exact or prefix match on the code (`bookingCodeSearchPrefix`), case-insensitive.
- EDTR list rows gain `bookingCode`.
- The deduction invoice line reads `EQR-2026-0001 · <model> · 2026-09-21 · 8.0 h running + 1.0 h idle`. The evidence link is still the `reconciliation_id` column, never the text.
- PayMongo checkout: the line/description reads `EQR-2026-0001 · Equipment rental` (or `TRK-… · Truck service`), and `metadata.booking_code` is set.
- Web: one `<BookingCode>` component; every `shortCode('booking' | 'rental', …)` is gone and the `rental`/`booking` keys are deleted from `CODE_PREFIXES`, so a leftover use fails typecheck.

## 4. Migration 0058

`0058_booking_codes.sql` (hand-authored, idempotent):
- `booking_code_counters (tenant_id, service, year, last_value)`, ENABLE + FORCE RLS, RFC-1 §3 `tenant_isolation` policy, `SELECT, INSERT, UPDATE` to `app_authenticated`.
- `rentals.code`, `truck_requests.code`: added nullable, backfilled per tenant and Manila year in `(created_at, id)` order (deterministic on re-run), counters seeded from the backfill, then `NOT NULL`, a shape `CHECK`, and `UNIQUE (tenant_id, code)`.
- Triggers: `booking_code_assign` (insert), `booking_code_immutable` (update of `code`), `notification_booking_ref` (insert on `notifications`).
- The trigger functions are `SECURITY INVOKER`: on a request path the counter write runs as `app_authenticated` under the same tenant GUC as the booking row.

## 5. Tests

- `packages/shared/src/booking-code.spec.ts`: format, pad-not-truncate, round-trip, case-insensitive parse, rejects the old `BKG-`/`RNT-` shapes, search prefix.
- `apps/api/test/booking-codes.spec.ts` (DB): sequential codes under concurrent creates, separate counters per service and tenant, Manila-year rollover, supplied or changed code refused, notification enrichment for rental-, truck- and invoice-keyed payloads.

## 6. Deliberately not claimed

- Codes are not reused and not renumbered after a cancellation.
- Contracts have no print view yet, so "contract shows the code" is carried by the booking page they are opened from.
