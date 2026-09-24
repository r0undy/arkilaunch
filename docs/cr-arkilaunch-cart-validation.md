# Change Record

**Title:** Cart form validation, verified-company gate, the machine photo on the storefront, and the sidebar active blade
**Project:** ArkiLaunch
**Date:** 2026-09-24
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user request 2026-09-24; Figma `ENpes2ZBsS3baRPKLyx0d3` Cart Page (`168:1982`)
**Docs touched by this record:** [index.md](index.md) §2, [cr-arkilaunch-customer-prerequisites.md](cr-arkilaunch-customer-prerequisites.md) §2 (superseded, see §2 below)

---

## 1. Why

Three separate defects on the customer path, reported together.

- **The cart had no validation.** Every rule was expressed as one `disabled`
  prop on the submit button, so a customer saw a dead button with no
  indication which field was at fault. The rental dates were not checked at
  all: a cart persists in `sessionStorage`, so dates that were valid when the
  machine went in could be in the past by the time it was submitted — that went
  to the API and came back a 400.
- **The sidebar blade marked the wrong page.** `/account` is a prefix of every
  URL in the section, so prefix-matching lit **Home** on the cart, the
  checkout, the invoice and the company form. `/app` had the same shape. The
  indicator said "you are here" on a screen the customer was not on.
- **The cart line was a model name and two date fields.** Figma `168:1982`
  draws a photo, an identifier and the rental length per machine.

## 2. The one decision that supersedes a previous one

**Only a verified company can be selected in the cart.**

`cr-arkilaunch-customer-prerequisites.md` §2 decided: *"Booking before
verification is allowed; payment is not. Checkout returns 409
`company_not_verified` until staff approve the company."* That remains the
API's behaviour and is unchanged — this is a client-side gate layered on top,
not a change to the endpoint.

Confirmed with the user 2026-09-24, against the concern that it blocks a new
customer from requesting a quote until staff verify them. The mitigation is
that the cart explains rather than silently refusing:

- Unverified companies stay **visible** in the dropdown, disabled, each
  labelled with why (`— awaiting verification`, `— verification declined`).
- When no company on the account can rent, the cart does not render a form that
  can never be submitted. It says which case applies — still being verified, or
  declined — and links to the companies list.

`validateCart()`'s `isSelectableCompany` is the single source of truth for
both the dropdown's `disabled` and the submit-time error, so the two can
never disagree.

**One concrete cost surfaced immediately.** `customers.kyc_status` defaults to
`pending`, so the seeded sample customer was unverified and a freshly seeded
environment could not reach the booking flow at all — the cart rendered its
"still being verified" state and everything behind it was dead. It showed up as
two failing e2e specs. `seed/anchor.ts` now marks the sample company
`approved`. Any environment that seeds its own customers has the same trap.

## 3. What changed

- **`apps/web/src/lib/cart-validation.ts`** — a pure function beside the page:
  company required and verified, project site required, per-item dates (not in
  the past, end after start, at most `MAX_RENTAL_DAYS`), contact and notes
  length-checked. Tested without a browser (`cart-validation.test.ts`, 17
  cases).
- **The cart is a real `<form>`** with `noValidate` — the messages come from
  `validateCart()`, which knows about verification state and stale cart dates,
  neither of which an HTML constraint can express. Errors stay quiet until the
  first submit, then track every keystroke; submitting with errors focuses the
  first invalid field. The submit button is no longer disabled on invalid
  input: a dead button explains nothing.
- **Migration `0028`** adds `photo_uri` to both catalog `SECURITY DEFINER`
  readers, and the cart line becomes photo + equipment type + short unit code +
  day count. See §4 and §5.
- **`NavItem.exact` and `NavItem.owns`** (`nav-config.ts`, `nav-group.tsx`).
  `exact` for the two section roots; `owns` lets "My bookings" claim
  `/account/checkout`, `/account/invoices` and `/account/negotiation`, which
  have no sidebar entry, so the blade stays put instead of vanishing. Matching
  is ranked by how much of the URL the matching prefix accounts for, so a
  longer `owns` still beats a shorter `to`.

## 4. What was NOT exposed, and why

