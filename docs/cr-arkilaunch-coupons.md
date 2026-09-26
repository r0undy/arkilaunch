# Change Record

**Title:** Tenant coupon codes at booking checkout; PayMongo switched on for the dev deploy; consumable-deposit wording
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Applied` (code); PayMongo on the dev deploy waits for the operator steps in §6
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [prd-arkilaunch.md](prd-arkilaunch.md) PRD-F2 US-08 (checkout gains a coupon field), [sdd-arkilaunch.md](sdd-arkilaunch.md) §3 catalog (two tables), [rfc-arkilaunch-quotation-pricing-engine.md](rfc-arkilaunch-quotation-pricing-engine.md) §3 (a second, customer-applied discount after the quote), [qad-arkilaunch.md](qad-arkilaunch.md) §3.8 (QAD-T49..T51), [ops-arkilaunch.md](ops-arkilaunch.md) §4.2, [index.md](index.md)

---

## 1. Summary

- **Coupons.** A rental company (tenant) creates coupon codes at `/app/coupons` (`pricing:manage`, the staff who set billing settings). Its customers enter a code on `/account/checkout/:bookingId`. The coupon takes money off the **rent line** of the booking invoice. The **consumable deposit** (prepaid hours that approved EDTR draws down) is never discounted, so the deposit ledger (`resolveDepositLedger`) is unaffected.
- **Rules (v1):** percent (≤ 100) or fixed PHP; optional expiry; optional max total uses; optional once per customer **company** (`customers.id`, the owner of the booking). One coupon per invoice. The discount is capped at the rent, rounded half-up like the quote discount (RFC-3 §3).
- **PayMongo on the deployed app.** The code, Terraform wiring and `deploy.yml` passthrough were already in place (cr-arkilaunch-paymongo-linked-accounts). Dev ran the stub only because `enable_payments = false` and the `dev` GitHub environment had no PayMongo secrets. This change flips the flag. The operator steps in §6 must land first.
- **Wording.** The deposit is consumable, not refundable: the booking invoice line, the checkout summary and the final-terms page now say "Consumable deposit". "Unlinked company = cash only" comments and the runbook now describe the interim parent-collects behaviour the code actually has.

## 2. Decisions

| Decision | Why |
|---|---|
| Tenant-issued only | The platform does not bill tenants (subscriptions are schema-only), so a platform coupon has nothing to discount yet. |
| Rent line only | The deposit is a prepaid-hours balance; discounting it would either short the ledger or grant free hours silently. |
| Rent line lowered in place, no negative line | `invoice_line_items_nonneg_chk` stays as is (audit-db-tenant-isolation.md #5). The line's description records `coupon CODE -PHP X`; `coupon_redemptions` holds the exact discount. |
| A use counts when applied, not when paid | Simpler and race-free: one guarded `UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE … < max_uses RETURNING`, which also row-locks the coupon so once-per-company is checked serially. An abandoned booking keeps its use (the same booking reuses the same invoice). Release on void if that turns out to matter. |
| Re-pricing an issued invoice | A customer who backed out of PayMongo once still has an issued invoice with a pending session at the old amount. Applying a coupon re-prices that invoice once, marks its pending payments `failed`, and expires their sessions (`POST /v1/checkout_sessions/:id/expire`) so the old amount can no longer be paid. If PayMongo already reports the session paid, it answers `409 payment_in_progress` and leaves the invoice alone. |
| One error for every miss | Unknown, expired, inactive and used-up codes all answer `409 coupon_invalid`, so the preview can't be used to learn which codes exist. `coupon_used` (the company already used a once-per-company code) is the only distinct answer, because it is only reachable with a valid code. The preview is throttled at 10/min. |
| Codes never edited | Customers may already hold a code. Staff can only switch a code off or on. |

## 3. Behaviour changes

- `POST /api/v1/bookings/:id/checkout` accepts `couponCode` (optional). Honoured only on a booking with an accepted quote. New 409s: `coupon_invalid`, `coupon_used`, `coupon_already_applied`, `payment_in_progress`.
- `POST /api/v1/bookings/:id/coupon {code}` (`payment:checkout`) previews `{ code, discountPhp, rentPhp, depositPhp, totalPhp }`. It is read-only; checkout re-checks and claims.
- `GET/POST /api/v1/coupons` and `PATCH /api/v1/coupons/:id {active}` (`pricing:manage`, audit-logged).
- `PaymentsPort.expireCheckoutSession` added (the stub is a no-op).
- Checkout summary: an issued booking invoice is shown at its stored amount, so a coupon applied earlier shows. The weekly-invoice Pay button no longer navigates to the stub's `about:blank`.

## 4. Migration 0057

`0057_coupons.sql` (hand-authored, additive, idempotent):
- `coupons`: tenant-scoped; `UNIQUE (tenant_id, code)`; CHECKs on code shape, discount type/value, max_uses > 0.
- `coupon_redemptions`: tenant-scoped; `UNIQUE (invoice_id)`; `discount_php > 0`.

Both tables use ENABLE + FORCE RLS and the RFC-1 §3 `tenant_isolation` policy. Grants are minimal: SELECT/INSERT on both, plus column UPDATE of `coupons.active` and `redeemed_count` only.

## 5. Tests

- `apps/api/src/payments/coupons.spec.ts`: discount math (percent rounding, cap at rent, zero rent).
- `apps/api/test/coupons-engine.spec.ts` (QAD-T49..T51):
  - rent-only discount, with the deposit line unchanged
  - an idempotent retry
  - re-pricing expires the old session
  - one coupon per invoice
  - expired, inactive, used-up and unknown codes all answer `coupon_invalid`
  - once-per-company, with the refused claim rolled back
  - tenant isolation
- `packages/db/test/rls-enumeration.spec.ts` picks up both tables automatically.

## 6. Operator steps to turn PayMongo on for dev (before merging to `dev`)

1. Register a **new** webhook for the deployed API. Keep the local ngrok hook for local dev.
   `POST https://api.paymongo.com/v1/webhooks` with the parent `sk_test_…` key:
   - `url = https://ca-arkilaunch-dev-api.bravemeadow-f24d6096.southeastasia.azurecontainerapps.io/api/v1/webhooks/paymongo`
   - `events = checkout_session.payment.paid, payment.failed, payment.refund.updated`
