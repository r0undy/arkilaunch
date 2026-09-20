# Audit — HTTP API surface gaps

Status: Findings (not Locked). Date: 2026-09-19. Audited against `dev`.
Scope: `apps/api/src/**` controllers and services, cross-checked against every path literal in
`apps/web/src`.

Read-only when written; **updated 2026-09-19** with each finding's disposition. Note for the record: the API is **NestJS**, not Fastify. Global guards
(`app.module.ts:60-64`) apply throttle → JWT → tenant-context → RBAC to every route, and
`@Public()` opts out of the last three. A global `ZodValidationPipe` (`main.ts:73`) does enforce
every `createZodDto` body/query DTO — which makes the body-validation and RFC-1 categories cleaner
than expected, and concentrates the gaps in authorization, params, and pagination.

## HIGH — authorization

### 1. `GET /quotes/:id` lets a `customer` read any quote in the tenant
**CLOSED** (`45b833d`). Ownership predicate added, reusing `ownCustomer` extracted from `BookingsService` so both services route through one helper. 404 not 403. Covered by two tests, and the negative one was verified to fail without the fix.
`apps/api/src/quotes/quotes.service.ts:229` (route `quotes.controller.ts:42`)

`customer` holds `quote:read` (`packages/db/src/seed/permission-catalog.ts:87`) and the catalog
comment says customers may read "their own quotes" — but `get()` has no ownership predicate at
all, unlike its sibling `BookingsService.get` (`bookings.service.ts:198-201`), which branches on
`ctx.role === 'customer'` to an `ownCustomer()` check. A customer-role JWT plus any quotation UUID
returns another customer's full line-item pricing, rates, discounts and totals. RLS scopes to
tenant, not to customer.

### 2. `GET /reference/*` exposes the tenant's whole book of business to `customer` users
**CLOSED** (`45b833d`). `STAFF_READ` (an OR of `edtr:create` / `report:read`, which no `customer` holds) applied to every tenant-scoped reference route and to the previously unguarded GET reads on fleet and sites. `equipment-types` stays open: global, non-tenant catalog data.
`apps/api/src/reference/reference.service.ts:70` (rentals), `:83` (customers), plus `equipment`
and `projectSites`. The controller carries no `@RequirePermission` and says so in a comment
(`reference.controller.ts:8`, "for the POC frontend").

`customer` is an intra-tenant role (`bookings.service.ts:40` resolves it from `customers.userId`),
so a customer JWT passes the JWT and tenant guards and the permissions guard is a no-op with no
decorator. `GET /reference/customers` returns every other client company's name;
`GET /reference/rentals` returns every rental in the tenant with `customerId`, `projectSiteId` and
`status`. `GET /bookings` deliberately branches on role to prevent exactly this; reference does
not. Same exposure on `GET /equipment`, `/sites`, `/sites/:id`, `/incidents`,
`/weather/advisories`.

### 3. `POST /auth/activate` has no client — approved tenant owners can never log in
**CLOSED** (`45b833d`). `/activate` route added; the approval UI now renders the full link it always claimed to be showing.
`apps/api/src/auth/auth.controller.ts:34`

Approval returns an `activationToken` that the UI displays verbatim
(`apps/web/src/components/application-actions.tsx:30,65-71`) and `registration-client.ts:7`
documents the intended flow, but there is no `/activate` route in `apps/web/src/routes/` and no
caller of `/auth/activate` anywhere in `apps/web`. An approved owner receives a token, has no
screen to redeem it, has no password, and cannot reach `/auth/login`. The self-service signup path
dead-ends.

## HIGH — unbounded reads

### 4. `GET /tenants/applications` ignores the pagination the UI sends
**CLOSED** (`9f25256`). Query DTO added and LIMIT/OFFSET pushed into the SECURITY DEFINER lookup's wrapping SQL, so the read is bounded in Postgres rather than sliced in Node.
`apps/api/src/tenants/tenants.service.ts:70`; controller `tenants.controller.ts:46-49` takes no
`@Query`. The frontend calls `/tenants/applications?limit=&offset=`
(`application-actions.tsx:17`) and renders `<Pagination>` on `app.companies.tsx`. The handler
accepts no query args and `listPendingTenantApplications()` is a cross-tenant SECURITY DEFINER
read with no LIMIT. Page 2 returns the same rows as page 1 (silently broken paging), and the
platform queue returns every pending application across all tenants in one response.

### 5. `GET /bookings` is unbounded and ignores `limit`/`offset`
**CLOSED** (`9f25256`).
`apps/api/src/bookings/bookings.service.ts:154-161` — `tx.select().from(rentals)` with no limit;
controller `bookings.controller.ts:24-27` takes no `@Query`, while `bookingsQueries.list` sends
`?limit=&offset=` (`apps/web/src/lib/queries.ts:99`). Every other list module has a
`PaginationQuery` DTO capped at 100; bookings has none. The role branch for `customer` is present
and correct — it is the bound that is missing, on both branches.

## MEDIUM

### 6. No UUID validation on any `:id` path param — unauthenticated 500s
**CLOSED** (`9f25256`). A global `UuidParamPipe` scoped to route params named `id` or `*Id` -- which is all 37 and nothing else -- plus the `DbErrorFilter` this audit correctly noted was missing entirely.
All 37 `@Param('id') id: string` sites; worst case `apps/api/src/catalog/catalog.controller.ts:21-23`
(`@Public`). There is no `ParseUUIDPipe` anywhere, no param DTO, and no `APP_FILTER` /
ExceptionFilter registered in `apps/api/src`. `GET /api/v1/catalog/equipment/foo` with no
credential produces a Postgres `invalid input syntax for type uuid` that escapes as an uncaught
500 rather than a 400/404. Same for `/quotes/:id`, `/invoices/:id`, `/kyc/:id`, `/edtr/:id`,
`/bookings/:id`, `/sites/:id`. Bodies are validated; the params are the unguarded half of the
trust boundary.

