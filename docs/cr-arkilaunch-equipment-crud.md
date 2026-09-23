# Change Record

**Title:** Equipment CRUD on the inventory console, with retire replacing delete
**Project:** ArkiLaunch
**Date:** 2026-09-23
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user-supplied Figma prototype `ENpes2ZBsS3baRPKLyx0d3`, frames 292:1344, 293:2668, 293:2913, 293:3256, 303:2118
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §3 (equipment columns), §4 (`DELETE /equipment/:id`, `POST /equipment/:id/photo`), §7 (a third Storage bucket), [report-figma-route-alignment.md](report-figma-route-alignment.md) §3/§4/§5, [index.md](index.md) §2 (Change Log)

---

## 1. Summary

`/app/inventory` was a read-only card grid. The prototype draws a full CRUD surface over
it and none of it was built.

The premise needed correcting first. `report-figma-route-alignment.md` recorded that
"the API has no POST, PATCH or DELETE for equipment anywhere" — that was wrong. It had
been checked against the `catalog` module, but fleet writes live in
`apps/api/src/fleet/`. **`POST /equipment` and `PATCH /equipment/:id` have existed since
`cr-arkilaunch-f4-f5-fleet-weather.md`**, `fleet:manage`-gated, with audit logging and a
maintenance-due guard, and no UI had ever called them. Only DELETE was genuinely absent.

So this pass is mostly a console surface over endpoints that were already there, plus a
retire verb, the prototype's spec fields, and one photo per machine.

## 2. Delete is a retire, enforced by the database

The prototype's confirm dialog (293:3256) promises the action *"is permanent and will
remove all associated maintenance and deployment logs."* That is precisely what must not
happen. `edtr.equipment_id` (`packages/db/src/schema/billing.ts`) is the evidence an
invoice was computed from, and `equipment_assignments` carries the rental history. RFC-2
exists to stop exactly this class of loss.

Rather than rely on the foreign key erroring — which would leave the outcome depending on
nobody ever adding a cascade — migration `0026_equipment_retire_grants.sql` takes the
rate-cards posture from `0007`: REVOKE UPDATE and DELETE on `equipment` from
`app_authenticated`, then GRANT UPDATE back on exactly eleven columns
(`model`, `availability_status`, `runtime_hours`, `retired_at`, and the seven new spec
columns).

`DELETE /equipment/:id` sets `retired_at`. Verified against the database after applying:
table privileges on `equipment` are now INSERT and SELECT only.

Two properties fall out of the column list that are worth naming, because they are
load-bearing rather than incidental:

- **`serial_no` has no UPDATE.** A machine's identity cannot be rewritten after a DTR
  cites it. The edit modal renders the field disabled for that reason; an editable field
  would promise something the database refuses.
- **`tenant_id` has no UPDATE.** An asset cannot be moved between tenants under RLS.

The column list is exhaustive over every request-path writer of `equipment`, checked by
enumerating `.update(equipment)` call sites: `fleet.service.ts` (model, and now the spec
fields), `sites.service.ts` and `bookings.service.ts` (`availability_status` on
deploy/release and delivery/return), `edtr.service.ts` (`runtime_hours` on billing
accrual). Omitting one would make that path fail with a bare permission error far from
its cause, so `fleet-engine.spec.ts` carries a grant-regression test that writes each of
them.

RLS is untouched — `equipment` already has `tenantIsolationPolicy()` and
`FORCE ROW LEVEL SECURITY` from `0002`.

### Retire refusals

404 `equipment_not_found`; 409 `equipment_already_retired`; 409 `equipment_deployed`. The
last is the one that matters: a machine on a site has a crew and a customer depending on
it, and retiring it would drop it out of the fleet list while it is still out there
accruing hours. Editing a retired unit is refused for the same reason it cannot be
deleted.

`list()` filters retired units out. `maintenanceDetail` and the utilization and financial
reports deliberately do not — a retire removes a machine from the fleet, not from the
record, and anything citing it by id must still resolve.

Migration `0027_catalog_hide_retired.sql` applies the same filter to the two `@Public`
SECURITY DEFINER catalog functions. Without it a retired machine stayed on the storefront
and a customer could have added an out-of-service unit to a cart and requested a booking
for it. Bodies are otherwise unchanged, including the safe-column allowlist.

## 3. A third Storage bucket, public-read — the one deliberate divergence

SDD §7 and `ops-arkilaunch.md` §2 state that Storage images are *"never served on a public
URL"*, and the scope column reads *"EDTR + KYC image blobs (F3/F6)"*. RFC-2 §6 is the
source of that rule, and its subject is evidence and RA 10173 personal data.

Equipment photos are a third class the rule does not cover, and this pass serves them from
a public-read bucket (`SUPABASE_STORAGE_BUCKET_EQUIPMENT`, default `equipment-photos`).
The reasoning, recorded here because it is an interpretation of a Locked doc rather than a
mechanical application of it:

- A photograph of a backhoe is neither evidence nor personal data. Nothing is inferable
  from it that the anonymous storefront does not already publish — `GET /catalog/equipment`
  has served the same fleet unauthenticated since
  `cr-arkilaunch-tenant-registration-catalog.md`.
- Grid thumbnails mean N images per page. Signed URLs would add a batch-sign call per list
  request and put 300-second URLs inside a cached React Query result, where they expire
  while the page sits open.
- Keys keep the existing `{tenantId}/{yyyy}/{mm}/{uuid}.{ext}` shape, so they are not
  enumerable, and `tenantId` still comes from the verified JWT and never from request
  input.

