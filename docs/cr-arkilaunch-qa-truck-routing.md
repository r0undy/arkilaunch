# Change Record: truck routing, city rules and dispatch ETA

**Project:** ArkiLaunch  
**Date:** 2026-09-29  
**Status:** Applied on `r0undy/qa-truck-routing-eta`  
**Trigger:** QA feedback on `/account/trucks`  
**Locked docs touched:** SDD §3/§4 and DSD §4 (Route Map and Trip Card)

## Decision

Truck estimates use OpenRouteService `driving-hgv` with native `fetch` and `ORS_API_KEY` at the [current HeiGIT endpoint](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912). If the key is absent or ORS fails, the existing OSRM car route remains available but is labelled **Car route - verify truck access** on customer and staff maps. An HGV profile is a routing aid; staff still check vehicle dimensions, road restrictions and permits.

The API samples a route at approximately 5 km intervals, capped at 20 interior points plus endpoints, and serializes search and reverse requests to Nominatim at one request per second per API process. Ordered unique cities are stored on `truck_requests.route_cities` after creation without blocking the response. Staff route reads backfill older null rows. The staff drawer names each city so permits and extra fees can be discussed during price negotiation. The public Nominatim service's limit applies to the whole application, so this pilot implementation needs one API replica or a replacement geocoder before scaling.

Tenant administrators manage `truck_ban_rules` by city, province, days, time windows, minimum GVW, permit note and verification state. Migration 0070 seeds Metro Manila examples for existing and future tenants with `verified=false`. They are working prompts, not confirmed citywide legal advice. Staff must check current MMDA and LGU rules, road coverage and vehicle details before marking a rule verified. The drawer shows the rule hours, pickup-window match and verification warning.

A paid truck can be dispatched once. The API stores `dispatched_at`, `route_minutes` and `eta_at`, advances the status to `dispatched`, pushes an arrival inside a stored ban window to that window's end, and notifies the requesting customer with a trip deep link. Before dispatch both sides see pickup plus drive time; afterward they see the stored ETA.

## Data and API

- `0070_truck_routing_eta.sql`: nullable route cities, drive minutes and dispatch timestamps on `truck_requests`; status check extended with `dispatched`; tenant-owned `truck_ban_rules` with full FORCE RLS, tenant index and tenant/city/province unique key; existing-tenant seed and future-tenant trigger.
- `GET /truck-ban-rules`: admin `pricing:manage` or owner `report:read`. `POST /truck-ban-rules` and `PUT/DELETE /truck-ban-rules/:id`: `pricing:manage`, JWT-derived tenant and Zod validation.
- `POST /truck-requests/:id/dispatch`: staff `pricing:manage`; paid-only transition with row lock and customer notification. Existing route and list endpoints return the new city and ETA fields.

## Operations and verification

- Set `ORS_API_KEY` as a GitHub environment secret in dev and prod. The deploy workflow passes it as `TF_VAR_ors_api_key`; Terraform creates the Container App `ors-api-key` secret and maps it to the API environment. Confirm an ORS route returns `truckSafe=true` and inspect a fallback route's warning.
- Review every seeded truck-ban rule with current MMDA and LGU sources. Update city hours, road scope, GVW and permit notes; mark verified only after checking. A city-level rule cannot express a road-specific exemption.
- API shape was checked against the [OpenRouteService directions documentation](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/requests-and-return-types). The [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) requires application-wide throttling, an identifying User-Agent and caching; route results are stored per request here, but shared caching and multi-replica coordination remain a deployment follow-up.
- Shared (261 tests), web (390 tests) and focused API routing (3 tests) suites passed locally. API database and E2E cases were added for isolation, dispatch and customer ETA. Database-backed integration and browser E2E execution require a disposable migrated database and running API/web services; none were available locally, and no production or pilot database was used. Lint and build passed; lint reported two existing warnings in generated Wrangler types.

## Rollback

The migration is additive apart from broadening the status check. A prior API build can read existing rows; keep the new columns and table during rollback. Stop dispatch writes before reverting the API. Disable `ORS_API_KEY` to use the visibly flagged car-route fallback.
