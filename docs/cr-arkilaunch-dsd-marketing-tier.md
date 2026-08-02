# Change Record

**Title:** Merge a SprintForge-derived marketing visual system into the DSD as a new Marketing tier; land the Console token layer and primitives in code
**Project:** ArkiLaunch
**Date:** 2026-08-02
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** user request -- acquire/merge an externally-supplied "SprintForge" design system (DESIGN.md-shaped brief) into ArkiLaunch's Yardboard system, keeping ArkiLaunch's existing branding and colors
**Docs touched by this record:** [dsd-arkilaunch.md](dsd-arkilaunch.md) §0, §1, §2.0, §2.1, §2.3, §2.5, §3, §4, §5, §6, §7, §8.3, §8.4, Self-Check (Locked, amended); [prd-arkilaunch.md](prd-arkilaunch.md), [sdd-arkilaunch.md](sdd-arkilaunch.md), [qad-arkilaunch.md](qad-arkilaunch.md), [rfc-arkilaunch-tenancy-rls-auth.md](rfc-arkilaunch-tenancy-rls-auth.md), [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md), [rfc-arkilaunch-quotation-pricing-engine.md](rfc-arkilaunch-quotation-pricing-engine.md) headers (Status/Last-reconciled drift fix, unrelated housekeeping); [build-arkilaunch.md](build-arkilaunch.md) §1 (stale line fix); root `DESIGN.md`, `BRAND.md` (re-materialized); [index.md](index.md) §1/§2/§4/§5; root `AGENTS.md` §1 (re-materialized from build-arkilaunch.md)

---

## 1. Summary

The user supplied a complete, self-contained design brief for a system called "SprintForge": Inter + Instrument Serif typography, `#E34A32` orange accent, 24-40px radii + pill shapes, glassmorphic floating nav, layered shadows, a Three.js hero mesh, and scroll/parallax motion -- built for a React marketing landing page. The ask was to merge/acquire this into ArkiLaunch while keeping ArkiLaunch's own branding and colors.

Direct adoption was not possible without contradicting the Locked DSD on nearly every axis: `BRAND.md` §0 names "Inter everywhere, a glassy floating dashboard card" as the forbidden category-slop default for this product, and `DESIGN.md` §8.3 lists glassmorphism, Inter-only typography, and unbounded motion as anti-patterns "prevented by design" for a product built for a five-year-old Android over 3 to 5 Mbps. The DSD's own token architecture (§2.0) also does not yet exist in code: `apps/web/src/index.css` was a bare `@import 'tailwindcss'`, there was no `src/components/` directory, and the four POC routes used stock `slate-*`/`blue-*` Tailwind utilities.

Resolution: a **two-tier system on one token root**. `BRAND.md` already drew a line -- "S1 Public Landing and S22 Catalog Browse carry a light Brand-Mode surface... every authed surface is strictly Product Mode" -- so SprintForge becomes the **Marketing tier**, formalized from that existing one-sentence exception. Every SprintForge token is either dropped (the `#E34A32` accent, which sat between `--weather-orange` and `--color-error` and would have diluted both semantic scales), remapped onto the existing amber/steel palette, or admitted as a new marketing-only token explicitly scoped to `[data-tier="marketing"]`. The Console tier -- Rhea's daily instrument panel -- is untouched: same 4/6/8px radii, same border-first depth with no `backdrop-filter`, same <=250ms motion ceiling, same IBM Plex-only typography.

This pass also does the thing the DSD's own Self-Check had left unchecked since M2 ("This document exists in code as CSS variables / Tailwind config; pending build"): it lands the Console token layer, self-hosted fonts, and a first set of primitives in `apps/web/`.

## 2. DSD amendments

**§0 Mode:** the Brand-Mode/Product-Mode split is promoted to two named **tiers** (Console default; Marketing = S1/S22), each with its own token scope, set once via `data-tier="marketing"` on a route wrapper.

**§0 Anti-References / §1:** "Default SaaS purple" and "Enterprise SaaS coldness" stay absolute, both tiers, no exception. Glassmorphism and floating-card depth, previously banned outright, are narrowed to **Console-tier-forbidden, Marketing-tier-permitted** under the new §6 progressive-enhancement gate.

**§2.0 Token Architecture:** adds a **tier** axis, orthogonal to light/dark theme. Marketing tokens carry an `-mk` suffix and only resolve inside `[data-tier="marketing"]`.

