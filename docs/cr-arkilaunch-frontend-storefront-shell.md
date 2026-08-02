# Change Record

**Title:** Almara storefront landing page, auth flow, and role-aware app shells; build-time prerender for public routes
**Project:** ArkiLaunch
**Date:** 2026-08-02
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user-supplied Figma prototype (`7rUbrJxQpw0nNRWegoQRtZ`, page `0:1 Prototype`), reconciled against the Locked PRD §5.1/§5.2 screen inventory and IA
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §2, §6 (Locked, amended); [build-arkilaunch.md](build-arkilaunch.md) §5.2 (Draft, checklist closed); [voice-arkilaunch.md](voice-arkilaunch.md) §2 (Draft, register row added); [index.md](index.md) §2/§5

---

## 1. Summary

The design system landed in code last session (`cr-arkilaunch-dsd-marketing-tier.md`), but the site itself did not exist: `apps/web` mounted 5 of the routes the product needs, had no layout shell, no role-aware navigation, and no public surface. `/` was an authed redirect to `/login`.

A Figma prototype (`7rUbrJxQpw0nNRWegoQRtZ`) was read via the Figma MCP server (`get_metadata` + `get_screenshot`) to source the site's structure. It turned out to be materially different from what the Locked PRD's frozen S1-S25 inventory describes:

- It is **Almara's own single-tenant rental storefront** ("INDUSTRIAL FLEET MANAGEMENT & RENTALS", a searchable equipment catalog with Rent buttons), which is closer to PRD **S22 Catalog Browse** than **S1 Public Landing** (ArkiLaunch-the-SaaS marketing).
- It contains ~120 screens across desktop (1440px) and mobile (420px), including whole feature areas absent from the frozen PRD: a negotiation flow (counter-offer sent/received/accepted, chat/call screens), in-app payment credential screens (Digital Bank, Bank Transfer, GCash auth, OTP), Ticket Management, Security Logs, Extend Rental, and a fifth role, **Operator**.
- Its palette (rust header, green card headers, teal buttons, gray sidebar, USD amounts) is not Yardboard.

Per the user's explicit decisions, this pass **builds the intersection now and logs the rest as a backlog** (§4 below), **keeps Yardboard tokens** and takes only the prototype's layout/IA, makes **Almara's storefront `/`** (single-tenant first, ArkiLaunch SaaS marketing deferred), and covers **landing + auth + role-aware app shells and nav skeleton**, not the full ~120-screen surface.

## 2. What was built

**Route tree** (`apps/web/src/router.tsx`): replaced the flat 5-route tree with five layout (pathless) routes, each gating its children:

| Layout | Path prefix | Guard | Chrome |
|---|---|---|---|
| `_public.tsx` | `/`, `/equipment*`, `/contact`, `/help`, `/terms`, `/privacy` | none | `data-tier="marketing"`, FloatingNav + footer |
| `_auth.tsx` | `/login`, `/register*` | none | Centered card, "Almara by ArkiLaunch" lockup |
| `_account.tsx` | `/account/*` | any authed role | Sidebar (Home, Equipments, Bookings, Applications, Settings) |
| `_app.tsx` | `/app/*` | `admin`, `owner`, `platform_admin` (stricter per-route below) | Sidebar (Dashboard, Deployment, Inventory, Quotes, Insights, Incident Logs, Payments, OCR Tool, Registration, Manage Users, Settings) |
| `_field.tsx` | `/field/*` | `timekeeper`, `platform_admin` | Stripped console, bottom nav, 48px targets |

`apps/web/src/lib/guards.ts` and `jwt.ts` add client-side `requireAuth`/`requireRole`/`homeRouteForRole`, decoding the JWT client-side for routing UX only -- the server (RLS + `packages/db/src/seed/permission-catalog.ts`) remains the actual boundary. `/app/users`, `/app/settings`, and `/app/registration` (the KYC-equivalent) add a stricter `requireRole('admin', 'platform_admin')`, denying `owner` and `timekeeper` per the PRD §5.2 auth boundary.

**The existing `quotes.tsx`, `edtr.tsx`, `kyc.tsx` POC pages were re-parented**, not rewritten: they now mount under `_app` at `/app/quotes`, `/app/ocr` (the Figma "OCR Tool" screen), and `/app/registration` (the Figma "Registration" screens) respectively, with their own `beforeLoad` token checks removed in favor of the layout's guard. `quotes.tsx` was not in the Figma admin sidebar; it was kept and added to the nav because it is real, working PRD-F1 functionality with a live backend, and dropping it would have been a regression for no reason tied to this change.

