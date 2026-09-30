# Change Record: Luzon mainland maps and equipment pins

**Project:** ArkiLaunch
**Date:** 2026-09-30
**Status:** Applied
**Trigger:** Owner request to keep maps on Luzon mainland, shade the outside, improve loading, and show equipment photos at site pins
**Locked docs touched:** SDD §4 and DSD §4 (also materialized to DESIGN.md)

## Decision

The service area is the main island of Luzon, excluding nearby islands. A simplified polygon from [OpenStreetMap relation 6995280](https://www.openstreetmap.org/relation/6995280) is checked into `packages/shared/src/luzon-mainland.json` under ODbL 1.0 attribution. The same polygon controls browser pin placement and API acceptance. A translucent mask shades the outside of the island; rectangular camera limits keep the map near Luzon. Existing off-island records remain readable, but new truck endpoints and site coordinates must be on the mainland. The API returns 422 `outside_luzon_mainland` for violations.

The site hub overview now shows an in-app map. Its marker uses the first available photo from equipment currently on site and displays a count and a named list for multiple units. Equipment without a photo gets a labeled marker. Photo URLs come from the existing tenant-scoped equipment query; no migration or new storage is needed.

Leaflet loads only when a pin or site map opens. MapLibre already loads on demand. Both keep a fixed-size placeholder until the first map render or tile completion, with an error message on failure. The default MapLibre view is flat for faster initial rendering; users can turn on 3D.

## Verification

Boundary unit tests cover mainland cities, Mindoro, Cebu, sea and non-Philippine coordinates. The truck routing test rejects an off-island pin before a provider call. Web and API typechecks, focused component tests, lint, and the web build passed. The full workspace test run stopped on database fixture isolation failures; one unrelated web test timed out under the full suite but passed by itself. The truck browser E2E could not pass customer sign-in because the local anchor tenant login was unavailable, so fog and marker imagery still need a browser check in a seeded environment.

## Rollback

Revert the code and this doc addendum. No database migration or stored coordinate rewrite is involved.
