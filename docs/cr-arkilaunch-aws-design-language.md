# Change Record

**Title:** AWS design language on every screen, Yardboard colors kept
**Project:** ArkiLaunch
**Date:** 2026-09-28
**Version:** 0.1
**Status:** `Applied` (stacked branches `feat/aws-look`, `-font`, `-shell`, `-public`, `-pages`)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (owner request: "make the vibes of the entire system look like AWS, keep the colors")
**Reference:** [assets/reference/aws.design.md](assets/reference/aws.design.md)
**Docs touched by this record:** [dsd-arkilaunch.md](dsd-arkilaunch.md) §0, §1, §2, §3, §4, §5, §7 (materialized into `DESIGN.md`, `BRAND.md`), [index.md](index.md) §1/§2

---

## 1. Summary

Every screen, the back office included, takes the shape, type and elevation of the AWS reference: 16px cards, 40px pill buttons, square text inputs, 500-weight sentence-case headings, a steel top bar and footer, and cards that rest on their border and lift on hover. The Console/Marketing tier split is retired, leaving one system. The signed-in app also adopts four AWS Console patterns: breadcrumbs, a collapsible side nav, container headers (title, count, actions, toolbar with paging) and Flashbar alerts.

No color value changes. The top bar uses the existing steel `#10151B`.

## 2. Decisions (owner, 2026-09-28)

- **The reference, literally, everywhere.** It retires the §0 "enterprise SaaS coldness" anti-reference and the tier table.
- **Palette unchanged.** Amber stays primary, dispatch blue stays links and focus, paper background and sand borders stay. The one new token is an alias, `--color-nav: var(--steel-900)`. A tenant header color still paints the bar.
- **Inter as the platform sans** (the reference's Amazon Ember stand-in). Tenants can choose IBM Plex (`font = 'plex'`, migration 0061). IBM Plex Mono keeps every number (Rule 2). IBM Plex Sans Condensed and Instrument Serif are deleted.
- **Console patterns:** breadcrumbs, collapsible side nav, container headers, Flashbar.

## 3. Deliberate departures from the reference

- Our palette, not AWS's: no cerulean and no spectral gradients (the purple ban stands).
- Mono chips have a 12px floor, not 10px (DSD §6).
- Touch targets stay at 44px, or 48px on the field console.
- App page titles are 32px. The 40px size is used only on public heroes.

## 4. Not done

- Dark theme (tokens exist, nothing toggles them).
- A page-level split panel or help panel.

## 5. Verification

- Web unit tests: 317 pass. API tenant self-serve spec: pass. Typecheck clean (web + worker).
- Migration 0061 reviewed by migration-rls-guardian: PASS (widens one CHECK, no table, no RLS change). Not yet applied to the hosted dev database; `deploy.yml` migrates on deploy.
- E2E against the hosted dev data: desktop 41 pass, mobile 16 pass. The failures, `kyc-review-crop` (customer crop) and `company-documents`, fail the same way on `dev` before this change (stale against the pricebook-kyc flow); `truck-request` waits on a "Demo Customer Site" seed row the hosted data lacks.
- Screenshot QA at 1440px and 390px for admin, owner, customer, timekeeper, the storefront, the platform landing and sign-in.