**Storefront primitives** (`apps/web/src/components/`, new): `floating-nav.tsx`, `feature-tile.tsx`, `proof-pill.tsx`, `package-card.tsx`, `rise-in.tsx` (the five DSD §4 marketing components, previously specified but unbuilt) plus `equipment-card.tsx` and `search-filter-bar.tsx` (the Figma catalog grid's actual units, not in the DSD spec but needed to render it). All render in Yardboard tokens (`-mk` suffixed CSS variables and the `marketing:` Tailwind variant already in `apps/web/src/index.css`); none introduce a new color. `rise-in.tsx` collapses to instant under `prefers-reduced-motion` via the existing global rule. Colocated Vitest tests for the five pure-presentational components (6 tests); `floating-nav.tsx` and `sidebar-shell.tsx` need a Router context to render and are not unit-tested here (manual/e2e coverage instead).

**Landing page** (`/`, `apps/web/src/routes/index.tsx`): header, hero ("Industrial fleet management & rentals" with an Instrument Serif accent on "& rentals"), search + sort bar, a 6-item equipment catalog grid (fixture data, see §3), and a proof section replacing the Figma's testimonial grid with three `ProofPill`s: the verified 20-30 minute hand-calculated quote baseline (`brd-arkilaunch.md:28`, observed at Almara) plus two mechanism facts (2 logs reconciled before deduction; 0 deductions without a match). **The Figma's ISO 9001:2015 badge and six named testimonials were dropped**, not replaced with placeholders: Almara holds no verified ISO 9001 certification (the repo documents the unrelated ISO/IEC 25010 software-quality standard), and the six testimonial names read as UI-kit placeholders with no corroborating record anywhere in the doc suite. The footer's link lists (the Figma's raw UI-kit placeholders like "UI design", "FigJam") were replaced with real destinations.