**§2.1 Colors:** adds marketing surface tokens (`--color-bg-mk-frame`, `--color-bg-mk`, `--color-surface-mk`, `--color-ink-mk`, `--border-glass`) plus one new primitive, `--color-primary-ink` (`#7A5200`), needed because SprintForge's amber-text-on-white status-chip pattern fails AA with the raw `#F2A100` amber (that value pairs with dark text only, per the existing core table). Verified 6.9:1 on `#FFFFFF` and 6.2:1 on `#F5F2EB`, both above the 4.5:1 AA floor. SprintForge's `#E34A32` is not carried into any token.

**§2.3 Typography:** keeps IBM Plex as the type system on marketing surfaces too; adds a single `accent-serif` role (Instrument Serif italic, headline accents only). The pointer-proximity variable-weight effect is adopted on IBM Plex Sans, not Inter -- verified against the actual downloaded font file that IBM Plex Sans ships a true variable `wght` axis of **100 to 700** (IBM Plex Sans Condensed does not; static instances only), so the effect's ceiling is corrected from SprintForge's literal 900 to the type family's real 700, not faked with `font-synthesis`. Marketing font budget capped at <=110KB (vs. Console's 90KB), and Instrument Serif is not preloaded since no Console route ever requests it.

**§2.5 Elevation, §3 Layout:** add the marketing shadow/blur set (one permitted `backdrop-filter`, the glass nav) and the marketing radius scale (8/16/24/28/40px + a 999px pill), both strictly scoped to `[data-tier="marketing"]`. Console's 4/6/8px radii and no-`backdrop-filter` rule are restated as unchanged.

**§4 Core Component Specs:** adds a "Marketing components" subsection (FloatingNav, FeatureTile, ProofPill, PackageCard, RiseIn) -- **specified, not built this pass** (§4 below).

**§5 Motion, §6 Accessibility:** add the marketing motion set (rise-in, drift, hover-lift, pointer-driven parallax) and its progressive-enhancement gate: a WebGL mesh (whenever implemented) loads only above the `lg` breakpoint, only without `prefers-reduced-motion`, only after a connection/memory capability check, with a static fallback and `pointer-events: none`. Console's <=250ms/no-parallax rule and 44/48px touch targets are unchanged.

**§7 Taste-Skill Settings:** splits into two dial sets -- Console keeps `4/2/8` unchanged; Marketing gets its own `7/6/3`.

**§8.3, §8.4:** updates the glassmorphism anti-pattern row to reflect the tier scope, adds a new "marketing motion/asset budget" risk row (mitigated by the §6 gate), and adds an S1 Public Landing row to Application Examples.

## 3. Code changes

- **`apps/web/src/index.css`:** replaced the bare `@import 'tailwindcss'` with the full three-tier token layer using Tailwind v4's CSS-first `@theme` (no `tailwind.config.js`, correctly none created): primitives, Console semantic tokens, `[data-theme="dark"]` night-yard overrides, `[data-tier="marketing"]` marketing tokens, `@font-face` declarations, and a global `prefers-reduced-motion` collapse. Added `@custom-variant dark`/`marketing` so Tailwind's `dark:`/`marketing:` prefixes key off the DSD's own attributes rather than `prefers-color-scheme`.
- **Fonts:** self-hosted the actual IBM Plex Sans (variable, confirmed via `fonttools`/`brotli` to ship a real `fvar` table, wght 100-700), IBM Plex Sans Condensed 600, IBM Plex Mono 500, and Instrument Serif italic 400 as Latin-subset WOFF2 under `apps/web/public/fonts/` (new directory). Console font payload: ~78.5KB (under the 90KB budget); adding Instrument Serif for Marketing: ~100.2KB (under the 110KB marketing budget). Preload links added to `apps/web/index.html` for Plex Sans variable + Plex Mono 500 only, per the DSD.
- **Console primitives** (`apps/web/src/components/`, new directory, kebab-case files per `AGENTS.md` §5): `button.tsx` (five variants, 44/48px sizes, loading state), `input.tsx` and `select.tsx` (label-above-field, numeric/mono variant, error state with icon), `surface.tsx` (border-first card/panel), `icons.tsx` (a handful of inline 1.5-stroke SVGs; no icon library dependency installed).
- **Restyled the existing POC routes** (`index.tsx`, `login.tsx`, `quotes.tsx`, `edtr.tsx`, `kyc.tsx`) off stock `slate-*`/`blue-700` onto the new tokens/primitives. `edtr.tsx` had zero styling before this pass.
- **Signature domain components** (`status-pill.tsx`, `gauge-readout.tsx`, `confidence-chip.tsx`, `hazard-divider.tsx`, `weather-banner.tsx`), each with a colocated `*.test.tsx` using `renderToStaticMarkup` (no new test dependency). `hazard-divider.tsx` deliberately reads the raw `--steel-900` primitive rather than `--color-text`, so the amber/black stripe does not flip to amber/cream under the night-yard dark theme.
- **`apps/web/vite.config.ts`:** added a `test.include` scoping Vitest to `src/**/*.{test,spec}.{ts,tsx}`. This incidentally fixes a pre-existing bug flagged (but explicitly left untouched) by `cr-arkilaunch-f4-f5-fleet-weather.md` §6: Vitest's default glob was picking up the Playwright `e2e/login.spec.ts` and crashing. Fixing it was necessary to actually run this pass's new component tests via `pnpm test`.

