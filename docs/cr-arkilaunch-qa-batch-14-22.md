# Change Record

**Title:** QA batch 14–22: company-booked truck trips, re-approved prices, cancellation, Statement of Account, branded prints, one session per browser, more ID types
**Project:** ArkiLaunch
**Date:** 2026-09-29
**Version:** 0.1
**Status:** `Applied` (branch `fix/qa-batch-14-22`)
**Trigger doc:** Owner QA feedback items 14–22 (2026-09-28)
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §3 (`truck_requests`, `tenants`) and the truck, billing and KYC API contracts

---

## 1. Self-loading truck: company, site, cargo (QA 14)

**Before:** every truck request had to name one of the customer's project sites, and that site needed its proof first. The site did not move the drop-off pin. The only way to say what was being hauled was free-text notes.

**After (migration `0067_qa_batch_14_22.sql`):**
- **Company:** `truck_requests.customer_id` is the company the trip is booked for. `POST /me/truck-requests` takes a `customerId`, which must be one of the caller's own companies. Checkout checks that company's KYC. Older rows are backfilled from their site; a request with no site falls back to any approved company of the requester.
- **Site:** `projectSiteId` is optional. Picking a site pins the drop-off at the site's coordinates and uses the site's own address. A truck trip needs no site proof: `requireSiteProof` is dropped for trucks, and staff no longer see the site-proof panel on a truck.
- **Cargo:** `truck_requests.load_description` ("Equipment to load", 1–300 characters) is required on new requests. Both sides see it on the trip, in the staff list and drawer, and in the Actions tab.

## 2. Truck price changes and re-approval (QA 21)

**Before:** `PATCH /truck-requests/:id/agree` changed `agreed_price_php` only. An invoice issued at checkout, and its PayMongo session and QR, kept the old amount. The customer re-approved only when the new price went above the request-time cap. Nothing recorded the change.

**After:**
- **Every staff price change** (`agree`) locks the row (`FOR UPDATE`) and is refused once the trip is paid. It then:
  - voids the unpaid truck invoice and expires its pending PayMongo sessions (`PaymentsService.voidUnpaid` → `closePendingPayments`);
  - clears `accepted_price_php`;
  - posts "Agreed price changed from ₱X to ₱Y" to the negotiation thread, which is the price history both sides read;
  - writes an `audit_logs` row;
  - notifies the customer (`truck_price_updated`).
- **Customer accept:** `POST /me/truck-requests/:id/approve-price` takes `{ pricePhp }`, the price the customer saw. If it no longer matches the agreed price, the response is 409 `price_changed`, never a silent accept. Checkout requires `accepted_price_php = agreed_price_php` (409 `price_not_accepted`). The cap is now only a typo warning in the staff confirm dialog, together with a warning when the new price is more than 30% away from the route price.
- **Payment against a voided invoice:** if a payment lands after its invoice was voided (it was in flight while the price changed or the trip was cancelled), the payment is recorded, nothing is unlocked, and staff get `payment_on_void_invoice` to refund it.
- **Starting a new online checkout** now expires the invoice's earlier pending session first, so going Back from PayMongo and paying again can never charge twice.

## 3. Calls, tolls, notifications (QA 16)

- **Calls:** either side may start the call (the customer's "Request call", or the yard's phone shown to the customer). Only an admin records "Confirmed by phone", because it gates payment. `confirmCall` now notifies the customer (`call_confirmed`). The truck list returns `companyName`, `requesterName` and `requesterPhone`, so staff can call.
- **Notifications:** the call-request notification opens the booking drawer on its Actions tab (`/app/bookings?open=TRK-…&tab=actions`). Customer truck notifications open the specific trip (`/account/trucks?open=TRK-…`).
- **Tolls:** the staff route asks OSRM for its turn list. `tollHintsFromSteps` and `suggestTolls` (in `packages/shared/src/ph-tolls.ts`) preselect the expressway entry and exit fees whose names the ramp signs carry. A manual toll amount (`manualTollPhp`) replaces the picked tolls with one line. The suggestion is a heuristic, so the admin always confirms.

## 4. Cancellation and uniform negotiation (QA 16)

