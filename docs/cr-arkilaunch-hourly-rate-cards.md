# Change Record

**Title:** Heavy-equipment rate cards are hourly only
**Project:** ArkiLaunch
**Date:** 2026-09-29
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Product decision (2026-09-29, repo cleanup pass 3): heavy-equipment rate cards are strictly hourly. Self-loading truck pricing is separate and unchanged.
**Docs touched by this record:** [rfc-arkilaunch-quotation-pricing-engine.md](rfc-arkilaunch-quotation-pricing-engine.md) §3 (addendum), [index.md](index.md) §2, [log-arkilaunch.md](log-arkilaunch.md) §1

---

## 1. Why

RFC-3's formula has always read `rate_card_value` as a per-hour figure. A later price-book change let a card be `daily` or `monthly` and charged it "in its own unit" (`rentFor`, formula 2.0). That left several holes:

- **A ₱0 deduction.** EDTR approval prices a deduction only against an in-force **hourly** card. When a type had only daily cards, the fail-closed probe also filtered to hourly. It found nothing and let the approval price at 0, which posted a real-looking ₱0 deduction.
- **Wrong display.** The storefront card and the detail page showed a monthly rate as "/ hour".
- **Hidden daily default.** The rate-card form defaulted to `daily`.
- **Extra pricing paths.** The monthly branch and the daily-card lookup beside it were code paths the RFC never specified.

The decision removes the second unit instead of patching around it. Only Almara had non-hourly cards: 4 daily, 1 of them in force. The seeds and the test tenants were already hourly.

## 2. What shipped

- **Migration `0071_hourly_rate_cards.sql`.** It retires every in-force non-hourly card (`effective_to = now()`) and adds `rate_cards_hourly_only_chk CHECK (rate_type = 'hourly') NOT VALID`. Historic rows stay unchanged, because issued quotations reference them. Cards are retired, not converted: a daily price divided by hours is a new price, and staff must set it.
- **Shared.** `RateTypeSchema` is `z.literal('hourly')` on the create and list-query inputs. `rentFor(rate, hours)` returns `rate × hours` as one hourly part. `RentUnit` and `RentPart` still allow `daily` and `monthly`, because stored quotations carry historic rent parts. `DAYS_PER_MONTH` is deleted. A quote line's `days` input stays and means `days × billing dailyHours` hours.
- **Pricing engine.** `RENT_UNITS`, `dailyRateBeside` and the daily and monthly branches are deleted. A non-hourly card is refused with 422 `rate_type_unsupported`. `daily_rate_php` no longer appears in `pricing_inputs`. `FORMULA_VERSION` stays `2.0`, because hourly math is unchanged.
- **Auto-quote.** It picks only an in-force hourly card, with the unit's card preferred over the type's, and has no hire-length preference.
- **Supersede and retire** (`PATCH` / `DELETE /rate-cards/:id`). Both lock the row and close it through a conditional update that matches only a **current** card (`effective_to` null or in the future). Supersede also requires the new `effectiveFrom` to be after the card's own. Otherwise the call returns 409 `rate_card_not_current` and writes no successor. Without this guard, superseding a retired daily row would copy `rate_type = 'daily'` into the successor and trip the new CHECK as a 500.
- **EDTR approval.** The "any card for this type" probe no longer filters by rate type. A type with cards but no in-force hourly card fails closed with 422 `rate_card_not_effective`. A type with no cards at all behaves as before.
- **Web.** The rate-card form has no rate-type select and labels the field "Rate per hour". The storefront card, the equipment detail page and the quote builder always show "/ hour". The quote builder always sends hours. The cart estimate is `rate × hours`. `formatRateType` is deleted. The `quote-lines.tsx` `UNIT` labels stay, so historic quotations still render "/day" and "/mo".
- The catalog SQL function (0065) and `/reference/rate-cards` already filter on the effective window, so retired cards leave the storefront and the pick-lists without further change.

## 3. Recorded, not fixed

- **`VALIDATE CONSTRAINT` is not run.** The historic daily rows would fail it. The constraint stays `NOT VALID` for as long as those rows exist, which is as long as the quotations that cite them.
- **Almara's retired daily types need new hourly cards.** Until staff add one, a new quote for that type has no card, auto-quote leaves the booking for a manual quote, and an EDTR approval on a report date the retired card covered fails with 422 instead of deducting. This is intended: no deduction is priced from a unit nobody set.
- **`/rate-cards?rateType=` now rejects `daily` and `monthly`.** The history view has no rate-type filter and does not use it.
- **The rate-type column stays.** Dropping `rate_cards.rate_type` would need a contract change and a backfill, for no behavioural gain.

## 4. Verification

- The 0071 SQL ran inside a transaction on the dev database and was then rolled back (deploy applies it for real). Before: 50 in-force hourly cards and 1 in-force daily card. After: the daily card was retired and hourly was untouched. A new `daily` insert failed on `rate_cards_hourly_only_chk`.
- `pnpm build:packages`, `pnpm typecheck` and `pnpm lint` are clean. The only lint errors are in the untracked `apps/web/.wrangler/**` and `worker-configuration.d.ts`.
- `pnpm --filter @arkilaunch/shared test`: 260/260 pass. This covers hourly-only `RateCardCreateRequestSchema` and `rentFor`.
- `pnpm --filter @arkilaunch/web test`: 392/392 pass. `quotes.test.tsx` asserts that a quote sends `estimatedHours` and no `days`, and that the preview renders "/hr × 8 hours".
- API specs, run one at a time against the dev database:
  - `rate-cards.spec.ts`: 8/8. New tests: superseding or retiring a non-current card returns 409 and leaves no successor, and a supersede dated before the card starts returns 409.
  - `billing-engine.spec.ts`: 7/7. New test: approving an EDTR for a type whose only card is daily returns 422 and posts no deduction or invoice. On a database where 0071 is applied, a daily card cannot be inserted, so the same test instead asserts that the CHECK rejects the insert.
  - `pricing-engine.service.spec.ts`: 6/6, including days turned into hours and a refused daily card.
  - `quotes-engine.spec.ts`: 11/11.
  - `edtr-engine.spec.ts`: 11/11.
  - `money-path.spec.ts`: 8/8.

## 5. Pre-merge gate runs

| Agent | Applies? | Verdict |
|---|---|---|
| `migration-rls-guardian` | Yes. Migration 0071: a data retire plus a CHECK, with no new table and no RLS change | Pending. Runs in the Phase 6 gate pass |
| `tenant-isolation-checker` | Yes. Rate-card queries changed. Tenant still comes from ctx, and every read and write runs in `withTenantTx` | Pending. Runs in the Phase 6 gate pass |
| `edtr-ocr-worker` | Yes. The EDTR approval deduction gate changed (fails closed harder) | Pending. Runs in the Phase 6 gate pass |
| `ai-ocr-abuse-runner` | No. The OCR and extraction path is unchanged | Not run |
| `restraint-guardian` | Yes | Pending. Runs in the Phase 6 gate pass |
