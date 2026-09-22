# Change Record

**Title:** Customer journey: quote negotiation, rent-plus-deposit checkout, change requests, journey notifications
**Project:** ArkiLaunch
**Date:** 2026-09-21
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user-supplied Figma prototype `ENpes2ZBsS3baRPKLyx0d3` (page `Prototype`): Cart Page / Nego Options, Messenger Chat Nego, Call Nego, Nego Finalized, Payment Digital Bank / Bank Transfer, GCash Authentication, OTP Verification, Payment Confirmation, Bank Transfer Successful, Extend Rental, Notification / Dismiss
**Docs touched by this record:** [index.md](index.md) §2; supersedes the negotiation-as-layout-only note in [cr-arkilaunch-figma-ia-alignment.md](cr-arkilaunch-figma-ia-alignment.md)

---

## 1. Why

The customer could book and pay a deposit, but nothing between those two steps existed. No quote was ever tied to a booking (`quotations.rental_id` was only copied on revise, never set on create), so a customer could not see or accept a price. The four negotiation screens were placeholders with no backend. Checkout charged a flat deposit and never the rent. Extend Rental was a dead end, and notifications printed raw payload keys.

## 2. Decisions (confirmed with the user 2026-09-21)

- **Payment stays PayMongo hosted checkout.** The customer chooses GCash, Maya, online banking or card on our page. That choice narrows `payment_method_types` on the checkout session, and the wallet or bank login and the OTP from the Figma frames happen on PayMongo's page. No credential reaches ArkiLaunch, which keeps DSD §4.1 ("Don't: collect card data in-app") and needs no card-data compliance work beyond PayMongo's own merchant verification.
- **Negotiation is counter-offers on the quote, with unlimited rounds.** A `negotiation_messages` thread per booking, where a message may carry an offer. **An offer is never charged.** The price that is charged is always a quotation revision priced by the engine (RFC-3). Staff meet a counter by re-quoting with a fixed discount. The Figma's Messenger/phone hand-off is replaced by the in-app thread; the call screen points to the contact page.
- **Multi-item cart, one quote, one payment: full rent plus deposit, upfront.** Accepting a quote opens the `rental_contracts` row (deposit = `DEFAULT_DEPOSIT_PHP`) that already caps deductions (RFC-2). Checkout then raises one `booking` invoice itemised as rent and deposit.
- **Browse first, sign up at the cart.** This already held (the cart route's `requireAuth` redirect preserves the return URL). No change.
- **In-app notifications only.**

## 3. What changed

- Migration `0022_customer_journey`: `negotiation_messages` and `booking_change_requests`, each with `tenant_id`, the `tenant_isolation` policy, FORCE RLS and grants; `rentals.site_contact` and `rentals.site_notes`.
- `POST /quotes/:id/accept`, `POST /quotes/:id/decline` (customer, own quote only). `rentalId` on quote create. Re-quoting a booking supersedes its open quotes, so an older approved quote cannot still be accepted. A quote is valid for 7 days (`QUOTE_VALID_DAYS`, shared).
- `GET/POST /bookings/:id/messages`, `POST /bookings/:id/change-requests`, `PATCH /bookings/:id/change-requests/:requestId` (staff; `quote:approve`). An approved extension re-runs the double-booking check on the added days.
- Checkout: an accepted quote means rent plus deposit; no quote means the old deposit-only path; an unaccepted quote returns 409. A deposit already paid is not charged again, and a booking already paid is refused.
- Customer notifications: `quote_ready`, `negotiation_reply`, `payment_received`, `payment_failed`, `payment_refunded`, `change_request_resolved`. Also `PATCH /notifications/read-all`.
- A customer cancels an unpaid booking directly. Once it is paid, cancelling is a request that staff resolve, and the refund stays manual in PayMongo.
- Web: cart dates and logistics; negotiation, call and finalised screens; the checkout method picker and a `checkout/failed` page (set `PAYMONGO_CANCEL_URL` to it); a booking timeline with deposit status and requests; the extend request; and a staff `/app/bookings` screen with a quote-builder link.

## 4. Deliberately not claimed

- There is no realtime transport. The thread polls every 10 seconds.
- There is no email, SMS or push, and staff get no notifications. They find work on `/app/bookings`.
- Refunds are not automatic. The customer-facing cancellation says billing handles any refund.
- The "On site" and "Hire ends" timeline steps follow the calendar once a booking is paid, because nothing yet records delivery or return.
- Quote validity is measured from `created_at`, not approval time (marked `ponytail:`).
- The PayMongo channel codes (`gcash`, `paymaya`, `dob`, `card`) are carried over from the existing adapter comment and still need checking against current PayMongo docs before `ENABLE_PAYMENTS=true` on a live key.
- No e2e browser run was made against the live stack. Coverage is the service-layer `customer-journey.spec.ts` plus web unit tests.
