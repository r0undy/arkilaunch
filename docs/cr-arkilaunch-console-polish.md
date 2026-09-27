# Change Record

**Title:** Back-office console polish: server-paged lists, drawers and modals over pages, confirmations on money/state moves, a 3D trip map with the road route
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Applied` (repo, branch `feat/console-polish`)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow (admin UX audit of the tenant back office, `almara.arkilaunch.app/app/*`)
**Docs touched by this record:** [dsd-arkilaunch.md](dsd-arkilaunch.md) §4 Surfaces + Domain components (materialized into `DESIGN.md`), [index.md](index.md) §2

---

## 1. Summary

The tenant back office worked but did not read as a finished internal tool:

- **Silent truncation.** Truck requests and the KYC queue were capped at 100 rows, coupons and toll rates had no cap at all, and the storefront catalog stopped at 50. None of these said so on screen. The review-queue and unread badges counted a page's rows, so both stopped at 50.
- **Forms everywhere.** Create forms (coupon, invite, rate card, toll) were always open on the page. Every truck request rendered as a full inline editor. A booking's actions lived on a separate page reached from the drawer.
- **One-click money and state moves.** Accepting a truck price, marking delivered or returned, approving or declining a change request and removing a toll all fired on a single click.
- **A plain map.** The pickup and drop-off pins sat on two flat Leaflet boxes with no route between them. The pins were saved but never returned, so staff never saw them.

The look stays the DSD's Console tier: amber, Plex, tight radii, borders before shadows. Nothing in §2 changes.

## 2. Decisions

- **Server-side paging** on `GET /truck-requests`, `GET /me/truck-requests`, `GET /coupons` and `GET /customers/review`. Each uses the shared `PaginationQuerySchema` and returns `{ items, total }`. `GET /truck-requests` also takes `status=open|closed`.
- **Paged in the browser on purpose:**
  - Toll rates: the trip toll picker needs the whole matrix anyway, and the matrix is bounded.
  - Storefront catalog: it filters in the browser, so it now reads the API's 100-row ceiling instead of the default 50. Paging it on the server needs a total from the catalog SQL function, i.e. a migration, which is out of scope here.
- **Bookings are two tabs, Rentals and Trucks, each paged.** The old merged "All" list cannot be interleaved correctly across two separately paged endpoints.
- **Drawers over pages.**
  - The booking drawer gets Overview, Negotiation and Actions tabs for both services. `/app/bookings/$bookingId` stays as a deep link and renders the same components.
  - The KYC queue is a table; a row opens the review in a drawer.
  - Create forms open as modals from a header button.
- **Confirmations** on accept price, mark delivered/returned, approve/decline a change request, and remove toll. Coupon on/off stays one click, since the same button reverses it.
- **Trip map.** MapLibre GL with OpenFreeMap vector tiles, which are keyless and include 3D buildings:
  - Tilted by default, with a 3D toggle.
  - Road route from the existing OSRM call, now with `overview=simplified&geometries=geojson`.
  - Dashed straight line until the road route arrives.
  - MapLibre is lazy-loaded in its own chunk.
  - Falls back to the Leaflet pin map without WebGL.
  - No flying camera under reduced motion.
  - `GET /truck-requests/:id/route` routes a saved request's pins for the staff map. No new table and no migration: the pin columns already exist (0037).
- **Not done:**
  - Dark mode (the tokens exist; nothing turns them on).
  - A unified bookings endpoint.
  - A project-site marker on the map.
  - A truck routing profile (the OSRM demo routes cars).
  - Sticky table headers: `overflow-x` scrolling makes the table its own scroll container, so a sticky header would not stick against the page.

## 3. Repo changes

**API**
- `trucks.service.ts`:
  - `list()` takes the paged query and adds the status filter, and every response includes the four pin coordinates.
  - New `route()`: it reads the pins under `withTenantTx`/RLS through `visibleRequest()`, so the tenant comes from the JWT (RFC-1), then routes after the transaction closes. A request with no pins returns 404 `truck_pins_missing`.
- `trucks.controller.ts`: `TruckRequestListQueryDto` on both list endpoints. The new route endpoint takes `pricing:manage`, a UUID pipe, and a 20/min throttle.
- `route-distance.ts`: `roadRoute()` returns `{ km, minutes, line }`. `parseOsrm()` is pure and tested.
- The estimate response adds `route`.
- `coupons.*` and `customers.*` are paged with `countRows` under the same where clause.

**Shared** (`packages/shared`)
- `TruckRequestListQuerySchema`, `TruckRequestListResponse`, `TruckRoute`, `TruckEstimateResponse`, `CLOSED_TRUCK_STATUSES`.
- The pin fields on `TruckRequestResponse`.
- `CouponListResponse`; `CompanyReviewQuerySchema` extends pagination; `CompanyReviewListResponse`.

**Web: new components**
- `tabs.tsx`, `status-badge.tsx`, `stat-tile.tsx`.
- `route-map.tsx` plus the lazy `route-map-gl.tsx`. The worker is bundled by Vite through `?worker&url`, because MapLibre's relative worker URL breaks under pre-bundling and hashing.
- `booking-actions.tsx`, which holds the cards moved out of `app.bookings.tsx`.

**Web: shared components changed**
- `table.tsx` gets `footer` and `empty` slots, a tinted header, and a chevron row action.
- Pagination buttons are 44px.
- `modal.tsx`:
  - An `xl` size.
  - Keys are handled only by the dialog that holds focus, so a confirm opened in a drawer owns Escape and Tab.
  - `onClose` is read through a ref. Before this, an inline `onClose` re-ran the open effect on every render and pulled focus out of a field on every keystroke.

**Web: shell and pages**
- **Shell:**
  - Content capped at 1440px.
  - Sticky sidebar.
  - The phone nav drawer uses Modal, so it gets a focus trap.
  - The tenant initial mark leads the app bar.
  - A booking-code jump box for staff.
  - Badges read `total`.
  - Tickets and Security logs are hidden from the nav (their routes stay).
- **Pages:**
  - Bookings: tabs, paged tables, row opens the drawer.
  - Coupons, People and Rate cards: create in a modal.
  - Tolls: a filterable paged table, add in a modal, remove behind a confirm.
  - KYC queue: a table with a review drawer.
  - Dashboard: a "work waiting" tile row.
  - Quotes and the site hub use the shared Tabs; Quotes gets a section jump list.
  - The customer truck form places both pins on one route map.

**Tests**
- `apps/api/test/truck-list-route.spec.ts`:
  - paging and total;
  - open/closed split;
  - pins returned;
  - another tenant's id refused;
  - a request without pins refused;
  - OSRM parse.
- `apps/web/src/components/tabs.test.tsx`: Tabs keyboard, the nested-modal Escape, and focus kept across re-renders.
- Existing specs updated for the paged shapes.

## 4. Compliance

- **Map tiles.** OpenFreeMap serves the tiles, so a viewer's browser sends it tile requests (IP, viewport). That is the same class of exposure as the OSM tiles the Leaflet map already used.
- **Routing.** The route line comes from the OSRM call the API already made for the estimate. The staff route endpoint sends that public server the request's two pins, and nothing about the customer.
- **Clauses.** No new personal data is stored. RFC-1 holds: the route endpoint's tenant comes from the JWT through RLS. RFC-2 is untouched: none of the confirmations sit on the OCR deduction path.

## 5. Verification

- Typecheck:
  - `pnpm --filter @arkilaunch/api typecheck`: green.
  - `pnpm --filter web exec tsc --noEmit`: green.
- `eslint`: 0 errors.
- Web: `vitest run`, all green.
- API: `truck-list-route`, `truck-checkout` and `customer-onboarding` green. `coupons-engine` has 5 failures at `BookingsService.create` (`customer has more than one company`, from the shared seed data). Those 5 fail identically on unmodified `dev`.
- Driven locally at `almara.localhost:5173` as admin and as customer:
  - the dashboard tiles;
  - both booking tabs and their paging;
  - the truck drawer map with the road route and km/min chip;
  - the rental drawer tabs;
  - "Mark delivered" confirm, where one Escape closes the confirm only;
  - the coupon modal;
  - the KYC table;
  - the tolls table;
  - 390px mobile.
- **Known limit.** The public OSRM demo server times out intermittently. When it does, the map shows the dashed straight line and says the road route is unavailable.
