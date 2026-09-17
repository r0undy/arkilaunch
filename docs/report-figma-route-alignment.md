# Report: Figma prototype ↔ shipped route alignment

**Project:** ArkiLaunch
**Date:** 2026-09-17
**Status:** Reference (not a suite doc)
**Figma file:** `kqLTdB0RjduogSqpjB8uKr` — "ArkiLaunch Prototype", page `0:1` Prototype
**Companion:** [cr-arkilaunch-figma-ia-alignment.md](cr-arkilaunch-figma-ia-alignment.md)

---

## 1. Method

`mcp__figma__get_metadata` on page `0:1` returns ~2.9M characters; the top-level frame list was extracted from it rather than re-fetched per frame. The page holds ~180 frames: a 1440px desktop frame per screen, a 420px mobile twin for most, and a tail of loose vectors and button fragments that are not screens.

Three structural notes on the file itself:

- **Three landing variants** (`144:1386` Landing Page, `177:2169` Landing Page-Locked, `238:3694` Landing Page Locked 2) are design iterations, not states. Newest wins; the other two are dead.
- **Mobile twins are honoured as responsive breakpoints**, not separate builds. One implementation per screen.
- The file key differs from the `7rUbrJxQpw0nNRWegoQRtZ` prototype that `cr-arkilaunch-frontend-storefront-shell.md` read. Frame ids in that CR do not resolve here.

## 2. Matched — prototype screen has a shipped route

| Figma frame | Node | Route |
|---|---|---|
| Landing Page | `144:1386` | `/` |
| Login | `144:1451` | `/login` |
| Register Personal Details | `144:1496` | `/register` |
| Register Company Details | `144:1575` | `/register/company` |
| Admin Approval | `144:1630` | `/register/pending` |
| Equipments Page | `185:1599` | `/equipment` |
| Rental Page | `168:1527` | `/equipment/$equipmentId` |
| Home Page | `168:1713` | `/account` |
| User Settings | `168:1834` | `/account/settings` |
| Cart Page | `168:1982` | `/account/cart` |
| My Bookings Page | `251:1818` | `/account/bookings` |
| Manage Applications | `251:1945` | `/account/applications` |
| Admin Dashboard | `236:1941` | `/app` |
| Deployment | `261:2339` | `/app/deployment` |
| Inventory | `261:3065` | `/app/inventory` |
| OCR Tool / OCR Tool Review | `276:7877` / `731:1323` | `/app/ocr` |
| Insights - Transaction | `261:4058` | `/app/insights` |
| Insights Utilizations | `261:4466` | `/app/insights` |
| Payments Pending / Approved / Paid | `261:5886` / `261:6366` / `282:6684` | `/app/payments` |
| Incident Log Page | `261:5052` | `/app/incidents` |
| Settings | `282:6865` | `/app/settings` |
| Manage Users | `536:950` | `/app/users` |
| Operator Dashboard | `350:1268` | `/field` |
| Deployment - Operator | `350:1540` | `/field/deployment` |
| Help Center | `750:6444` | `/help` |
| Contact Support | `652:9896` | `/contact` |

Inventory add / edit / delete / delete-confirmation (`292:1344`, `293:2668`, `293:2913`, `293:3256`) and the Equipments date-picker (`251:3418`) are modal states of their parent route, not routes.

## 3. In the prototype, not in the code — the build list

