# Report: Figma prototype ↔ shipped route alignment

**Project:** ArkiLaunch
**Date:** 2026-09-23 (supersedes the 2026-09-17 revision)
**Status:** Reference (not a suite doc)
**Figma file:** `ENpes2ZBsS3baRPKLyx0d3` — "ArkiLaunch Prototype (Copy)", page `0:1` Prototype
**Companion:** [cr-arkilaunch-figma-ia-alignment.md](cr-arkilaunch-figma-ia-alignment.md)

---

## 1. Method

`mcp__figma__get_metadata` on page `0:1` returns ~2.96M characters; the top-level
frame list was extracted from it rather than re-fetched per frame. The page holds 178
top-level nodes: a 1440px desktop frame per screen, a 420px mobile twin for most, and
a tail of loose vectors and button fragments that are not screens.

Route truth is `apps/web/src/router.tsx` — TanStack Router, code-based route tree
(not file-based), five layouts: `_public`, `_auth`, `_account`, `_app`, `_field`.

Structural notes on the file itself:

- **Three landing variants** (`144:1386` Landing Page, `177:2169` Landing Page-Locked,
  `238:3694` Landing Page Locked 2) are design iterations, not states. Newest wins;
  the other two are dead.
- **Three "Add Company" desktop variants** (`168:2442` Add Company - Home Page,
  `582:3946`, `450:2068`) are likewise iterations. See §5.
- **Mobile twins are honoured as responsive breakpoints**, not separate builds. One
  implementation per screen.
- **The file key changed.** The 2026-09-17 revision read `kqLTdB0RjduogSqpjB8uKr`;
  this copy preserved node ids, so frame references from that revision still resolve,
  but ~10 frames added since were never covered by it. The older
  `7rUbrJxQpw0nNRWegoQRtZ` prototype read by
  `cr-arkilaunch-frontend-storefront-shell.md` remains unrelated; ids there do not
  resolve here.

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
| Manage Active Rental | `238:2117` | `/account/bookings/$bookingId` |
| Extend Rental | `231:5204` | `/account/bookings/$bookingId/extend` |
| Add Company | `582:3946` | `/account/companies/new` |
| Billing Invoice Page | `168:2304` | `/account/invoices/$invoiceId` |
| Payment Page - Digital Bank | `168:2161` | `/account/checkout/$bookingId` |
| Payment Page - Bank Transfer | `216:2049` | `/account/checkout/$bookingId` |
| Payment Confirmation | `168:3297` | `/account/checkout/$bookingId` |
| Bank Transfer Successful | `168:3376` | `/account/checkout/success` |
| Notification | `168:3011` | `/account/notifications` |
| Manage Nego Details | `238:2649` | `/account/negotiation/$bookingId` |
| Messenger Chat Nego | `225:3084` | `/account/negotiation/$bookingId/chat` |
| Call Nego | `225:3085` | `/account/negotiation/$bookingId/call` |
| Nego Finalized | `225:3087` | `/account/negotiation/$bookingId/final` |
| Admin Dashboard | `236:1941` | `/app` |
| Deployment | `261:2339` | `/app/deployment` |
| Deployment-OCR Tool Selector [Admin] | `587:2324` | `/app/ocr/deployments` |
| Deployment-OCR Tool Selector [Operator] | `593:1157` | `/field/scan` |
| Inventory | `261:3065` | `/app/inventory` |
| OCR Tool / OCR Tool Review | `276:7877` / `731:1323` | `/app/ocr` |
| Insights - Transaction | `261:4058` | `/app/insights` |
| Insights Utilizations | `261:4466` | `/app/insights` |
| Payments Pending / Approved / Paid | `261:5886` / `261:6366` / `282:6684` | `/app/payments` |
| Weekly Billing | `280:2095` | `/app/billing/weekly` |
| Incident Log Page | `261:5052` | `/app/incidents` |
| Settings | `282:6865` | `/app/settings` |
| Manage Users | `536:950` | `/app/users` |
| Admin Profile | `271:6855` | `/app/profile` |
| Notifications (admin) | `276:7669` | `/app/notifications` |
| Registration Review | `349:942` | `/app/registration/review` |
| Registration Pendings | `282:7320` | `/app/registration/pending` |
| Registration Verified | `282:7784` | `/app/registration/verified` |
| Pending Company Approval | `621:8341` | `/app/companies/pending` |
| Approved Companies | `621:8533` | `/app/companies/approved` |
| Manage Company Application | `369:1589` | `/app/companies/$applicationId` |
| Ticket Management | `613:5692` | `/app/tickets` |
| Security Logs | `613:5693` | `/app/security-logs` |
| Operator Dashboard | `350:1268` | `/field` |
| Deployment - Operator | `350:1540` | `/field/deployment` |
| Notifications - Operator | `359:2970` | `/field/notifications` |
| Settings - Operator | `360:4603` | `/field/settings` |
| Operator Profile | `360:4903` | `/field/profile` |
| Contact Support | `652:9896` | `/contact` |

