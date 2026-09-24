# Change Record

**Title:** Customer browse UX: the equipment shell, the Figma right rail, a customer weather forecast, and the accessibility floor
**Project:** ArkiLaunch
**Date:** 2026-09-24
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user request 2026-09-24; Figma `ENpes2ZBsS3baRPKLyx0d3` Equipments Page (`185:1599`)
**Docs touched by this record:** [index.md](index.md) §2, [cr-arkilaunch-open-meteo-free-tier.md](cr-arkilaunch-open-meteo-free-tier.md) (call budget, see §5)

---

## 1. Why

Browsing equipment threw a signed-in customer out of their own app.

`/equipment` sat under the **marketing** layout (`publicLayoutRoute`), so it rendered
`FloatingNav` — a bar with two links — and a footer, with no sidebar. But the account
sidebar's "Browse equipment" pointed straight at it. One click cost the customer their
sidebar, app bar, notification bell and cart, and the only way back was
`window.location.assign('/account')`, a full page reload. Figma `185:1599` draws this page
*inside* the customer shell, with a right rail carrying Weather Insights and Cart.

Neither rail existed. Weather was worse than missing: both weather routes on
`sites.controller.ts` are `@RequirePermission(...STAFF_READ)`, so a customer could not read
weather at all, and `WeatherPort` returned **current conditions only** — there was no
forecast anywhere in the system, and `weather_alerts` holds per-site advisories, not an
outlook.

## 2. Decisions (confirmed with the user 2026-09-24)

- **One URL, chrome by auth state.** Not a second route under `/account`: that needs four
  route definitions for two pages, forces every outbound link and every crawler to pick a
  URL, and puts the catalog behind `requireAuth()` — which kills public access for the one
  page that needs both.
- **The landing, contact, help, terms and privacy pages keep the marketing shell.** Figma
  keeps the landing as marketing, and `/terms` must render identically for a crawler and a
  signed-in user.
- **Both rails**, with the weather half restricted to signed-in customers and their own
  project sites.
- **Real forecast or none.** Building the Mon–Fri strip as drawn without a forecast source
  would mean inventing numbers, which `cr-arkilaunch-pilot-honesty.md` forbids.
- **The serial number stays off the public catalog** — already settled in
  `cr-arkilaunch-cart-validation.md` §4 and unchanged here.
- Accessibility: skip link, `<main>` on the auth shell, tooltip focus ring. Per-page
  document titles explicitly **out** of scope.

## 3. What changed

- **`routes/_storefront.tsx`** — a layout with **no `beforeLoad`**, rendering `SidebarShell`
  when `getAccessToken()` is set and `MarketingChrome` otherwise. `usersQueries.me()` is
  gated on `enabled: signedIn` so a visitor fires no authenticated request. `/equipment` and
  `/equipment/$equipmentId` move onto it; **paths are unchanged**, so no redirects and no SEO
  change. The detail page moves too — leaving it behind would drop the customer out of the
  shell one click into the page being fixed.
- **`components/equipment-rail.tsx`** — the Figma rail. Cart for everyone, weather for
  signed-in customers. Hidden below `lg`, where it would push the catalog off the fold.
- **`lib/weather-code.ts`** — `describeWeatherCode()` and `weekdayLabel()`. See §6.
- **`lib/cart-client.ts`** — `useCart()`, a `useSyncExternalStore` subscription. See §4.
- **Forecast API** — `WeatherForecastPort` (a separate interface), the Open-Meteo daily
  block, and `GET /me/sites/:id/forecast`. See §5.
- **Accessibility** — `components/skip-link.tsx` rendered by all four shells with the
  matching `id="main"`; `<main id="main">` on the auth shell; `outline-none` removed from
  `tooltip.tsx`; both `<aside>` landmarks named, now that the catalog renders two.
- The marketing footer's bare `<a href>` become router `Link`s — every footer click was a
  full page reload.

## 4. Bugs found on the way, and fixed

Recorded because each was pre-existing and none was the reported symptom.