- **Trucks:** `POST /me/truck-requests/:id/cancel` is refused for a trip that is already cancelled or paid. A cancel voids the trip's unpaid invoice and sessions, is audited, and notifies staff. The customer's trip drawer has a Cancel button.
- **Rentals:** `cancelRental` also voids an issued booking or deposit invoice and its sessions, and notifies staff when the customer cancelled. `settleInvoice` never flips a cancelled rental or trip back to confirmed or paid.
- **One thread component** (`NegotiationThread`, addressed by an API base) serves rentals and trucks.
- **"Negotiate via messenger"** offers the rental company's Facebook Messenger link (`tenants.messenger_url`, https m.me / Messenger / Facebook only, set in branding) or the in-app chat. It goes straight to the in-app chat when no link is set.

## 5. Weekly billing and Statement of Account (QA 19)

- `GET /rentals/:id/statement` (staff) and `GET /me/rentals/:id/statement` (the customer's own booking) are read-only. They group each reconciled EDTR day's charge by ISO week (from the deposit, on a weekly invoice, or not yet invoiced) and list every live invoice, payment, the deposit and the balance due.
- **Booking page:** shows the weeks as they are billed. Once the rental is completed, it links to a printable statement.
- `jobs/src/weekly-billing.ts` gets its cron in dev and prod (Monday 07:00 PHT). Terraform changed; `apply` is an ops step.

## 6. Printed documents (QA 20)

- **`PrintFrame`:** puts the tenant's logo, name, address, contacts and TIN, in its brand colour, above every printed invoice, quote, agreed quote, weekly rundown and statement. It also prints the document's title, reference, issue and print dates and key facts, with a running footer and Page X of Y (`@page`). The quote letterhead had been inside a `<header>`, which print CSS hides.
- **TIN source:** the tenant TIN is the approved `tenant_applications.tin`, read by `tenants_get_tin` (SECURITY DEFINER, the JWT's tenant only) and served on the signed-in `GET /users/me` as `tenantTin`. It is never on the public catalog.
- **Invoice detail** now carries `billTo` (the company, its TIN and billing address).
- **EDTR sheet:** uses the brand colour and TIN.

## 7. One session per browser (QA 18)

- **Last sign-in wins.** A sign-in records the user id (never a token) in localStorage and in a cookie on the parent domain.
- **Other tabs and other ArkiLaunch sites** sign out when it changes (storage event, focus). A reload never refreshes a session that another account replaced.
- **Signing out** signs every tab of that user out.
- **`/login` and `/signup`** send a signed-in user home.
- **Refreshes** are serialized per browser (Web Locks), and each rotation is broadcast, so a duplicated tab no longer revokes the token family.

## 8. Back/forward navigation (QA 17)

- The company wizard's step lives in `?step=`, and leaving with captured documents asks first.
- The cart's request-sent screen is `?booked=`, and its registration redirect replaces.
- The registration steps refill from their draft and replace on submit.
- The review drawer is in `?open=`.
- Bookings tabs replace instead of stacking history.

## 9. Philippine primary IDs (QA 15)

- **ID types:** the ID step takes a type (PhilSys, passport, driver's license, UMID, SSS, PRC, postal, voter's, TIN ID). `PH_ID_TYPES` in `packages/shared/src/kyc.ts` holds each card's number format and normaliser.
- **Where the format is checked:** the form, the upload schema, the scan, the staff read and the registration score all check it.
- **OCR:** the one layout-plus-query read asks for `IdNumber` instead of `PhilSysCardNumber`.
- **Storage:** the type is stored as `customer_id_type` in `ocr_payload`. Rows without it are PhilSys. There is no schema change.
- **Duplicates** key on type plus number.
- **Reviewer:** sees the type with its own verification hint. The stored identity check key stays `philsysVerified` and now means "checked with its issuer".
- **Not changed:** every ID still goes to human review. No OCR value reaches a decision on its own (RFC-2).

## 10. Map pins (QA 22)

- Nominatim reports Metro Manila under `region`, not `province`. `toPinAddress` now reads it.
- `matchPhLocation` resolves a shared city name by province, then region, then exact full name, and returns nothing rather than a guess. San Juan was resolving to Ilocos Sur and Quezon City to Isabela.
- A pin with no sure match clears the previous pin's province.
- The site dialog's province fills correctly through the same function.