| Figma frame | Node | Route added | Priority |
|---|---|---|---|
| Billing Invoice Page | `168:2304` | `/account/invoices/$invoiceId` | A |
| Payment Page - Digital Bank | `168:2161` | `/account/checkout/$bookingId` | A |
| Payment Page - Bank Transfer | `216:2049` | `/account/checkout/$bookingId` | A |
| Payment Confirmation | `168:3297` | `/account/checkout/$bookingId` | A |
| Bank Transfer Successful | `168:3376` | `/account/checkout/success` | A |
| Weekly Billing | `280:2095` | `/app/billing/weekly` | A |
| Registration Pendings | `282:7320` | `/app/registration/pending` | B |
| Registration Verified | `282:7784` | `/app/registration/verified` | B |
| Registration Review | `349:942` | `/app/registration/review` | B |
| Pending Company Approval | `621:8341` | `/app/companies/pending` | B |
| Approved Companies | `621:8533` | `/app/companies/approved` | B |
| Manage Company Application | `369:1589` | `/app/companies/$applicationId` | B |
| Manage Active Rental | `238:2117` | `/account/bookings/$bookingId` | C |
| Extend Rental | `231:5204` | `/account/bookings/$bookingId/extend` | C |
| Add Company | `582:3946` | `/account/companies/new` | C |
| Notification | `168:3011` | `/account/notifications` | C |
| Notifications (admin) | `276:7669` | `/app/notifications` | C |
| Admin Profile | `271:6855` | `/app/profile` | C |
| Ticket Management | `613:5692` | `/app/tickets` | C |
| Security Logs | `613:5693` | `/app/security-logs` | C |
| Notifications - Operator | `359:2970` | `/field/notifications` | C |
| Settings - Operator | `360:4603` | `/field/settings` | C |
| Operator Profile | `360:4903` | `/field/profile` | C |
| Manage Nego Details | `238:2649` | `/account/negotiation/$quoteId` | C |
| Messenger Chat Nego | `225:3084` | `/account/negotiation/$quoteId/chat` | C |
| Call Nego | `225:3085` | `/account/negotiation/$quoteId/call` | C |
| Nego Finalized | `225:3087` | `/account/negotiation/$quoteId/final` | C |

### Not built, deliberately

| Figma frame | Node | Why |
|---|---|---|
| Payment Authentication Gcash | `168:3138` | Captures payment credentials in-app. DSD §4.1 (Locked) forbids it; PayMongo hosted checkout supersedes. See CR §3. |
| OTP Verification | `168:3214` | Same. |
| Landing Page-Locked, Locked 2 | `177:2169`, `238:3694` | Dead design iterations. |

## 4. In the code, not in the prototype

Kept. These are real, working surfaces the prototype never caught up with — design debt on Figma's side, not code to delete.

| Route | Why it exists |
|---|---|
| `/app/quotes` | PRD-F1 dynamic quotation, live backend (`POST /quotes`). Already flagged in `cr-arkilaunch-frontend-storefront-shell.md:39` as kept deliberately. |
| `/app/registration` | KYC submission flow (PRD-F6, S17). The prototype models the admin review states but not the submission itself. |
| `/terms`, `/privacy` | Required by CLR; prerendered public routes. |

## 5. Known gaps behind the new routes

Endpoints that turned out to exist and had never been called by anything:
`GET /bookings/:id`, `GET /invoices/:id`, `GET /notifications` +
`PATCH /notifications/:id/read`, and `GET /users/me`. The active rental,
invoice, notification-centre and profile screens are real as a result.


- `/app/security-logs` — no audit endpoint exists. Layout only, placeholder rows.
- `/app/tickets` — no ticket table, no endpoint. Layout only.
- `/account/negotiation/*` — no negotiation backend, no RBAC model for a negotiating party. Layout only.
- `/app/notifications`, `/account/notifications`, `/field/notifications` — no notification endpoint; the app bar's notification affordance (DSD §4.1 Nav shell) is likewise unbuilt.
- Profiles read `GET /users/me`, which is read-only: nothing writes a display name, avatar or phone number back, so no edit affordance is offered.
- `/account/bookings/:id/extend` -- bookings can be created, listed and read; no endpoint moves a return date.
- `/account/companies/new` -- `POST /tenants/register` takes the personal details from the first registration step and nothing attaches a second company to an existing account.
- `/app/companies/approved` and the three `/app/registration/*` queues -- `tenants_list_pending_applications` returns pending rows only, and KYC documents are readable one at a time by document id with nothing listing them per tenant or per state.
- The Figma company-application frame's compliance repository and verification trail need that same missing KYC list.