- **The cart was not observable.** Three places read it — the cart page, the sidebar entry,
  the new rail — and a change in one never reached the others. `clearCart()` needed wiring
  in explicitly: it is the one mutator that bypasses `saveCart`, and it runs right after a
  booking is placed, so without it the sidebar kept counting machines the customer had
  already booked.
- **`sessionStorage` can throw, not just return null** (Safari private mode, blocked site
  data) and only the JSON parse was guarded. Reads and writes are both guarded now. This
  mattered more after the change than before: `useCart()` runs in the sidebar of every
  console screen, so an exception would have taken down the whole app rather than one page.
- **Signed-out "Rent" was a silent guard bounce.** `/account/cart` is behind `requireAuth()`,
  so "Book now" sent a visitor to `/login` with no destination and no explanation —
  indistinguishable from the button not working. Both rent actions now pass
  `?redirect=/account/cart`, which `login.tsx` already validates through
  `isSafeInternalRedirect`, and the buttons say "Sign in to book".
- **The rail's "Add a site" pointed at the cart**, where a site can only be added once a
  booking is in progress. It points at the company list, where `SiteDialog` actually lives.
- **The catalog grid sized itself from the viewport.** `sm:grid-cols-2 lg:grid-cols-3`
  cannot know the sidebar has taken 240px and the rail another 320, so at 1075px the
  catalog had ~440px and put three cards in it at 201px each, names wrapping onto two
  lines. It is `auto-fill` against a 280px minimum now — the width at which a machine name
  still fits beside the Rent button — and the rail waits for `xl` rather than crowding the
  catalog at `lg`. Measured from 360 to 1920: no overflow, no wrapped titles, cards between
  296 and 376px.
- **The forecast offered a Retry that could never work.** Every failure rendered the same
  "unavailable" message with a retry, including `ENABLE_WEATHER_POLL` being unset — which
  is a configuration answer, not a transient one. The 503's `reason` now decides: a
  disabled adapter says the feature is switched off and offers nothing to press; a genuine
  upstream failure keeps the retry.

## 5. The forecast, and the licence

`WeatherForecastPort` is a **separate interface**, not an optional method on `WeatherPort`:
every implementation of that — the poller's consumer, each test double — would otherwise
grow a method it does not use, and every caller a branch guarding a case that cannot happen.

The adapter's fetch, 429, non-2xx, JSON and schema handling is factored into one request
path shared by both reads; duplicating those ~45 lines is how two subtly different error
behaviours get born. The daily block pins its units the way the current block already does,
for the same reason recorded there: a 60 kph gale arriving as 16.7 m/s reads as a calm day.
A short or ragged block throws — four days under a five-day heading is the same class of
quiet lie as the all-zero observation `weather-port.spec.ts` pins as a regression.

