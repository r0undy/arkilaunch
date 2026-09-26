# Change Record

**Title:** PayMongo online payments via per-tenant child accounts (PayMongo Platforms), live test-mode verification
**Project:** ArkiLaunch
**Date:** 2026-09-26
**Version:** 0.1
**Status:** `Applied` (test mode; split routing pending a real linked child, see §6)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [prd-arkilaunch.md](prd-arkilaunch.md) PRD-F2 US-08 AC2 (amended, §3), [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) RFC-2 deduction gate (tightened, §4), [cr-arkilaunch-f2-f8-bookings-payments.md](cr-arkilaunch-f2-f8-bookings-payments.md) §5 (event names superseded), [ops-arkilaunch.md](ops-arkilaunch.md) §4.2 (runbook), [index.md](index.md)

---

## 1. Summary

PayMongo Hosted Checkout was scaffolded (f2-f8 CR) but never switched on. This pass verified every API assumption against the live test-mode API, fixed the defects that would have broken it, and changed the money flow so each rental company is paid directly:

- **ArkiLaunch's PayMongo account is the parent; each tenant is a child merchant** (PayMongo Platforms / Linked Accounts). A checkout is created with ArkiLaunch's key and `split_payment.transfer_to = <tenant org_id>`, so the net amount lands in the tenant's own PayMongo wallet. One webhook endpoint and one secret serve every tenant. No platform fee.
- **Onboarding:** the platform admin invites the company from PayMongo (Settings → Invitations); the company does PayMongo's own KYC/KYB; the admin pastes its `org_…` id in `/admin/companies` → Payments. Stored in `tenants.paymongo_account_id` (migration 0053), written only by `tenants_set_paymongo_account` (audited).
- **Unlinked tenant = cash only** (`409 online_payment_unavailable`). ArkiLaunch never holds a tenant's money.

## 2. Findings (live test mode, 2026-09-26)

| Assumption in the f2-f8 build | Live result |
|---|---|
| Webhook signature checked in `li` | Test-mode deliveries carry `te=<sig>,li=` (empty). Every sandbox event was a 403. Now `te` when the key is `sk_test_…`, else `li`. |
| Settles on `payment.paid` | Both `payment.paid` and `checkout_session.payment.paid` fire. We settle on `checkout_session.payment.paid`: its resource is our session (`provider_ref`) with `payments[]` (pay_ id, amount). |
| `refund.succeeded`, `dispute.created/resolved` | `POST /v1/webhooks` rejects all three as invalid event types. Refunds arrive as `payment.refund.updated` (resource = refund: `ref_` id, `payment_id`, `status`). Dispute handling removed; disputes stay a dashboard/manual process. |
| `metadata` reaches the payment (unverified) | Confirmed: checkout-session `metadata` is copied onto the payment intent and the payment. |
| Channel codes | `gcash`, `paymaya`, `qrph`, `dob`, `card` all accepted. QR Ph added. |
| `split_payment` | Schema `{ transfer_to, recipients[] }`. Rejects the parent's own org and unknown orgs (`split_payment_not_allowed`). `POST /v2/accounts` in test mode returns a **mock, unpersisted** `org_test_merchant`, which split refuses — a real child must come from a dashboard invite. |
| Refund API | `POST /v1/refunds {amount, payment_id, reason}` works on a paid payment; status `pending` then `succeeded` by webhook. |

End-to-end with the real API (non-split session): a real signed `checkout_session.payment.paid` settled the invoice, confirmed the rental and stamped `provider_payment_id`; a real partial refund arrived as `payment.refund.updated` and wrote exactly one `refunded` row.

## 3. Behaviour changes

- **Return check (amends PRD-F2 US-08 AC2 "status only from the webhook").** `POST /me/invoices/:id/confirm-payment`, polled by the success page, asks PayMongo *server to server* (`GET /v1/checkout_sessions/:id`) and settles if paid. The browser redirect itself still proves nothing. Both paths share one settle function.
- **Idempotency / amount.** Settlement is a no-op unless the invoice is still `issued`, and only when the collected centavos equal the invoice exactly (mismatch → `payment_amount_mismatch` staff alert, no settle). Refund rows are keyed on the refund's `ref_` id in the globally unique `provider_ref` (`ON CONFLICT DO NOTHING`). Closes audit-db-tenant-isolation #8 for payments.
- **Non-uuid `metadata.invoice_id`** is acked as unresolved instead of a 500 retry loop.
- **Return URLs** follow the customer's storefront origin (validated against the CORS shape) with `?invoice=`; `PAYMONGO_SUCCESS_URL` / `PAYMONGO_CANCEL_URL` retired.
- **Staff refunds** `POST /invoices/:id/refund` (`quote:approve`) on the invoice's paid online payment; audited; the `refunded` row comes only from the webhook.
- **Boot:** `ENABLE_PAYMENTS=true` without `PAYMONGO_SECRET_KEY` and `PAYMONGO_WEBHOOK_SECRET` fails boot (same posture as the OCR flags).

## 4. RFC-2: deduction only from a paid deposit

`edtr.service.ts` approve now refuses (`409 deposit_not_paid`) unless the rental has a `paid` `deposit` or `booking` invoice. Previously `resolveDepositLedger` knew only what was *required*, so a deduction could draw on a deposit never collected.

## 5. Migration 0053 (additive)

`tenants.paymongo_account_id` (+ CHECK `^org_[A-Za-z0-9]+$`), `tenants_set_paymongo_account`, `tenants_get_paymongo_account`, `payments.provider_payment_id` (unique), `payments_find_tenant_by_provider_payment` (refund-webhook pre-tenant lookup). All SECURITY DEFINER functions are single-purpose, `search_path`-pinned, REVOKE PUBLIC / GRANT app_authenticated.

## 6. Open items

- **Split routing unverified end to end:** needs one real child linked via dashboard invite. Then pay a storefront checkout and confirm the funds land in the child's wallet, and that a refund on a split payment reverses correctly. If `split_payment` misbehaves, fall back to acting as the child (`Account-ID` header, per-child webhook).
- **Deploy (Azure dev):** set GitHub secrets `PAYMONGO_SECRET_KEY` / `PAYMONGO_WEBHOOK_SECRET` (a webhook registered for the dev API URL), then `enable_payments = true` in `infra/terraform/environments/dev/terraform.tfvars`.
- **Key hygiene:** the test key was shared in a chat session; rotate before live keys are issued.