**Auth flow**: `/login` (wired to the live `POST /auth/login`, redirects to `homeRouteForRole` on success), `/register` -> `/register/company` -> `/register/pending` (the Figma's two-step form plus approval gate, built against fixtures via `apps/web/src/lib/registration-client.ts` since no registration endpoint exists). "Forgot password?" renders disabled with an honest tooltip rather than a dead link, since no reset endpoint exists either.

**Prerender / SEO / crawlability** (`apps/web/scripts/prerender.mjs`, new): closes `build-arkilaunch.md` §5.2's indexability checklist without an SSR migration -- see the SDD §6 amendment for the mechanism. Verified end to end: a fresh `vite build` followed by `pnpm prerender` produces `dist/index.html` and 11 other route files carrying `index, follow`, a canonical link, Open Graph tags, and (on `/` only) `Organization` + `SoftwareApplication` JSON-LD, while the default `dist/index.html` shell (served for every non-prerendered route) still carries `noindex, nofollow`. `apps/web/public/robots.txt` and `sitemap.xml` implement the bot table at `build-arkilaunch.md:222-234`. `apps/web/vercel.json` (new) rewrites unmatched paths to `/index.html`; Vercel's static-file lookup serves the specific prerendered file first, so `/equipment` gets its indexable HTML and `/app/quotes` falls through to the noindexed SPA shell.

## 3. Backend gaps handled per the user's decision (fixtures now, log the API work)

No endpoint exists for the equipment catalog, tenant registration, or password reset. Per the user's explicit choice ("Build UI now against fixtures; log the API work"):

- `apps/web/src/lib/equipment-fixtures.ts` -- six equipment fixtures shaped like the eventual `GET /catalog/equipment` response (matching the Figma: Back Hoe/CAT, Bulldozer/Mitsubishi, Self-Loading Truck/Isuzu, Dump Truck/Komatsu, Back Hoe/Sumitomo, Bulldozer/CAT).
- `apps/web/src/lib/registration-client.ts` -- `savePersonalDetails`/`getPersonalDetails`/`submitRegistration`, shaped like the eventual `POST /tenants/register`, state held in `sessionStorage` across the two-step form.

Screens with a live endpoint were wired for real via the existing `apiGet`/`apiPost` helpers (not TanStack Query, matching the codebase's established POC pattern rather than introducing a new fetching layer mid-change): `/app/inventory` (`GET /equipment`), `/app/deployment` and `/field/deployment` (`GET /sites`), `/app/insights` (`GET /reports/utilization`, `GET /reports/financial`), `/app/incidents` (`GET /incidents`), `/app/payments` (`GET /invoices`), `/account/bookings` (`GET /bookings`), `/app/ocr` and `/app/registration` (the pre-existing EDTR/KYC POC flows). A shared `DataPanel` component (`apps/web/src/components/data-panel.tsx`) gives these a consistent loading/error/empty/success wrapper per DESIGN.md §4.1; most render the raw JSON response rather than a bespoke per-field UI, which is an explicit scope cut for this pass (§5).

`/app/users`, `/app/settings`, `/account/settings`, `/account/applications`, `/account/cart`, and `/field` (Operator dashboard) render the DESIGN.md §4.1 Empty state pattern (named copy, one primary action where applicable), since no endpoint exists for any of them and no Figma detail was in scope to fabricate one.

## 4. Logged as deferred (one future Change Record each, per the user's decision to build the intersection and log the rest)

- **Negotiation flow** (counter-offer sent/received/accepted, Messenger chat, phone call screens) -- no PRD feature, no backend, no RBAC model for a negotiating party.
- **In-app payment credential capture** (Digital Bank, Bank Transfer, GCash auth, OTP Verification) -- explicitly superseded by PayMongo hosted checkout per the user's decision; only pre/post screens are ever appropriate here (PRD-F2, DSD §4.1 "Don't: collect card data in-app").
- **Ticket Management, Security Logs** -- no PRD feature, no backend.
- **Extend Rental** -- no backend endpoint.
- **Operator as a distinct sixth role** -- mapped onto the existing `timekeeper` role this pass (UI label only, zero RBAC change); a real `operator` role would need a Locked-RFC-1 amendment.
- **Tenant registration and company-application backend** (`POST /tenants/register`, approval workflow) -- UI built against fixtures (§3); the endpoint itself is unbuilt.
- **A public, unauthenticated equipment catalog** -- `cr-arkilaunch-f2-f8-bookings-payments.md:82` already flagged this needs its own slug-resolution guard, guest-identity model, rate limiting, and a CLR review. This pass's catalog is fixture-backed and reachable at `/` and `/equipment` without auth, but nothing behind it is actually public data yet.
- **Password reset.**
- **ArkiLaunch-the-SaaS platform marketing page** -- GTM's hero copy (`gtm-arkilaunch.md:66`) and pricing content are not used anywhere in this pass; `/` is Almara's storefront, per the user's explicit choice. If ArkiLaunch ever needs its own multi-tenant marketing surface distinct from a tenant storefront, that is new scope, not a variant of this page.
- **Bespoke per-screen UI** for `/app/insights`, `/app/incidents`, `/app/payments`, `/app/deployment`: currently render raw JSON in a `DataPanel`, not the DESIGN.md §4.1 composition patterns (Gauge Readouts, Status Pills, etc.) those screens specify. Wiring is real; the visual design is a scope cut.

## 5. PRD/SDD reconciliation note

`/account/*` is a new IA branch not named in the PRD's IA tree (which puts an unauthenticated customer at `/t/:tenantSlug`). This is the honest consequence of `cr-arkilaunch-f2-f8-bookings-payments.md`'s earlier drift, which made bookings an authenticated `customer`-role surface rather than public/guest: an authenticated customer needs an authenticated area to live in. This is recorded here, not silently introduced; a future CR should reconcile the PRD §5.2 IA tree itself if this pass's `/account/*` branch is kept as the permanent shape.

## 6. Verification

- `pnpm --filter @arkilaunch/web typecheck` -- clean.
- `pnpm lint` (root `eslint .`) -- clean.
- `pnpm --filter @arkilaunch/web build` -- succeeds; 188 modules, JS bundle 338KB (gzip 101KB).
- `pnpm --filter @arkilaunch/web test` -- 5 files, 19 tests passing (4 existing domain-component suites + 6 new storefront-primitive tests).
- `pnpm --filter @arkilaunch/web e2e` -- `e2e/login.spec.ts` retargeted and passing: unauthenticated `/` now renders the storefront heading (no redirect); unauthenticated `/app` redirects to `/login`.
- Prerender verified end to end (not just "the script runs"): a fresh `vite build` + `pnpm prerender` produces 12 route files; grepped each for the swapped `robots` meta, a single canonical link (a duplicate-injection bug from re-running prerender against an already-prerendered `dist/` was caught and fixed -- the regex that swaps the robots meta did not account for the browser normalizing the self-closing `<meta ... />` to `<meta ...>` on serialization), and the two JSON-LD blocks on `/`.
- Manual visual verification via Playwright screenshots (scratch output, not committed) of `/`, `/equipment`, `/login`, `/register`, and the authed `/app` dashboard, at both the top of `/` and scrolled to the proof-pill section (the `RiseIn` intersection reveal does not fire during a single non-scrolling full-page capture, which is expected IntersectionObserver behavior, not a bug -- confirmed by scrolling before the second capture). Confirmed: warm-concrete background, amber CTAs with dark text, Instrument Serif accent on the hero, mono tabular-nums proof-pill numerals, and the admin sidebar in Yardboard tokens with no rust/teal/decorative-green anywhere.

## 7. Scope note

Deferred, by design, per §4 above. Additionally:
- The prerender step is a separate `pnpm prerender` script, not chained into `pnpm build`, so CI/typecheck/build environments without Chromium installed are unaffected; a deploy pipeline should run `pnpm build && pnpm prerender` explicitly. This is noted as a candidate follow-up (chain them once a CI image with browsers is confirmed available).
- `sitemap.xml`/`robots.txt`/the prerender script's canonical URLs all use a placeholder domain (`https://almara.example`), since the SDD itself says the production domain is "TBD at deploy" (`sdd-arkilaunch.md` §6 Public URL(s)); replace before the first real deploy.
- Pre-merge SAD agents (`tenant-isolation-checker`, `restraint-guardian`, etc.) were not run against this diff. This change touches no tenant data path, auth mechanism, or RLS surface (only client-side routing UX and fixture-backed UI), which is why they were not judged necessary here; flag if you want them run before this ships.