`GET /me/sites/:id/forecast` sits under `booking:read`, not a new `weather:read` code: that
would be granted to the same role set, need seeding in two places, and add nothing — **the
isolation here is `ownCustomers()`, not the permission**. `customer` is an intra-tenant
role, so RLS puts every customer of a tenant in one scope; without the ownership check on
top, this read tells one customer where another company is working
(`audit-api-surface.md` #1). It refuses as not-found, so the check confirms no ids.

Forecasts are cached in-process on coordinates rounded to ~100 m, for
`WEATHER_POLL_CADENCE_MINUTES`. **This is the load-bearing half**: a client-side
`staleTime` does nothing about N customers each opening the browse page. Successes only —
caching a failure turns one bad minute into thirty. No migration: the forecast is never
persisted, so there is nothing to tenant-scope.

**Open item, escalated to the user and NOT resolved.** Open-Meteo's free tier is licensed
for **non-commercial use**. `cr-arkilaunch-open-meteo-free-tier.md` records shipping
against it anyway, and `weather-port.ts` carries the exposure as an open item — but until
now it fed only the internal staff advisory poller. Putting a forecast on the equipment
*browsing* page moves that data onto a customer-facing revenue surface, which materially
strengthens the commercial-use reading. Raised with the user on 2026-09-24, who chose to
proceed and record it. It is not closed by this change. That CR's call-budget arithmetic
also assumed the poller was the only caller, which is no longer true.

## 6. Two small things worth knowing

- **Nothing translated a WMO weather code before.** The advisory path works off measured
  wind and rain thresholds (`weather-explain.ts`) and never needed one, but a forecast row
  reading "3" tells a customer nothing. `describeWeatherCode()` maps ranges rather than an
  exhaustive table, and an unrecognised code reports itself as unknown rather than guessing
  a calm one.
- **`new Date('2026-09-21')` is UTC midnight**, which in Manila (UTC+8) is the day before.
  Rendered through a date getter, every weekday label in the rail would have been off by
  one. `weekdayLabel()` parses the parts and builds a local date.

## 7. Verification gates

| Gate | Result |
|---|---|
| `pnpm lint` | Pass. One pre-existing warning, present on `dev`. |
| `pnpm typecheck`, `pnpm build` | Pass, all packages. |
| Web unit suite | Pass — 221 tests across 33 files, including 5 new shell regression tests, 6 rail tests, 8 cart-store tests and 7 weather-code tests. |
| `apps/api/test/customer-onboarding.spec.ts` | Pass — 20 tests, including the forecast ownership, unavailability and caching assertions. |
| `packages/weather` | Pass — 16 tests, including the malformed, ragged and wrong-unit forecast bodies. |
| Playwright | **Pass in CI** — 31 tests (21 desktop + 10 Pixel 5), `console-e2e`, green across three consecutive runs after the helper flake below was fixed. |
| `restraint-guardian` | **PASS**, nothing to cut. Assessed the six constructs most at risk of being over-build and found each load-bearing; flagged `e2e/sidebar.ts` as the thinnest justification (two call sites) and kept it, since it encodes the strict-mode double-match a third spec would otherwise get wrong. |
| `tenant-isolation-checker` | **PASS.** Confirms the layering: `assertCustomer` refuses staff first, `ownCustomers()` bounds the customer within the tenant, the refusal is NotFound so no site ids are confirmed. Also assessed the coordinate-keyed cache specifically — it holds public weather only, carries no tenant or customer identifier, and is read *after* the ownership check. |

## 8. Honest gaps

- **The app WAS driven in a real browser**, at 1440px and Pixel 5, signed out and signed
  in, against the live API. The signed-in shell renders the sidebar, app bar, styled
  catalog and both rail panels; there is no horizontal scroll at phone width and no console
  error. Two caveats: the seeded anchor accounts' passwords are not the seed default and I
  did not reset them, so the signed-in pass used a **throwaway account created through the
  public self-signup endpoint** (`uxqa-<timestamp>@arkilaunch.test`, still present in the
  anchor tenant); and the forecast rail was exercised only in its no-site state, because
  that account has no project site.
- **The weather rail shows the customer's first site**, with no picker. Guessing at that
  shape before a multi-site customer asks for it would be building for an imagined user.
- **`MAX_POLLED_SITES_PER_CYCLE` has not been re-derived** against the new caller. The cache
  keeps the order of magnitude the same, but the arithmetic in
  `cr-arkilaunch-open-meteo-free-tier.md` is now stale.
- Per-page document titles remain absent — every page is titled "ArkiLaunch".
- **One e2e flake was found and fixed, not retried away.** `openSidebar` asked
  `isVisible()` the instant it was called, which is a snapshot rather than a wait: on a
  cold CI boot the app bar had not rendered, the helper concluded there was no drawer, and
  the spec failed looking for links that were `display:none`. It waits for the shell now,
  and the job was re-run twice afterwards to confirm rather than assume.
- The pre-existing failures in `bookings-engine.spec.ts` and `payments-engine.spec.ts`
  still reproduce on clean `dev`; leftover `customers` rows on the shared database leave the
  seeded customer owning several companies. Not introduced here, not fixed here.
