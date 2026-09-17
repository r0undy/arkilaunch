# Change Record

**Title:** Reconcile the PRD §5.2 IA tree with the shipped route map and the current Figma prototype; add the missing screens
**Project:** ArkiLaunch
**Date:** 2026-09-17
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user-supplied Figma prototype (`kqLTdB0RjduogSqpjB8uKr`, page `0:1 Prototype`), read via the Figma MCP server; reconciled against the Locked PRD §5.1/§5.2 and the shipped `apps/web/src/router.tsx`
**Docs touched by this record:** [prd-arkilaunch.md](prd-arkilaunch.md) §5.2 (Locked, amended); [index.md](index.md) §2; new [report-figma-route-alignment.md](report-figma-route-alignment.md)

---

## 1. Why

`cr-arkilaunch-frontend-storefront-shell.md` §5 left an open obligation:

> "`/account/*` is a new IA branch not named in the PRD's IA tree ... a future CR should reconcile the PRD §5.2 IA tree itself if this pass's `/account/*` branch is kept as the permanent shape."

The branch was kept. Three IAs have since been running in parallel with no single authority: the Locked PRD §5.2 tree, the shipped route map, and the Figma prototype. Nobody had diffed them, so "is this screen missing or was it deliberately dropped?" had no answerable form.

Two further facts forced this record:

- **The prototype is a different file from the one the last CR read.** That CR sourced `7rUbrJxQpw0nNRWegoQRtZ` (~120 frames). The user now supplies `kqLTdB0RjduogSqpjB8uKr` (~180 frames). The new file is a superset, not a revision of the same key, so the earlier CR's frame references are no longer resolvable against it.
- **The shipped routes never matched PRD §5.2 in the first place.** `/app/fleet` shipped as `/app/inventory`, `/app/edtr` as `/app/ocr`, `/app/sites` as `/app/deployment`, `/app/reports` as `/app/insights`, `/app/billing` as `/app/payments`, `/app/kyc` as `/app/registration`, and `/app/bookings` moved to `/account/bookings`. The renames were applied in the storefront-shell pass but §5.2's table and tree were never updated to match, so the Locked doc has been describing routes that do not exist for over a month.

## 2. Decision

**Figma is the authority for information architecture**, with one carve-out (§3). PRD §5.2's destination table and IA tree are amended to the shipped names plus the screens added by this pass. The frozen `S1`-`S25` screen IDs in §5.1 are **not** renumbered — new prototype screens are recorded in the alignment report, not spliced into the frozen inventory.

## 3. Carve-out: the payment flow stays hosted

The prototype's payment area is six screens: Digital Bank, Bank Transfer, GCash Authentication, OTP Verification, Payment Confirmation, Bank Transfer Successful. Four of those capture payment credentials inside ArkiLaunch.

This is **not** adopted. It contradicts:

- **DSD §4.1 (Locked)** — "Don't: collect card data in-app."
- `cr-arkilaunch-frontend-storefront-shell.md` §4, which deferred in-app payment credential capture as "explicitly superseded by PayMongo hosted checkout per the user's decision; only pre/post screens are ever appropriate here (PRD-F2)."

Confirmed with the user on 2026-09-17: build the **PayMongo-shaped subset** only. Method selection, confirmation, success and the invoice surfaces come from the prototype's layout; the GCash-authentication and OTP screens are not built, in-app or as mockups. Handoff remains PayMongo hosted checkout. No route added by this pass touches a deposit balance (RFC-2 money-path gate); every one is read-only against existing endpoints.

## 4. Amended PRD §5.2 destination table

| Destination | Nav label | Screen | Route (was) | Route (now) | Auth |
|---|---|---|---|---|---|
| Dashboard | Dashboard | S4 | `/app` | `/app` | tenant |
| Quotes | Quotes | S5 / S6 | `/app/quotes` | `/app/quotes` | tenant |
| EDTR | Field logs | S7 / S8 | `/app/edtr` | `/app/ocr` | tenant |
| Billing | Invoices | S9 | `/app/billing` | `/app/payments` | tenant |
| Fleet | Equipment | S10 / S11 | `/app/fleet` | `/app/inventory` | tenant |
| Sites | Sites and deployment | S12 / S13 | `/app/sites`, `/app/weather` | `/app/deployment` | tenant |
| Incidents | Incident log | S14 | `/app/incidents` | `/app/incidents` | tenant |
| Reports | Reports | S15 / S20 | `/app/reports` | `/app/insights` | tenant |
| Bookings | My bookings | S16 | `/app/bookings` | `/account/bookings` | customer |
| KYC | Onboarding | S17 | `/app/kyc` | `/app/registration` | admin |
| Settings | Rate cards | S18 | `/app/settings` | `/app/settings` | admin |
| Users | People | S19 | `/app/settings/users` | `/app/users` | admin |
| Field | Dashboard | S21 | `/field` | `/field` | timekeeper |
| Catalog | Browse equipment | S22 | `/t/:tenantSlug` | `/equipment` | public |
| Platform | Company applications | S25 | `/platform` | `/app/platform-applications` | platform admin |

`/account/*` is hereby a named branch of the IA, not drift: `/account`, `/account/bookings`, `/account/applications`, `/account/cart`, `/account/settings`, plus the routes added below.

## 5. Routes added by this pass

Registration split (prototype models six states the code lumped into two routes):
`/app/registration/pending`, `/app/registration/verified`, `/app/registration/review`, `/app/companies/pending`, `/app/companies/approved`, `/app/companies/$applicationId`.

Checkout (PayMongo-shaped, per §3): `/account/checkout`, `/account/checkout/confirm`, `/account/checkout/success`, `/account/invoices/$invoiceId`, `/app/billing/weekly`.

Rental lifecycle and admin ops: `/account/bookings/$bookingId`, `/account/bookings/$bookingId/extend`, `/account/companies/new`, `/account/notifications`, `/app/notifications`, `/app/profile`, `/app/tickets`, `/app/security-logs`, `/field/notifications`, `/field/settings`, `/field/profile`.

Negotiation (layout only, no transport): `/account/negotiation/$quoteId` and its `chat`, `call`, `final` children. The prototype's chat and phone-call screens have no backend, no PRD feature and no RBAC model for a negotiating party; they remain on the `cr-arkilaunch-frontend-storefront-shell.md` §4 backlog and are built here as static layout so the IA is complete and reviewable, not as working features.

## 6. Still deferred

`/app/security-logs` and `/app/tickets` have **no backend**. There is no audit endpoint and no ticket table. Both are built as layout against static placeholder rows and are marked as such in the UI; wiring them needs its own CR and an SDD §5 API addition. Every other item on `cr-arkilaunch-frontend-storefront-shell.md` §4 stands unchanged, except in-app payment credential capture, which §3 above closes as **rejected** rather than deferred.

## 7. Verification

`tsc --noEmit` clean; the existing vitest suite passes; `nav-config` targets all resolve; each new page visually diffed against its Figma frame at 1440px and checked for zero horizontal overflow at 360px.