Inventory add / edit / delete / delete-confirmation (`292:1344`, `293:2668`,
`293:2913`, `293:3256`) and the Equipments date-picker (`251:3418`) are modal states
of their parent route, not routes.

The `- Home Page` suffixed frames (`582:4003`, `582:4220` Extend Rental,
`582:4460` Manage Active Rental, `582:4670` Manage Nego Details) are the same screens
drawn in the customer shell rather than the admin sidebar shell. They are shell
variants, not separate screens.

Several frames are straight duplicates of a matched row and carry no new
information: `731:1724` / `731:1842` (OCR Tool Review / OCR Tool), `663:2533`
(Weekly Billing), `360:4449` (Login), `168:2495` / `206:2083` no-sidebar variants.

## 3. Matched in name only — the design is not what shipped

| Figma frame | Node | Route | What is missing |
|---|---|---|---|
| Manage Registrations (Company Applications) | `206:2083` | `/account/applications` | The frame is a **list**: Total / Approved / Pending counter tiles, a search field, three filter tabs (All / Pending Approval / Approved), and one card per application with thumbnail, status pill, registration number and a **Manage** action. `account.applications.tsx` renders a single `Surface` from `GET /tenants/me/application` — one application, no counters, no search, no filters, no Manage. **Blocked**: the endpoint is singular; a per-customer list endpoint is needed first. Mobile twin `826:2218`. |
| Help Center | `750:6444` | `/help` | The frame is a complete 2299px-tall Help Center. `help.tsx` is an `EmptyState` reading "Support articles are being written." **Mostly blocked, not content-only** — see below. |

The Help Center frame decomposes into six sections, and only two are backed:

| Section | Node | Backed? |
|---|---|---|
| Direct Channels (Messenger, Email) | `750:6520` | Yes — same details as `/contact`. |
| Contact / legal footer | `750:6577` | Yes — supplied by the `_public` layout already. |
| Search knowledge base | `750:6452` | No knowledge base exists. |
| Category cards (Fleet Ops, Billing, Technical Support) | `750:6459`+ | No articles behind them. |
| Submit Support Ticket form | `750:6484` | No ticket table, no endpoint — the same gap `/app/tickets` names. |
| Top Articles list | `750:6557` | No articles. |
| Network status | `750:6548` | No status endpoint. |

Shipping the ticket form or the article lists as they are drawn would fabricate
content, which `src/routes/unbacked-screens.tsx` explicitly rules out: *"A queue full
of invented tickets ... is worse than an empty one — it looks finished, it gets
screenshotted into a report, and nobody can tell which numbers were real."*

## 4. In the prototype, not in the code — the build list

Every route on the 2026-09-17 build list has since shipped. What remains are states
of existing screens that were never drawn into the implementation.

| Figma frame | Node | Belongs to | Status |
|---|---|---|---|
| Cart Page - Nego Options | `219:2226` | `/account/cart` | Buildable. "Proceed to Negotiation" split button offering Phone Call / Messenger. Cart currently offers one undifferentiated "Go to negotiation" link (`account.cart.tsx:132`). |
| Rental Page - rent | `209:2977` | `/equipment/$equipmentId` | Buildable. The rent / add-to-cart state of the listing. |
| Inventory - Deleted | `303:2118` | `/app/inventory` | Buildable. Post-delete confirmation state. |
| Extend Rental Submitted | `237:1855` | `/account/bookings/$bookingId/extend` | Blocked — no endpoint moves a return date. |
| Messenger Chat Nego done | `225:3569` | `/account/negotiation/$bookingId/chat` | Blocked — no negotiation backend. |
| Call Nego done | `225:3872` | `/account/negotiation/$bookingId/call` | Blocked — same. |
| Notification - Dismiss | `603:4981` | `/account/notifications` | Blocked — `PATCH /notifications/:id/read` exists; nothing dismisses. |

### Not built, deliberately

| Figma frame | Node | Why |
|---|---|---|
| Payment Authentication Gcash | `168:3138` | Captures payment credentials in-app. DSD §4.1 (Locked) forbids it; PayMongo hosted checkout supersedes. See CR §3. |
| OTP Verification | `168:3214` | Same. |
| Payment Authentication - Mobile Number | `793:3136` | Same (mobile twin of the above). |
| Landing Page-Locked, Locked 2 | `177:2169`, `238:3694` | Dead design iterations. |