Figma `168:1982` prints the yard's serial number on each cart line
(`SERIAL: #FG-90210-A`). `serial_no` is deliberately outside the public
catalog's column allowlist, and migration `0027` restates it: *"still no
serial_no, still no runtime_hours."* `/catalog/equipment` is unauthenticated,
so serving it would publish real asset identifiers to anyone who can reach the
storefront — fleet enumeration, and a serial that becomes guessable in a
support-desk or theft-recovery context.

Raised with the user, who chose the narrower option: the cart shows the same
short display code the rest of the app derives from the row id. The allowlist
is unchanged.

`photo_uri` carries no such risk — the equipment-photos bucket is public-read
by the explicit decision in `cr-arkilaunch-equipment-crud.md` §4, so serving
the pointer publishes nothing that was not already reachable. Until now
**nothing rendered an uploaded photo anywhere**: the storefront used a
three-entry hardcoded map of hotlinked stock images, so the equipment CRUD
photo upload had no visible effect. Callers now read
`photoUri ?? equipmentImageUrl(model)`, keeping the map as the fallback for the
seeded fleet.

## 5. Two things the migration got wrong first

Recorded because both failed quietly rather than loudly.

- **`CREATE OR REPLACE` cannot add a column to `RETURNS TABLE`.** Postgres
  refuses with `42P13 cannot change return type of existing function`. The
  migration has to `DROP` then `CREATE` — which loses the grants from
  `0010`/`0012`, so both are re-issued. Without the `REVOKE ALL ... FROM PUBLIC`
  the function comes back executable by `PUBLIC`. Verified after applying: the
  resulting ACL is identical to the untouched sibling functions
  (`catalog_list_testimonials`, `tenants_list_pending_applications`) — `PUBLIC`
  absent, `app_authenticated` present.
- **A hand-authored journal entry needs a current `when`.** drizzle's migrator
  decides what to apply from the journal timestamp against the ledger
  watermark. The first entry carried a timestamp derived from the previous
  migration's, which sat below the watermark, so the file was skipped in
  silence — and `pnpm db:migrate` still printed "Migrations applied". The
  function was unchanged and nothing was recorded. Worth knowing before the
  next hand-authored migration: a successful-looking migrate run is not
  evidence the SQL ran.

## 6. Verification gates

| Gate | Result |
|---|---|
| `pnpm lint` | Pass. One pre-existing warning, present on `dev`. |
| `pnpm typecheck`, `pnpm build` | Pass, all packages. |
| Web unit suite | Pass — 191 tests, including 17 new `validateCart` cases and 4 new `activeNavTarget` cases. |
| Migration applied and inspected | `pg_get_function_result` confirms the new 5-column signature; ACL compared against untouched siblings. |
| Playwright `cart.spec.ts` | **Pass in CI** — `console-e2e`, all specs green. Not runnable locally; see §7. |
| `migration-rls-guardian` | **PASS.** Confirms both filters carried forward from 0027 (no previously hidden row becomes visible), grants restored with no PUBLIC-executable gap, `SECURITY DEFINER SET search_path` preserved, allowlist unchanged. |
| `restraint-guardian` | **PASS**, nothing to cut. Assessed the three constructs most at risk of being over-build — the separate validation module, both `exact` and `owns`, and the cart-item snapshot — and found each load-bearing. |

## 7. Honest gaps

- **The e2e spec runs only in CI, where it passes.** `seed/anchor.ts` refuses to write
  development credentials into a non-local database, and `DATABASE_URL_DIRECT`
  here is the live Supabase project, so there is no seeded anchor tenant to
  sign in against. The `console-e2e` job runs `playwright test` unfiltered, so
  the spec is picked up without a workflow change.
- **3 pre-existing failures in `bookings-engine.spec.ts`** (and 7 in
  `payments-engine.spec.ts`) reproduce on clean `dev` with none of these
  changes: leftover `customers` rows on the shared Supabase database leave the
  seeded customer owning more than one company, so `POST /bookings` answers
  `company_required`. `seed:test-two-tenant` does not clear them. Not
  introduced here, not fixed here.
- **The API still accepts a booking from an unverified company.** The gate
  added here is client-side. Moving it into `bookings.service.ts` would be the
  real enforcement and is not done — the decision in §2 was about what the cart
  offers, and changing the endpoint would break the documented 409 contract
  that `customer-onboarding.spec.ts` asserts.
- **`MAX_RENTAL_DAYS` is a client-side cap** with no server counterpart.
