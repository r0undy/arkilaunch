# Change Record

**Title:** Map-first customer truck booking: tap-to-pin with the fastest road route, and trip cards with a status stepper
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Applied` (repo, branch `feat/truck-map-booking`)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow (customer UX request, `/account/trucks`)
**Docs touched by this record:** [dsd-arkilaunch.md](dsd-arkilaunch.md) §4 Domain components (Route Map, new Trip Card; materialized into `DESIGN.md`), [index.md](index.md) §2
**Builds on:** [cr-arkilaunch-console-polish.md](cr-arkilaunch-console-polish.md)

---

## 1. Summary

Booking a truck was a form with a map attached. The customer:
- chose a region, province and city for each end;
- placed the pins through a "Placing:" radio;
- then pressed "Get estimate".

"Your requests" was a stack of large cards, each always open. Ride-hailing apps (Grab, JoyRide, Waze) set the expectation instead: the map is the screen, two taps set the trip, and the route and price appear on their own.

## 2. Decisions

- **The map is the booking screen.**
  - A floating panel sits over the map: on the left on desktop, and as a sheet under the map on a phone.
  - It holds the pickup and drop-off rows, the route, the price, the time, the site and **Request truck**.
  - The region/province/city pickers, the street/landmark fields and Notes move under a closed **Advanced search**. A pin still pre-fills them.
- **Tap to drop, drag to adjust.**
  - The first tap sets pickup, the next sets drop-off, and a row in the panel picks which pin the next tap sets.
  - **Use my location** sets pickup from the browser's geolocation.
  - Pins are teardrops in the Route Map colours, with the reverse-geocoded street in a bubble.
- **Fastest route only, with no button.** The estimate runs as soon as both ends are set. It is keyed on the pins, so a drag re-routes on dragend, which stays within the existing 10/min throttle. OSRM's first route is its fastest. Alternative routes were declined: the server prices its own route, so a customer-picked alternative would not match the charge.
- **The label a request is saved under** is the geocoded street/barangay plus the city, or "Pinned lat, lng" when geocoding finds nothing. Staff see this in place of a bare city, so the street no longer rides along in the notes.
- **Your requests.**
  - A tab beside "Book a truck", with Active/Past paged on the server (`status=open|closed`).
  - Each request is a trip card with a five-step stepper that opens a drawer. The drawer holds the map, the price and actions, and the thread.
  - After a request is sent, the page switches to this tab and opens the new trip.
- **API.** New `GET /me/truck-requests/:id/route`. It reuses `TrucksService.route()`, which reads the request through `visibleRequest()` under `withTenantTx`, so a customer only ever routes their own request (RFC-1). No migration.
- **Fix.** Reverse geocoding kept one in-flight request for the whole page, so dropping B aborted A's lookup. There is now one per pin.
- **Not done:**
  - alternative routes;
  - search-as-you-type place search (Nominatim's usage policy forbids autocomplete);
  - a draggable bottom sheet;
  - live driver tracking.

## 3. Repo changes

- **API:**
  - `trucks.controller.ts`: `GET me/truck-requests/:id/route`, with `booking:read`, `UuidParamPipe` and a 20/min throttle.
  - `test/truck-list-route.spec.ts`: a customer passes the ownership check on their own request and is refused on another user's.
- **Web:**
  - `route-map-gl.tsx`: teardrop pins with address bubbles, a zoom-scaled route line, fit padding for the panel, framing at the current tilt, and a hint chip.
  - `route-map.tsx`: exports `TripCanvas`/`hasWebGL`. `RouteMap` becomes view-only.
  - `account.trucks.tsx`: rewritten map-first.
  - `truck-trip.tsx` (new): `TruckRequestCard` (the trip card plus its drawer), `TripStepper`, `tripSteps`, `EstimateRange`, `PriceBreakdown`.
  - `lib/queries.ts`: `trucksQueries.mine`, `trucksQueries.myRoute` and `MY_TRUCK_REQUESTS`.
  - `reverse-geocode.ts`: one in-flight request per pin.
- **Tests:**
  - `truck-trip.test.ts` (the stepper);
  - `e2e/truck-request.spec.ts`: two taps, then the estimate appears; Advanced search; the actions run in the trip drawer.

## 4. Compliance

- There are no new third parties. Tiles, reverse geocoding and routing use the same OpenFreeMap, Nominatim and OSRM calls as before.
- Geolocation runs only when the customer presses the button, and the browser asks for permission. The position becomes a pin like a tapped one and is stored only if the request is sent.
- RFC-1 holds: the new endpoint's tenant and owner both come from the JWT. RFC-2 is untouched.

## 5. Verification

- Web typecheck, eslint and vitest are green. API typecheck is green, and `truck-list-route` is 5/5.
- Driven locally as a customer on desktop at 1440px and on a phone at 390px:
  - the teardrop pins with their street bubbles;
  - the hint chip;
  - the panel;
  - the Your requests cards and stepper;
  - the trip drawer with its map.
- **Known limit.** The public OSRM demo server intermittently times out. When it does, the panel says so and offers **Try again**.
