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

Checkout (PayMongo-shaped, per §3): `/account/checkout/:bookingId` (method choice beside an order summary) and `/account/checkout/success` (the provider's return target), plus `/account/invoices/:invoiceId` and `/app/billing/weekly`. The frame's six payment screens collapse to two because four of them exist only to capture credentials the hosted page now takes; the cart's inline copy of the checkout call was deleted rather than left as a second path to the same endpoint.

Rental lifecycle and admin ops: `/account/bookings/:bookingId`, `/account/bookings/:bookingId/extend`, `/account/companies/new`, `/account/notifications`, `/app/notifications`, `/app/profile`, `/app/tickets`, `/app/security-logs`, `/field/notifications`, `/field/settings`, `/field/profile`.

Of these, three turned out to have endpoints nothing had ever called: `GET /bookings/:id` (items, quotation, invoices, payments), `GET /notifications` + `PATCH /notifications/:id/read`, and `GET /users/me`. The active-rental, notification-centre and profile screens are therefore real, not placeholders. `maintenance-notify` had been writing notifications that no reader existed for.

Negotiation (layout only, no transport): `/account/negotiation/$quoteId` and its `chat`, `call`, `final` children. The prototype's chat and phone-call screens have no backend, no PRD feature and no RBAC model for a negotiating party; they remain on the `cr-arkilaunch-frontend-storefront-shell.md` §4 backlog and are built here as static layout so the IA is complete and reviewable, not as working features.

## 6. Still deferred

Nine of the added routes have **no backend at all** and render a named gap rather than sample rows: `/app/tickets`, `/app/security-logs`, `/field/settings`, `/account/companies/new`, `/account/bookings/:bookingId/extend`, and the four negotiation screens. So do `/app/companies/approved` and the three `/app/registration/*` queues. A queue full of invented tickets or fabricated security events is worse than an empty one: it looks finished, it gets screenshotted into a report, and afterwards nobody can tell which numbers were real. Each screen names the exact missing query instead.

`/app/security-logs` and `/app/tickets` in particular have no backend. There is no audit endpoint and no ticket table. Both are built as layout against static placeholder rows and are marked as such in the UI; wiring them needs its own CR and an SDD §5 API addition. Every other item on `cr-arkilaunch-frontend-storefront-shell.md` §4 stands unchanged, except in-app payment credential capture, which §3 above closes as **rejected** rather than deferred.

## 7. Verification

`tsc --noEmit` clean and eslint clean across every touched file. The suite grew from 105 tests in 19 files to 141 in 21: `leaseProgress` gets three assertions (the failure that matters is not an off-by-one percentage, it is a confident "0% complete, 0 days remaining" on a hire whose dates are unknown, which reads as "your rental is over"), and a new `router.test.ts` pins `nav-config`'s targets to the registered route tree, since the sidebar and the router are hand-maintained in two different files and a nav entry pointing at an unregistered path renders as a dead link indistinguishable from a working one.

**Live-browser QA (2026-09-17).** Every screen was then run in Chromium against the seeded Almara tenant at 1440px and 360px, signed in as both `admin` and `platform_admin`: 36 route/viewport captures plus the parameterised detail screens against real invoice and booking records. Result: **zero horizontal overflow at 360px, no console errors, no failed requests**, and the platform-only company screens correctly redirect a tenant `admin` to `/app` while rendering for `platform_admin`.

It found three defects that every static check had passed:

1. **`/account/negotiation/:id/chat`, `/call` and `/final` crashed to the error boundary.** All four screens read `accountNegotiationRoute.useParams()`, but the three children are siblings of that route rather than nested under it, so its match is not active on them and each threw "Could not find an active match". The route-resolution test could not catch this -- the routes resolve; the component throws once mounted. This is the argument for the live pass: a green unit suite said nothing about three of the added screens being unreachable.
2. **Weekly billing listed the same money twice** -- "Deposit deduction" and "Deposit deducted" both rendering PHP 37,187.50, which reads as a double charge.
3. **An invoice line dumped three raw UUIDs** at the customer; `condenseIds()` now renders them as the `REC-` references used elsewhere, keeping traceability.

All three are fixed and covered. Suite: **144 tests / 22 files**.

**Still not claimed:** the screens were checked for structure, data correctness and overflow, not pixel-diffed against their Figma frames; the prototype's palette is deliberately not matched, so a pixel diff would fail by design. Three captures showed a query still loading at screenshot time (bookings, notifications) -- verified as harness timing against a remote Supabase, since the same endpoints answer in under two seconds and render fully on a direct load.