### 7. `GET /reference/rate-cards?equipmentTypeId=` is a raw unvalidated query param
**CLOSED** (`9f25256`).
`reference.controller.ts:24-27` → `reference.service.ts:46`. A bare string with no DTO, so the
global Zod pipe has nothing to validate, fed to `eq(rateCards.equipmentTypeId, …)`. Not injectable
(Drizzle parameterizes), but a non-UUID produces the same uncaught 500 as #6. It is the only
`@Query` in the API not backed by a `createZodDto`.

### 8. `GET /catalog/*` is unauthenticated and unbounded
**CLOSED** (`9f25256`). Bounded in the wrapping SQL. Behaviour change worth knowing: the storefront sends no limit, so its equipment list is now capped at the 50 default.
`apps/api/src/catalog/catalog.service.ts:23-31`, `:45-51`. No limit/offset on either route or
service; `listCatalogEquipmentForSlug(slug)` returns the anchor tenant's full catalog, reachable
with no credential at 30 req/min. Every public storefront page load ships the entire equipment
table, and `catalogQueries.equipment()` has no way to ask for less.

### 9. `GET /invoices` and `GET /incidents` defeat their own pagination cap
**CLOSED** (`9f25256`). A shared `countRows()` replaces count-by-fetch-everything across six services. `GET /users` was worse than slow -- its total was the length of the page.
`apps/api/src/billing/billing.service.ts:92` —
`const total = (await tx.select().from(invoices).where(...)).length`; same shape at
`sites.service.ts:472-476`. The paged query is correctly capped at 100, then a second unbounded
query pulls every matching row into Node just to call `.length`. A tenant with 100k invoices loads
100k full rows to render a page of 50. `SELECT count(*)` is the missing piece.

### 10. `GET /weather/advisories` selects every active alert then collapses it in JS
**CLOSED** (`9f25256`).
`apps/api/src/sites/sites.service.ts:444-456` — no LIMIT; the per-site dedupe happens in a JS `Map`
afterwards. The sibling `incidents()` in the same file (`:485-486`) is properly paginated. The
response is bounded by site count; the query is not.

### 11. 2FA can be verified but never enrolled from the UI
**OPEN -- backlog, not a defect.** A missing feature; needs its own record.
`apps/api/src/auth/two-fa.controller.ts:16` (`POST /auth/2fa/enroll`), `:24` (`enroll/confirm`).
`apps/web/src/lib/auth-client.ts:87` calls `/auth/2fa/verify`, but no file in `apps/web/src`
references `2fa/enroll`. The login challenge branch can only fire for accounts enrolled
out-of-band via curl. Dead surface *and* a missing client feature.

### 12. Whole modules of write surface have no client
**OPEN -- backlog, not a defect.** Eight modules of missing frontend, weeks of work. Belongs in the existing `unbacked-screens.tsx` pattern with a record and an SDD §5 addition per module.
Verified by grepping every path literal in `apps/web/src` against the controller route table.
Unreferenced anywhere in the frontend:

- `pricing.controller.ts:16,25,32` — `POST /pricing/diesel-price`, `POST|GET /pricing/parameters`.
  These feed quote pricing (`priceStale`, diesel snapshot) yet can only be set by curl; the UI
  shows staleness it cannot fix.
- `users.controller.ts:63,68` — `GET|PUT /users/:id/site-assignments`. Timekeeper site scoping,
  enforced in `edtr.service.ts`, is unadministrable from the UI.
- `billing.controller.ts:30` — `GET /rentals/:id/deposit`, the deposit-ledger read surface (money path).
- `fleet.controller.ts:29,35,46` — `POST /equipment`, `PATCH /equipment/:id`,
  `POST /equipment/:id/maintenance-logs`.
- `sites.controller.ts:30,41,47,53,63` — the entire sites write surface plus `GET /sites/:id/weather`.
- `quotes.controller.ts:30,42` — `POST /quotes/:id/revise` (money path), `GET /quotes/:id`.
- `bookings.controller.ts:36` — `PATCH /bookings/:id/cancel` (US-09 "modify orders" has no button).
- `tenants.controller.ts:21,28` — `GET|PATCH /tenants/me` (S18 Tenant Settings; `app.settings.tsx`
  exists but does not call it).

Each is an unexercised, untested authenticated write path.

## Clean

- **Frontend calling a non-existent endpoint:** none. Every path in `apps/web/src` resolves to a
  real controller route. The two *effective* gaps are #4 and #5, where the route exists but
  silently discards the query params the client sends.
- **RFC-1 client-supplied `tenant_id`:** clean. No DTO declares a `tenantId` field; the only
  `tenantId` references in controllers are `req.ctx.tenantId`. `TenantContextGuard` derives it
  solely from verified JWT claims, and the webhook's system context comes from a server-side
  invoice lookup, not the payload.
- **Missing request-body validation:** clean. Every `@Body()` is a `createZodDto` and the global
  pipe is actually installed. The public PayMongo webhook verifies HMAC over `rawBody` *before*
  parsing, then Zod-validates the envelope (`payments.service.ts:134-147`). The validation gaps
  are params and queries only (#6, #7).

## Suggested order

#1 and #2 are the same one-line shape as an existing correct sibling (`BookingsService.get`) —
fix them together. #3 is a missing screen, not a missing endpoint. #4/#5 are a DTO each. #6 wants
one `ParseUUIDPipe` registered globally rather than 37 edits.
