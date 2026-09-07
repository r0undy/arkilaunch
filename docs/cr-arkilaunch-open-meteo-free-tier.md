# Change Record

**Title:** Real Open-Meteo weather adapter lands against the FREE tier, not the commercial plan the PRD names
**Project:** ArkiLaunch
**Date:** 2026-08-20
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (brownfield change workflow); user request to make PRD-F5 production-ready against the free Open-Meteo tier
**Docs touched by this record:** [prd-arkilaunch.md](prd-arkilaunch.md) §8, [sdd-arkilaunch.md](sdd-arkilaunch.md) §2/§4/§5/§6/§7, [qad-arkilaunch.md](qad-arkilaunch.md) §2/§4, [scrutiny-arkilaunch.md](scrutiny-arkilaunch.md) §1/§3, [ues-arkilaunch.md](ues-arkilaunch.md), [ops-arkilaunch.md](ops-arkilaunch.md) §2/§3/§4, [clr-arkilaunch.md](clr-arkilaunch.md) §1/§2, [build-arkilaunch.md](build-arkilaunch.md) §3, [index.md](index.md) §2

---

## 1. Why this pass exists

PRD-F5 (Weather-Aware Module) was built end-to-end except the one piece that actually talks to
Open-Meteo: the port contract, severity engine, poller/cron, `weather_alerts` schema + RLS, read
routes, and web UI (`WeatherBanner`, incident log, dashboard) were all landed, but no HTTP client
existed. `runWeatherPoll()` defaulted to `UnavailableWeatherAdapter`, which throws by design, so
every poll cycle in every environment logged `external_dependency_degraded` and wrote nothing. The
feature was dark everywhere.

This pass lands the real `OpenMeteoAdapter` and turns the module on in dev — against the **free**
Open-Meteo tier, not the commercial plan the PRD specifies.

## 2. The licensing divergence (the reason this CR is mandatory)

The Locked PRD is explicit:

> Open-Meteo (PRD-F5). Requires the **commercial plan**; the free tier is non-commercial only, and
> ArkiLaunch is commercial (scrutiny FC-7 / G-4). Fallback is a cached last-known reading.
> — `docs/prd-arkilaunch.md:378`

The same requirement is restated in the Locked SDD in at least seven places, including the
architecture diagram itself:

- `sdd-arkilaunch.md:59` — Mermaid node `OM["Open-Meteo<br/>(commercial plan)"]`
- `sdd-arkilaunch.md:783` — "Commercial plan required (free tier is non-commercial; FC-7)."
- `sdd-arkilaunch.md:826` — "**Open-Meteo commercial plan** (the free tier is non-commercial, up
  to 10k/day, CC BY 4.0; ArkiLaunch is commercial, FC-7). Quota and cost alerting live in OPS."
- `sdd-arkilaunch.md:804` — "Open-Meteo key … live in env only" (no key exists now)
- `sdd-arkilaunch.md:818` — "Open-Meteo run against sandbox/test keys" (no such thing on the free tier)
- `sdd-arkilaunch.md:86`, `:865`, `:948` — infra/compatibility/checklist rows naming the commercial plan

