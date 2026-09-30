# Change Record: map-first truck booking and trip dialog

**Project:** ArkiLaunch
**Date:** 2026-09-30
**Status:** Applied
**Trigger:** Owner request for a map-first truck booking screen, closable trip dialog, and project-site start
**Locked docs touched:** SDD §4, DSD §4 (also materialized to DESIGN.md)

## Decision

`/account/trucks` opens with the interactive map, its pin hint, and the optional Use my location control. Its camera starts at the newest saved project site for the selected company, with the customer's uploaded site photo on its map marker. If there is no eligible site, it requests browser location and starts there when it is on Luzon mainland; otherwise it starts in Manila. The site marker does not set a trip pin.

The trip dialog is absent until pickup and drop-off both have valid pins. Setting the second pin opens it automatically. Clearing either pin closes it and returns the map to pin placement. The dialog holds the pickup/drop-off selectors, route estimate, pickup time, company, saved-site delivery, equipment to load, Request truck, and Advanced search. It is scrollable on small screens, supports Escape and Close, and reopens from the Trip details button on the map. The Leaflet fallback fills the available map area and keeps both pins visible. Both maps support arrow keys to pan and Enter to place a pin. Wheel zoom is disabled so moving or scrolling over the map does not show a Ctrl-scroll prompt.

The customer's own site photo URL is signed by `GET /me/sites/:id/photo-url` after the service confirms site ownership inside a tenant transaction. A missing or failed image shows a labeled Site marker.

## Verification

The truck browser test checks that settings are absent before both pins and that Close/reopen works after pinning. Web/API typechecks, root lint, web build, and focused map tests pass. The browser flow still needs a seeded local customer: the current E2E run stops at customer sign-in before reaching the map. The tenant isolation review passed for the new photo endpoint.

## Rollback

Revert the web route, map marker and gesture updates, signed photo endpoint, test assertions, and design/architecture addenda. No schema change is involved.