**Not built this pass** (specified in DSD §4, deferred per scope note below): the Marketing-tier components (FloatingNav, FeatureTile, ProofPill, PackageCard, RiseIn), the Evidence Split View, and the S1 Public Landing page itself. No `three` (or any WebGL) dependency was added, since nothing yet consumes it.

## 4. Housekeeping (unrelated to the design-system merge, folded into this pass)

Two pre-existing governance defects surfaced during exploration and were fixed with the user's approval:

1. `docs/index.md` §1 marked PRD, SDD, DSD, QAD, and RFC-001/002/003 `Locked` (as of the 2026-08-01 lock pass), but each of those seven files' own header still read `Status: Draft` / `Last reconciled: N/A`. All seven headers now read `Locked` with a `Last reconciled` date matching `docs/index.md`.
2. `AGENTS.md` line 38 (materialized from `build-arkilaunch.md` §1, which is Draft, so no CR was needed for this half) read "All suite docs are currently `Draft`", contradicting the same manifest. Corrected in the canonical `build-arkilaunch.md` and hand-re-materialized into `AGENTS.md`.

## 5. Verification

- `pnpm --filter @arkilaunch/web typecheck` -- clean.
- `pnpm lint` (root `eslint .`) -- clean.
- `pnpm --filter @arkilaunch/web build` -- succeeds; CSS bundle 19-21KB (gzip ~5KB).
- `pnpm --filter @arkilaunch/web test` -- 4 files, 13 tests passing (GaugeReadout, ConfidenceChip, HazardDivider, WeatherBanner), including assertions that below-gate ConfidenceChip tones are louder (bold + ring), not quieter, and that a cached WeatherBanner renders the dedicated `stale` tone rather than keeping its last severity color.
- `pnpm --filter @arkilaunch/web e2e` (Playwright) -- existing `e2e/login.spec.ts` (unauthenticated redirect) still passes after the restyle.
- Manual visual verification via Playwright screenshots (not committed; scratch output) of the restyled login page, the restyled EDTR page (radio group, selects, mono numeric inputs, disabled/approve button states), and a temporary mount of all four new domain components -- confirmed the amber-primary-with-dark-text rule, mono tabular-nums gauge values, louder review/failed confidence chips, PAGASA-red and stale-gray weather banners, and the diagonal hazard stripe all render as specified. The temporary mount was reverted before this CR; none of the four components has a real consumer screen yet.
- Contrast: `--color-primary-ink` (`#7A5200`) computed at 6.9:1 on `#FFFFFF` and 6.2:1 on `#F5F2EB` (relative-luminance method, WCAG 2.2), both above the 4.5:1 AA floor. Existing verified pairings (body 16.8:1, muted 6.7:1, amber-on-dark 8.8:1) were not touched.
- IBM Plex Sans's variable-font claim was verified, not assumed: `fonttools`/`brotli` inspection of the downloaded WOFF2 confirmed an `fvar` table with a single `wght` axis, min 100 / default 400 / max 700; IBM Plex Sans Condensed's WOFF2 has no `fvar` table (static). This directly corrected the DSD's typography section (§2.3) from an open question to a verified fact.

## 6. Scope note

Deferred, by design, not by omission:

- The Marketing-tier components (FloatingNav, FeatureTile, ProofPill, PackageCard, RiseIn) and the S1 Public Landing page are fully specified (DSD §4, materialized to DESIGN.md) but not built. No route wires `data-tier="marketing"` yet.
- No `three`/WebGL dependency was added; the DSD's progressive-enhancement gate (§6) is a design constraint waiting on that future build, not code shipped this pass.
- `apps/web/index.html`'s `<meta name="robots" content="noindex, nofollow">` still applies to the whole SPA; it must be scoped per-route before any public marketing route ships.
- The Evidence Split View, Status Pill's fleet-status color mapping, and every domain component's actual consuming screen (S4, S7, S8, S13) remain unbuilt; today's components have colocated unit tests but no integration screen.
- Pre-merge SAD agents (`tenant-isolation-checker`, `restraint-guardian`, etc.) were not run against this diff -- flag if/when you want them run before this ships. This change touches no tenant data path, auth, or RLS surface, which is why they were not judged necessary here.
