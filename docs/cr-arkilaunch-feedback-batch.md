# Change Record

**Title:** Customer/admin feedback batch: KYC waiting state, availability, truck pricing, callback gate, unit rate cards, deposit rollover
**Project:** ArkiLaunch
**Date:** 2026-09-25
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user feedback list 2026-09-24
**Docs touched by this record:** [index.md](index.md) §2, [cr-arkilaunch-customer-prerequisites.md](cr-arkilaunch-customer-prerequisites.md) (quotes now gated on verification), [cr-arkilaunch-cart-validation.md](cr-arkilaunch-cart-validation.md) (the API now enforces the verified-company gate too)

---

## 1. What changed

| Area | Change | Migration |
|---|---|---|
| Sign-in | `POST /auth/forgot-password`: always 200, 5/min, alerts that tenant's admins. There's no email provider, so the admin resets the password and hands over the `/activate` link. | — |
| KYC | Free-size crop on every document image. DTI and PCN format checks are persisted. "Resubmit required" is removed: a submitted company is read-only while pending. The reviewer comments and unlocks specific fields/documents (one use each) and the customer is notified. The admin sees "Edited by customer" plus the scanned value instead of the read %. The Onboarding page is removed; the `/kyc/*` API is kept for the evals. | 0034 |
| Equipment | 14 standard categories plus "Others" (with `category_note`). Maintenance schedules per task, with presets. Manual hour-meter correction (audited, with reason). 90% warning. Maintenance date windows. | 0035 |
| Booking | `availabilityBlockers()` covers assignments, maintenance windows, business hours, holidays and operator clashes. New `GET equipment/:id/availability`. The web grid shows only free days. A deployed unit can be booked for later dates. Staff get a reschedule suggestion. Past truck pickups are rejected. | 0036 |
| Trucks | Map pins are routed straight to OSRM. Admin toll list. Admin free-text formula (safe parser, no `eval`). Low–high estimate with a locked cap; exceeding the cap needs customer re-approval. Tenant diesel region. Truck checkout now requires a verified company. | 0037 |
| Payment | Customer requests a call, staff mark it "confirmed by phone", and checkout returns `call_not_confirmed` until then. Staff alerts on payment paid/failed/disputed and on truck requests. | 0037 |
| Quotes | Unit rate card overrides the type rate; one price for every customer, shown upfront. `company_not_verified` on quote create/revise and on booking. Audited agreed line price. **Daily rates were billed as hourly (8× overcharge); now divided by the tenant's daily hours.** | 0038 |
| Deposit | Tenant minimum deposit. At zero, approval no longer throws `deposit_exhausted`: the remainder becomes a `deposit_accruals` row and `jobs/src/weekly-billing.ts` issues weekly invoices (PayMongo or cash). Low-balance alert at 20%. Field logs grouped by rental. | 0038, 0039 |

## 2. Money path (RFC-2)

Accruals and deductions are written only inside `approve()`, after the existing reconciliation, human-approval and accuracy gates. `deposit_accruals.reconciliation_id` is UNIQUE, and the weekly job bills with `FOR UPDATE` on unbilled rows. Approval also locks the rental row before it reads the balance, so two pairs approved at the same time can't over-draw the deposit.

## 3. Deliberately not claimed

- Tapping "Pay now" twice on a weekly invoice opens two PayMongo sessions (no dedupe yet).
- The weekly-billing job is not wired into the ACA cron, and its main-module check doesn't fire on Windows paths.
- There's no web UI to pick an operator; the day grid is whole-day and assumes Manila time.
- Toll detection is manual, from the admin's list.
- The eDTR weather attestation is deferred to its own PR; that proposal is still Draft.
- The 17 API and 3 weather-poll test failures are pre-existing: dev DB drift (the seeded customer owns several companies) and a weather-poll failure that also occurs on dev.