## 5. Design-side debt

These are defects in the Figma file, not in the code. Building them faithfully would
ship the defect, so the corrected version is built instead and the divergence is
recorded here.

- **Three competing "Add Company" desktop frames** — `168:2442`, `582:3946`,
  `450:2068`. The code implements one 3-stage wizard (`account.companies.tsx`:
  `government_id` → `company_registration` → `details`). Design owes a newest-wins
  decision; until then `582:3946` is treated as canonical.
- **`168:2442` carries placeholders copied from the signup form**: the COMPANY NAME
  field reads `John Doe` and TIN NUMBER reads `name@company.com`; the layers are
  still named `Full Name` and `Work Email`.
- **"Almara" branding is correct, not a defect.** Recorded here because it reads like
  one on first pass. `BRAND.md` §0 ("Make them part of the branding") puts the
  tenant firm's own name in the app bar and customer portal — "*that yard's* system
  (Almara's, then the next firm's)". ArkiLaunch is the platform, Almara is the
  tenant. `_public.tsx:49` already renders the footer this way. Leave it.
- **`750:6545` (Help Center) reads `ops@fleetcore.io`** — a leftover from whatever
  template the frame was built from. FleetCore is neither the platform nor the
  tenant. Genuine defect; the real address is `arkilaunch2026@gmail.com`.
- **The Help Center's Top Articles are generic SaaS filler** — "API Rate Limits",
  "Sensor v4 Deployment" belong to a telemetry product, not equipment rental.
- **`219:2226` has a layout defect**: the "Shopping Cart" heading visually overlaps
  "Continue Browsing".
- **`876:3551`** is an unresolved designer note on the Security Logs mobile frame
  questioning whether it should be a table.
- Three Landing Page variants are still live; only `144:1386` is real.

## 6. In the code, not in the prototype

Kept. These are real, working surfaces the prototype never caught up with — design
debt on Figma's side, not code to delete.

| Route | Why it exists |
|---|---|
| `/app/quotes` | PRD-F1 dynamic quotation, live backend (`POST /quotes`). Already flagged in `cr-arkilaunch-frontend-storefront-shell.md:39` as kept deliberately. |
| `/app/registration` | KYC submission flow (PRD-F6, S17). The prototype models the admin review states but not the submission itself. |
| `/account/companies/$companyId/documents` | KYC document re-upload, shipped with the National ID work. |
| `/account/checkout/failed` | Failure leg of the hosted-checkout return; the prototype draws only the success leg. |
| `/signup`, `/activate` | Customer self-signup and post-approval password set. |
| `/terms`, `/privacy` | Required by CLR; prerendered public routes. |

## 7. Known gaps behind the routes

Endpoints that turned out to exist and had never been called by anything:
`GET /bookings/:id`, `GET /invoices/:id`, `GET /notifications` +
`PATCH /notifications/:id/read`, and `GET /users/me`. The active rental,
invoice, notification-centre and profile screens are real as a result.

- `/app/security-logs` — no audit endpoint exists. Layout only, placeholder rows.
- `/app/tickets` — no ticket table, no endpoint. Layout only.
- `/account/negotiation/*` — no negotiation backend, no RBAC model for a negotiating
  party. Layout only; both "done" states (§4) wait on the same.
- `/app/notifications`, `/account/notifications`, `/field/notifications` — the
  notification read endpoint exists but nothing dismisses; the app bar's notification
  affordance (DSD §4.1 Nav shell) is likewise unbuilt.
- Profiles read `GET /users/me`, which is read-only: nothing writes a display name,
  avatar or phone number back, so no edit affordance is offered.
- `/account/bookings/:id/extend` — bookings can be created, listed and read; no
  endpoint moves a return date, so Extend Rental Submitted (§4) cannot ship.
- `/account/applications` — `GET /tenants/me/application` returns a single
  application. The §3 list design needs a per-customer list endpoint.
- `/account/companies/new` — `POST /tenants/register` takes the personal details from
  the first registration step and nothing attaches a second company to an existing
  account.
- `/app/companies/approved` and the three `/app/registration/*` queues —
  `tenants_list_pending_applications` returns pending rows only, and KYC documents are
  readable one at a time by document id with nothing listing them per tenant or per
  state.
- The Figma company-application frame's compliance repository and verification trail
  need that same missing KYC list.

`/app/tickets`, `/app/security-logs` and `/field/settings` render the deliberate
`GapScreen` in `src/routes/unbacked-screens.tsx`, which cites this section. New
endpoint-blocked screens should extend that pattern rather than shipping
layout-only routes.
