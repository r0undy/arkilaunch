# Change Record

**Title:** Repo cleanup, second pass: leftovers from five feedback batches
**Project:** ArkiLaunch
**Date:** 2026-09-25
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (brownfield change workflow); a dead-code and staleness audit after customer feedback batches 1-5
**Docs touched by this record:** [index.md](index.md) §2, [log-arkilaunch.md](log-arkilaunch.md) §1, `jobs/src/README.md`, `.env.example`

---

## 1. Why this pass exists

[cr-arkilaunch-repo-cleanup-audit.md](cr-arkilaunch-repo-cleanup-audit.md) (2026-09-13) left the tree clean. Five customer feedback batches have landed since then, bringing the landing redesign, GasWatch diesel, multi-line quotes, the toll matrix and EDTR v2. This pass removes what those batches left behind. The scope is **safe tier only**: no API contract, schema or migration change.

## 2. What shipped

**Dead web code.** `FeatureTile`, `ProofPill`, `PackageCard` and `RiseIn` stopped rendering with the landing redesign (`d59323d`), and their only importer was their own test. They are deleted, and DSD §4 already records them as specified but not built, so the doc is accurate again. `formatDateRange` (`lib/format.ts`) and `CloudIcon` (`icons.tsx`) had no call sites. **`HazardDivider` is kept** even though no page renders it. DSD §4 and §8 require it on the S8 reconciliation review and the KYC review panel, and `DESIGN.md` lists it as implemented, so it is unwired rather than dead (see §3).

**Dead api code.** `apps/api/src/ports/weather.port.ts` had no importers. The document-intelligence and payments ports re-exported shared symbols that every caller imports straight from `@arkilaunch/shared`. `@nestjs/config` was registered, but no code ever injects `ConfigService`, and `main.ts` (plus `vitest.setup.ts` for tests) already loads `.env` with `dotenv` before Nest boots.

**Dead shared code.** `WEATHER_CODE_LABELS` and `IDLE_REASON_LABELS` had no readers, because the EDTR sheet prints its own legend. `recordScrapeDieselReading` is **kept**: the DOE cron that used it is gone, but QAD-T45 still needs a per-region stale reading and `app_authenticated` has no direct INSERT (migration 0020). Its comment now says so.

**Stale docs and config.** `.env.example` documented `DOE_PRICE_WATCH_URL`, which nothing has read since the GasWatch switch. It also omitted `SEED_PASSWORD` and `ALLOW_WEAK_SEED_CREDENTIALS`. `jobs/src/README.md` said the OCR worker runs on a stub; it runs `AzureDocumentIntelligenceAdapter`. The README also did not list `weekly-billing.ts` or `ocr-fixtures-pull.ts`. The `cron_job` module comment omitted `weekly-billing`, and `make clean` removed `.turbo` directories in a repo that has no turbo.

**Local pollution (untracked, so not in the diff).** Two items were deleted: `docs/proposal-edtr-weather-attestation (2).md`, which is byte-identical to the tracked file apart from CRLF, and a stray `apps/jobs/` that held only `dist/` and `node_modules/`. The stray folder had no `package.json`, nothing referenced it, and it included a compiled `di-e2e.js` with no source anywhere. Local branches already merged into `dev`, or merged by PR, were pruned.

## 3. Recorded, not fixed

These need a contract change, a migration or a product decision, so they are out of scope for a safe cleanup:

- **Diesel `region` is vestigial.** Pricing is national (GasWatch), but `truck_settings.region`, the `region` columns on `diesel_price_readings` and `pricing_parameters`, `PricingParametersQuerySchema.region`, `DieselPriceEntrySchema.region` and `REGION='NCR'` in `jobs/src/diesel.ts` all remain. Everything defaults to `NCR`. Collapsing them needs a migration.
- **`mobilizationKm` / `demobilizationKm`** (per-km transport) are marked legacy since the flat `mobilizationPhp` (migration 0044). The web app never sends them, but the API contract still accepts them.
- **Unused schema columns:** `addressType`, `termsRef`, `planId`, `currentPeriodEnd`, `reviewedBy`, `userAgent`. App code never reads or writes them, but they exist in the database.
- **Unused shared type aliases** (`OcrField`, `EquipmentStatus`, `RateType`, `TruckAgree`, `TruckKmConfirm`, `SiteAddress`, `UserStatus`, `PaginationQuery`, and others). They are left alone for the reason the 2026-09-13 record gives: they are contract surface.
- **`HazardDivider` is specified but never rendered.** DSD §4 and §8 put it on S8 ("Hazard Divider on discrepancy; Approve disabled until resolved") and on the KYC review panel. The component and its test exist, but no screen uses it. Wiring it in is a UI change for its own PR.
- **`jobs/src/weekly-billing.ts` is not scheduled.** No Terraform cron job exists for it, and it runs only by hand. This is a gap, not dead code.
- **`POST /pricing/diesel-price`** (manual diesel entry) has no UI caller. It is kept as the RFC-3 manual-override path for ops.
- **Two `vercel.json` files**, one at the root and one in `apps/web/`, carry the same build command with different `outputDirectory`. Which one Vercel applies depends on the project's root-directory setting, which cannot be verified from the tree.
- **The prerender step still does not run on deploy.** This is unchanged since 2026-09-13.
- **Local-only test failure.** `quotes-engine.spec.ts` "a customer cannot read another customer's quote in the same tenant" fails locally both with and without this change, so it predates this pass. CI is the arbiter.

## 4. Verification

- `pnpm lint`: clean.
- `pnpm typecheck`: clean across all workspaces.
- `pnpm --filter @arkilaunch/web test`: 234/234 pass.
- `pnpm --filter @arkilaunch/shared test`: pass.
- `apps/api` `quotes-engine.spec.ts`: 9/10 pass. The one failure also fails on the unmodified `dev` baseline (see §3).
- Every removed symbol greps to zero hits in `apps`, `packages` and `jobs`.

## 5. Pre-merge gate runs

| Agent | Applies? | Verdict |
|---|---|---|
| `tenant-isolation-checker` | No. No auth, query, repository or table code touched | Not run |
| `migration-rls-guardian` | No. No schema or migration diff | Not run |
| `edtr-ocr-worker` | No. Only unused re-exports removed from the DI port; `createDocumentIntelligenceAdapter` is unchanged | Not run |
| `ai-ocr-abuse-runner` | No. The OCR path's behaviour is unchanged | Not run |
| `restraint-guardian` | Yes | See PR |