**This CR does not overturn that finding — it accepts the exposure for the pilot, deliberately and
in writing, rather than silently coding around it.** Removing `OPEN_METEO_API_KEY` does not remove
the underlying restriction: Open-Meteo's free tier is licensed for **non-commercial use only**
(verified against open-meteo.com/en/pricing, 2026-08-20: 600 calls/min, 5,000/hour, 10,000/day,
keyless, data CC BY 4.0), and ArkiLaunch remains a commercial SaaS. Dropping the API key converts a
**cost** finding (SCRUTINY FC-7 — "Open-Meteo is free for this system's use" — was "Contradicted as
stated" because a paid plan was assumed necessary) into an open **licence-compliance** finding that
is not resolved by anything in this change. `SCRUTINY G-4` ("Open-Meteo commercial plan + quota/cost
+ fallback behavior — TBD") is therefore **narrowed, not closed**: cost is resolved at PHP 0, quota
is resolved as the free tier's 10,000-calls/day cap (§5 below), and the commercial-use question
becomes the sole open item under G-4, carried forward as a launch gate for any tenant operating
ArkiLaunch commercially at scale. The two remedies — buy the commercial plan, or self-host the
open-source Open-Meteo API (both switch-only; `OpenMeteoAdapter` takes no vendor-specific
credential shape that would need to change) — are named here for whoever picks this back up.

CC BY 4.0 attribution is a separate, narrower obligation and this pass **does** discharge it: it
covers the *data*, not the *use*. See §7.

## 3. What shipped

**New package `packages/weather` (`@arkilaunch/weather`)** — mirrors
`packages/document-intelligence`'s structure (native `fetch`, no vendor SDK, per AGENTS.md §5).

- `src/open-meteo-adapter.ts` — `OpenMeteoAdapter implements WeatherPort`. Calls
  `https://api.open-meteo.com/v1/forecast` keyless with
  `current=temperature_2m,wind_speed_10m,precipitation,weather_code`, explicit
  `temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm` (redundant against today's
  defaults on purpose — see below), and `timezone=Asia/Manila` (PRD-NFR7). A 10s
  `AbortSignal.timeout` bounds each call so one hung site cannot stall a ~200-site cycle.
- **The safety-critical part:** the response is validated through a Zod schema requiring every one
  of the four `current` fields as a number, plus a **literal check on `current_units`** for
  `temperature_2m`/`wind_speed_10m`/`precipitation`. A missing or malformed field throws
  `WeatherObservationError` — it never falls through as `undefined → NaN` or a plausible-looking
  wrong number. This is the same class of bug `cr-arkilaunch-pilot-honesty.md` removed from the old
  all-zero `StubWeatherAdapter`: an all-zero (or wrongly-scaled-to-calm) `WeatherObservation`
  evaluates to severity `'none'`, which `severityMessage()` renders as "No weather advisory in
  effect" — a fabricated all-clear for a construction site. The unit-literal check specifically
  guards against Open-Meteo ever changing `wind_speed_10m`'s default unit: a real 60 kph gale
  arriving mislabeled as `16.7` (m/s) would silently compare false against every wind threshold.
- `WeatherObservationError` (new, distinct from the shared `WeatherUnavailableError`) — "the
  service answered but the answer cannot be trusted," mirroring `DocumentAnalysisError` in
  `azure-adapter.ts`. Carries a `kind: 'http_error' | 'rate_limited' | 'malformed_response' |
  'timeout'` discriminator and, where applicable, the HTTP `status`.
- **No retry inside the adapter.** `jobs/src/weather-poll.ts` already catches per-site, leaves the
  last-known reading in place, and the next 30-minute cycle is the retry (`WEATHER_STALE_AFTER_MINUTES`
  is a deliberate two-cycle grace window — one missed poll is already designed to be invisible). An
  in-adapter retry would spend twice against the 10k/day cap during exactly the failure — rate
  limiting — where retrying makes it worse (AGENTS.md §5 restraint ladder). **Consequence:**
  `qad-arkilaunch.md:100` QAD-T17's wording — "Serves cached last-known Luzon reading marked
  `is_stale=true`; **retries and alerts**; does not drop the cycle silently" — is restated: the
  30-minute cycle is the retry; the adapter itself does not retry within a cycle. The existing
  `jobs/src/weather-poll.spec.ts` QAD-T17 test already only asserted the alert + last-known-reading
  behavior, so no test contradicted this before or after.
- `src/index.ts` exports `createWeatherAdapter(env = process.env): WeatherPort` — the factory
  `eslint.config.js:33` already promised ("Production code must resolve an adapter through
  createDocumentIntelligenceAdapter() / **createWeatherAdapter()**, which fail closed") but which
  did not exist until now. Returns `UnavailableWeatherAdapter('flag_disabled')` when
  `ENABLE_WEATHER_POLL !== 'true'`, otherwise a real `OpenMeteoAdapter`. Lives in `packages/weather`,
  not `apps/api/src/ports/` — unlike Document Intelligence, no `apps/api` code binds a `WeatherPort`
  (the API only reads persisted `weather_alerts` rows), so the one consumer (`jobs/`) gets the one
  definition with no cross-package duplication.
- **Deliberately no `weatherAvailability()` helper.** `documentIntelligenceAvailability()` earns its
  place because it probes two secrets that may or may not be populated. The free tier has no
  credential to probe — the only input left is `ENABLE_WEATHER_POLL`, which is already read in two
  better-suited places (`runWeatherPoll`'s own gate, and the factory). A third reading of one
  boolean behind a discriminated-union wrapper would be ceremony with a real cost: a third place
  that boolean can silently drift out of sync with the other two (AGENTS.md §5 rung 1 — "does it
  need to exist?"). Recorded here so nobody re-adds it without a second real branch to distinguish.
- `packages/shared/src/weather-port.ts` — `UnavailableWeatherAdapter`'s default reason changed from
  `'no_credentials'` to `'no_adapter'`: with a keyless API, "no credentials" can never be the true
  story in production, and a default that names an impossible cause is exactly the kind of thing
  this file's own history (the all-zero-stub removal) is about. `WeatherUnavailableReason` is
  otherwise unchanged (`'no_credentials'` stays for union symmetry with
  `ExtractionUnavailableReason`, unreachable now, not removed — removing it would churn three files
  for zero behavior change). The file's header comment, which previously read "Open-Meteo commercial
  plan (PRD-F5; the free tier is non-commercial per CLR, so it must not be used in production)" —
  i.e., instructed the next reader to do the opposite of what the code now does — is rewritten to
  point at this CR.
- `packages/shared/src/weather.ts` — new derived constants:
  ```ts
  export const OPEN_METEO_FREE_DAILY_CALL_CAP = 10_000;
  export const MAX_POLLED_SITES_PER_CYCLE = Math.floor(
    OPEN_METEO_FREE_DAILY_CALL_CAP / (24 * 60 / WEATHER_POLL_CADENCE_MINUTES),
  ); // 208
  ```
  Derived from the cadence rather than a bare `200`, so a future cadence change carries the ceiling
  with it.

**`jobs/src/weather-poll.ts`** — default port changed from `new UnavailableWeatherAdapter('no_adapter')`
to `createWeatherAdapter()`; the `ENABLE_WEATHER_POLL` gate and the per-site `try/catch` are
untouched. New quota-ceiling check immediately after the `activeSites` query and before any HTTP
call: if `activeSites.length` exceeds `WEATHER_POLL_MAX_SITES` (env override, defaulting to
`MAX_POLLED_SITES_PER_CYCLE`), **the whole cycle is skipped**, one
`external_dependency_degraded{dependency:'open_meteo', mode:'quota_ceiling'}` event is logged per
affected tenant, and the function returns. Aborting entirely rather than polling the first N sites
is deliberate: a partial cycle leaves an arbitrary, row-order-dependent subset of sites fresh and
the rest silently stale, indistinguishable at the UI from a per-site outage; aborting makes every
site age toward `is_stale` uniformly (already surfaced honestly by the existing staleness check) and
produces one loud, explicable signal — and it avoids the far worse outcome of tripping Open-Meteo's
rate limiter mid-cycle and losing every site's weather at once. This closes a real gap in
`qad-arkilaunch.md:121` QAD-T31 ("Resource abuse / cost bomb"), whose expected-result text names
OCR/quote/checkout but not the weather poll despite `qad-arkilaunch.md:144` mapping T31 to PRD-F5.
The event reuses alert **A1** (`external_dependency_degraded`) in `ops-arkilaunch.md`; no new alert
was added.

**CC BY 4.0 attribution** — `apps/web/src/components/weather-banner.tsx` now renders "Weather data
by Open-Meteo.com (CC BY 4.0)" linking to `https://open-meteo.com/`, unconditionally (not gated on
`coordinates` or on a reading existing), alongside the existing windy.com "View live map" link. This
is the only surface that displays Open-Meteo-derived values, so one edit discharges the whole
attribution obligation; if a future change renders observed conditions elsewhere, the obligation
follows.

**Removed dead `OPEN_METEO_API_KEY` plumbing** (the free tier is keyless): `.env.example`, `.env`,
`infra/terraform/environments/{dev,prod}/main.tf` (`open-meteo-api-key` secret +
`OPEN_METEO_API_KEY` env mapping), `{dev,prod}/variables.tf` (`variable "open_meteo_api_key"`).
Because the Terraform variable defaulted to `""` and `local.secrets` already filters `v != ""`,
**the secret was never actually created in Azure** — this removal is a no-op against live
infrastructure, not a destructive change. Also removed: the `open_meteo_api_key` placeholder line
in both environments' `secrets.auto.tfvars.example`, and the `TF_VAR_open_meteo_api_key` line in
both jobs of `.github/workflows/deploy.yml`. The now-orphaned `OPEN_METEO_API_KEY` GitHub repo
secret (if one was ever set) should be deleted by hand — Terraform and this CR cannot reach it.

**Added `WEATHER_POLL_MAX_SITES`** to `.env.example`, `.env`, and both Terraform environments'
`common_env_vars` (backed by a new `variable "weather_poll_max_sites"`, default `200`), so the
ceiling is operator-tunable without a code deploy ahead of a commercial-plan or self-hosted upgrade.

**Dev flag flip:** `infra/terraform/environments/dev/terraform.tfvars`'s `enable_weather_poll`
changed `false → true`. **`prod/terraform.tfvars` is untouched (`false`)** — an operator turns it on
deliberately after checking active-site count against the ~208-site ceiling. Note the variable
*default* in `dev/variables.tf` stays `false`; `terraform.tfvars` is the actual operator switch that
overrides it, so flipping only the default would have had no effect.

**Docs:** `jobs/src/README.md:5` (its own weather-poll TODO marker) and
`docs/runbook-local-dev.md` (dropped `OPEN_METEO_API_KEY` from the "leave blank" list; fixed the
flag list, which had drifted to reference a nonexistent `ENABLE_QUOTE_ENGINE` and omit
`ENABLE_WEATHER_POLL`) updated to describe what actually ships.

**CI:** `.github/workflows/ci.yml`'s `node-unit-tests` job previously ran only
`pnpm --filter @arkilaunch/shared test` — `packages/document-intelligence`'s suite (the Azure DI
adapter, landed 2026-08-15) had run in **no CI job at all** since it was written. Both
`@arkilaunch/document-intelligence` and the new `@arkilaunch/weather` are added to that job.

**Tests:** new `packages/weather/src/open-meteo-adapter.spec.ts` (10 cases: URL/param construction
including the keyless assertion, field mapping, a missing field throws, a non-numeric field throws,
a unit-mismatch throws, non-2xx throws with `kind:'http_error'`, 429 throws with
`kind:'rate_limited'`, timeout throws with `kind:'timeout'`, non-JSON body throws, no retry after a
failure). `packages/shared/src/weather-port.spec.ts` gained a case for the new default reason.
`jobs/src/weather-poll.spec.ts` gained a case that the real default port resolves safely with the
flag off (no network call), and a case for the quota-ceiling abort using the `WEATHER_POLL_MAX_SITES`
override. `apps/web/src/components/weather-banner.test.tsx` gained two cases for the attribution
link (renders with and without `coordinates`).

## 4. Doc drift recorded, not fixed, by this CR

The following were found while implementing and are logged as open items for the next SDD/QAD/OPS/
UES reconciliation pass, per `build-arkilaunch.md` §5.1's "flag and do not guess":

- **SDD §4** is already known-stale on `POST /internal/jobs/weather-poll` (the real shape is a
  direct ACA Job entrypoint, per `cr-arkilaunch-f4-f5-fleet-weather.md`); this CR does not fix that.
- **SDD §3**'s `weather_alerts` spec still does not mention its dual role as the reading cache
  (every cycle writes a row, calm or not) — only `cr-arkilaunch-f4-f5-fleet-weather.md` records it.
- No documented severity thresholds exist outside code (`packages/shared/src/weather.ts`'s
  `DEFAULT_WEATHER_THRESHOLDS`) — any future threshold change has no Locked doc to drift from.
- `weather_alerts` has no retention policy at 48 rows/site/day (`clr-arkilaunch.md` lists it "Long-
  lived (evidence value)" with no bound stated).

## 5. Restated quota/cost figures (supersedes the commercial-plan figures below until reversed)

| Doc | Old (commercial plan) | New (free tier) |
|---|---|---|
| `ues-arkilaunch.md:141` UES-F4 | "~2,030 [PHP/mo] … ~USD 35 flat" | **PHP 0** — free tier, keyless. The non-commercial caveat is retained as the reason this line may return. |
| `ops-arkilaunch.md:52` SLO-12 | "Open-Meteo commercial quota" / "commercial dashboard usage" | **10,000 calls/day** (`OPEN_METEO_FREE_DAILY_CALL_CAP`), measured from the poller's own `active_sites × 48`/day — there is no commercial dashboard to read. |
| `ops-arkilaunch.md:115` alert A7 | "Open-Meteo commercial quota crosses 80% then 100% of plan" | 80%/100% of the 10k/day cap, i.e. active sites crossing ~166 then 208 — exactly what the new `mode:'quota_ceiling'` event (riding existing alert A1) reports. |
| `build-arkilaunch.md` §3 / `AGENTS.md` §3 pinned-stack row | "Open-Meteo (commercial plan)" | "Open-Meteo (free tier, keyless)" |
| `build-arkilaunch.md` §3 / `AGENTS.md` §3 divergence row | "Open-Meteo free tier for production → Open-Meteo commercial plan" | **Inverted**: chosen = free tier, keyless; why = pilot scale fits inside 10k/day at ≤208 sites; CC BY 4.0 attribution shipped in the UI; the non-commercial-use restriction is carried forward as the open item under G-4 (§2 above), not resolved. |

`index.md:119` previously recorded a prior audit finding that an Open-Meteo double-count
"understated the illustrative breakeven by ~PHP 220/mo" — this line's arithmetic has bitten before,
so the UES-F4 change to PHP 0 should be applied carefully in the next UES reconciliation pass rather
than mechanically zeroed.

## 6. Verification

```
pnpm install
pnpm lint && pnpm typecheck && pnpm build
pnpm --filter @arkilaunch/weather test
pnpm --filter @arkilaunch/shared test
pnpm --filter @arkilaunch/web test
pnpm --filter @arkilaunch/jobs test          # needs a migrated + seeded DB
```

End-to-end: seed the anchor tenant (creates a Quezon City site at 14.676/121.0437 with an active
rental), run `ENABLE_WEATHER_POLL=true pnpm --filter @arkilaunch/jobs worker:weather`, confirm the
newest `weather_alerts` row has a plausible non-zero Manila reading (not
`{tempC:0,windKph:0,precipMm:0,code:0}` — that exact shape means the Zod guard failed), then load
`GET /api/v1/sites/:id/weather` and the `app.index` dashboard and confirm the banner renders a real
condition with the Open-Meteo attribution link visible.

Negative checks exercised: `WEATHER_POLL_MAX_SITES=0` aborts the cycle and emits `quota_ceiling`;
unsetting `ENABLE_WEATHER_POLL` makes zero outbound calls; a failing/unreachable adapter leaves the
last-known reading in place and emits `external_dependency_degraded{dependency:'open_meteo'}`.

## 7. CC BY 4.0 compliance status

**Discharged by this pass:** visible attribution in the UI (§3), satisfying CC BY 4.0's "give
appropriate credit" requirement for the *data*.

**Not discharged, carried as an open item:** the free tier's non-commercial-use restriction on the
*API access itself* (§2). No sub-processor DPA exists yet with Open-Meteo regardless of tier —
`clr-arkilaunch.md` gap E3 already carries that and is unchanged by this pass.