2. Save the key and that webhook's `whsk_…` to the **`dev` GitHub environment**:
   - `gh secret set PAYMONGO_SECRET_KEY --env dev`
   - `gh secret set PAYMONGO_WEBHOOK_SECRET --env dev`
3. Merge. `enable_payments = true` (dev tfvars) makes the next deploy use the real adapter. The API refuses to boot if either secret is missing, so step 2 must come first.
4. The test key was shared in a chat session (cr-arkilaunch-paymongo-linked-accounts §6). Rotate it, then repeat step 2 with the new key.

## 7. Deliberately not claimed

- No platform-wide coupons and no coupons on truck, weekly or deposit-only invoices.
- No coupon stacking. The staff quote discount (RFC-3) still applies first; the coupon comes off the resulting rent.
- The expire endpoint's error on an already-expired session is ignored. That call has not been exercised against the live API.

## 8. Follow-up (2026-09-27): staff change an unpaid invoice's amount

A 99.9% coupon still left the consumable deposit, so the charge stayed large. Staff now have a direct control.

- **`POST /api/v1/invoices/:id/amount {amountPhp, reason}`** (`quote:approve`, the staff who agree prices and take cash). It works on an **issued** `booking`, `deposit` or `truck` invoice. The UI is "Change amount" in the invoice panel at `/app/payments`.
- **Lower only.** The amount can never go above the current one (`409 amount_above_invoice`), because the customer agreed to the price they saw. The floor is **PHP 1.00**, PayMongo's smallest checkout total, which was probed live: a 0 total is refused with "Total amount must be between 1.00 and 999,999,999.99".
- **Rent comes off first.** The cut is taken from the rent line first and the consumable deposit last. Each line notes `adjusted by staff -PHP X`. A cut that reaches the deposit line does **not** lower the contract's `deposit_required`, so the ledger still credits the full deposit. This is a deliberate staff decision.
- **Pending payments are closed.** Like a coupon re-price, pending payments are marked `failed` and their PayMongo sessions expired. The customer's next checkout charges the new amount.
- **Audit-logged.** Each change writes `audit_logs` `UPDATE invoices` with the reason `amount PHP old -> PHP new: <reason>`.
- **Online checkout floor.** Online checkout under PHP 1.00, e.g. after a 100% coupon on a zero-deposit invoice, now answers `409 amount_below_minimum` instead of a 500.
- **Test:** QAD-T52, in `coupons-engine.spec.ts`.

A real peso leaves a GCash wallet only in PayMongo **live** mode. That needs an activated account, the live key and a live webhook in the `dev` GitHub environment. Test mode simulates the GCash page.