**Explicitly not changed:** the EDTR and KYC buckets stay private and signed-read. A
machine photo does not go in the KYC bucket, which holds personal data under its own
retention posture.

The API returns `photoUrl`, derived at the egress boundary. The raw `photo_uri` key is
never exposed — it encodes the bucket layout, and keeping it server-side means the bucket
can move without a backfill.

`POST /equipment/:id/photo` reuses `StorageService` and `upload-validation.ts` unchanged;
both were already bucket-agnostic, so this needed no storage-layer work. The 10MB cap and
the magic-byte sniff that rejects a forged `Content-Type` apply as they stand.

## 4. What the prototype asks for that was not built

- **HOURLY RATE and DAILY RATE** (Operational Details). `rate_cards` owns pricing and
  quotes are computed from it, with effective-from/to windows. A second, unwindowed price
  on the equipment row would be a competing source of truth on the money path. The form
  omits the fields and links to `/app/settings` instead.
- **The delete mode** (293:2913) — a toolbar toggle turning the grid into a selection
  surface, on top of a per-card delete button. Same capability, a second interaction model
  to learn and maintain. Per-card destructive button only.
- **303:2118 "deleted"** is the post-delete grid; the toast and query invalidation cover
  it. Not a separate state.
- **A second photo slot.** The frames draw two thumbnails; one `photo_uri` column ships.
  A join table would need its own tenant_id, RLS policy, grants and a gallery UI to model
  a cardinality nothing has asked for.

The frame also labels rates `($)` against a peso-denominated product, and numbers its form
sections 1, 2, 3, 5. Both recorded in `report-figma-route-alignment.md` §5 as design-side
debt.

## 5. Console surface

Add and Edit are one component — the two frames differ only in heading and submit label.
Both open in the existing `Modal`; retire goes through `ConfirmDialog`; every mutation
lands a toast. The confirm body says the rental history, field logs and the invoices they
priced are kept, which is the opposite of what the frame promises and what actually
happens.

The route keeps **no `beforeLoad` guard**. It had none, and adding one would have taken
the fleet list away from owners and timekeepers who can see it today. The write buttons
render only for `fleet:manage` (admin, platform_admin — owner is excluded per QAD-T19);
the API is the real boundary either way.

Cards carry `aria-label={serialNo}`, which names them for assistive technology and lets
the e2e spec scope an action to one machine.

## 6. E2E: the suite could not fail before this

`apps/web/e2e/`'s sign-in helper returned a boolean that every authed spec passed to
`test.skip()`. Without a running API and a seeded database the console specs reported
green having asserted nothing — which was every machine, because **no CI job ran
Playwright at all**. `signIn` now throws, and a `console-e2e` job lands with it.

`inventory-crud.spec.ts` walks one machine end to end: add through the modal, confirm the
card, edit, confirm the serial field is disabled, retire, confirm it leaves the grid. One
journey rather than three tests, so the retire is the cleanup and nothing is orphaned in
the seeded tenant per run.

One transport finding worth recording, because it cost time and reads as something else
entirely: `login.tsx:50` catches **every** throw as `"Incorrect email or password."`,
including a request the browser refused to send. Over HTTPS (dev certs present) the page
blocks `auth-client.ts`'s absolute `http://localhost:3000` API base as mixed content, and
the UI reports it as a credentials problem. The CI job serves vite over plain HTTP so the
page and the API share a scheme. A narrower catch in `login.tsx` would be a worthwhile
follow-up; not done here to keep this pass to the inventory surface.

## 7. Verification

- `pnpm --filter @arkilaunch/db migrate` applied, then re-run clean (idempotent). Grants
  confirmed by querying `information_schema` directly: table privileges on `equipment` are
  INSERT and SELECT only; UPDATE is column-scoped to the eleven listed; `serial_no` and
  `tenant_id` carry none.
- `apps/api` full suite: **165/165**, including five new retire cases and the grant
  regression test. The suites that write `availability_status` and `runtime_hours`
  (bookings, sites, edtr) pass after the REVOKE, which is the check that matters.
- `apps/web` typecheck clean, unit suite **171/171**, production build clean.
- Playwright against the real API and database: **8/8**, including the three console specs
  that had been skipping silently.
- `migration-rls-guardian` run on the migration diff. It returned FAIL on a sequencing
  artifact — it reviewed the migrations before the service commit existed, so nothing yet
  wrote `retired_at`. Items 1, 2, 4 and 5 (RLS intact, expand-only, seeds unaffected,
  `serial_no`/`tenant_id` immutability intentional) passed. Its substantive catch — that
  `update()` accepted the spec fields and silently dropped them — was real and is fixed.
- `tenant-isolation-checker` on the full diff: **PASS**. Confirmed every new path derives
  `tenant_id` from the verified JWT, all five service methods run inside `withTenantTx`,
  the Storage key is built from `ctx.tenantId`, `setPhoto`'s bare `eq(equipment.id, ...)`
  is covered by RLS, and `0027` narrows rather than widens what the `@Public` catalog
  functions expose.
- `restraint-guardian` on the full diff: no findings. It also caught a real defect the
  test suites could not — the new CI job flattened its throwaway PEM with a no-op `sed`
  substitution instead of escaping the newlines, so RS256 loading would have failed on
  the job's first run. Fixed.
- **Not run in this pass:** an actual upload against a real Supabase bucket (no live
  credentials in this environment), so the photo path is verified by contract and by the
  reused, already-tested validation layer rather than end to end.
  `tenant-isolation-checker` was not re-run; no new table and no new tenant-scoped read
  path was introduced, and the object-key derivation is unchanged from
  `cr-arkilaunch-storage-upload.md`.
