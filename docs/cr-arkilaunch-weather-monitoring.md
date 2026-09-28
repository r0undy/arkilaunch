# Change Record

**Title:** Weather monitoring and EDTR weather verification for sites with deployed equipment
**Project:** ArkiLaunch
**Date:** 2026-09-28
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (brownfield change workflow); owner request 2026-09-28
**Docs touched by this record:** [index.md](index.md) §2; extends [cr-arkilaunch-open-meteo-free-tier.md](cr-arkilaunch-open-meteo-free-tier.md) (call budget) and [proposal-edtr-weather-attestation.md](proposal-edtr-weather-attestation.md) (D1/D2 now also on digital entries)

---

## 1. What the owner asked for

- Check the weather **before the workday** for every site that has deployed equipment, and judge whether each machine can keep working.
- Re-check **hourly** while rain or other bad weather is expected.
- **Notify the site's personnel**, especially the timekeeper, so they can brief the crew. On review the owner added that the **customer** must get the same notices.
- **Compare the EDTR with the recorded weather** for that site and day: whether it rained, how hard, whether it kept raining, and whether the machine was still used. Flag inconsistencies for review and put them in the incident log.
- Only for **sites with active deployed equipment**.
- Monitoring and verification only. The system never decides on its own that an incident happened.
- **Tell the customer beforehand** that this is part of the service.
- **Free channels only.** No Firebase or GCP (the owner ruled these out explicitly), and no SMS, because there is no free SMS option.

## 2. What was already there (reused, not rebuilt)

- **Weather source:** Open-Meteo on the free tier (`packages/weather`).
- **Polling:** `jobs/src/weather-poll.ts`, every 30 minutes, which writes a `weather_alerts` row for every reading.
- **Per-machine levels:** the equipment classes, PAGASA-style levels and `evaluateSiteEquipment()` in `packages/shared/src/equipment-weather.ts` and `packages/db/src/equipment-weather.ts`.
- **Live Caution/Stop-work warnings:** `warnOnEquipmentEscalation()`.
- **Used-despite-warning incidents:** `flagUsedDespiteWarning()`.
- **EDTR-vs-weather rules:** `compareReportedWeather()` (D1/D2). Until now only the paper OCR worker ran them.
- **Incident log:** `SitesService.incidents()` (S14).

## 3. Changes

| Area | Change |
|---|---|
| Scope | The poll now selects sites by a **delivered** (`equipment_assignments.status='active'`) machine, the same definition as `machinesOnSite()`. Previously any active rental counted. `sitesWithDeployedEquipment()` in `jobs/src/weather-briefing.ts`. |
| Forecast | `HourlyForecastPort.getHourlyForecast()` is a separate interface for the same reason `WeatherForecastPort` is. The Open-Meteo hourly block uses the same fields and pinned units as the live reading, and a short or ragged block throws. |
| Pre-workday briefing | New ACA job `weather-briefing`, 05:30 Asia/Manila (`30 21 * * *` UTC). It judges each forecast hour from 07:00 to 17:00 per machine with the live rules. Each machine gets its worst level, the reasons, and the hours at Caution or worse. The briefing is sent only when a machine is at Caution or worse. An `equipment_weather_briefing` event is logged every morning, calm or not, and that event is the record that the site was checked. |
| Hourly watch | Runs in the first poll of each hour between 06:00 and 17:00. It covers **only sites on watch**, meaning today's briefing or a later outlook said Caution or worse. It re-forecasts the next 3 hours and sends `equipment_weather_outlook` only when the message would change. Calm sites spend no extra quota. |
| Recipients | `notifySiteWeather()` / `siteRecipients()` in `packages/db/src/weather-notify.ts` reach the site's timekeepers, the customer renting each affected machine (who sees only their own machines), and active admins. Everyone gets the same text from `weatherNoticeText()`, and each role gets its own link. The live warning now also reaches timekeepers and goes by email and push. |
| Channels | The in-app row is always written, because it is the proof the warning went out. Email goes through Resend and respects `notification_prefs.email`. **Web Push** follows the W3C Push API with our own VAPID keys and the `web-push` library (MIT). There is no Firebase SDK and no GCP project or account. The browser supplies its own push endpoint and we store only that URL and its keys. A 404 or 410 deletes the subscription. With no VAPID keys set, push is logged and skipped. |
| Push subscriptions | Migration `0066_push_subscriptions` adds a table with full RFC-1 isolation (tenant_id, FORCE RLS, tenant_isolation policy, grants, index), unique per tenant and endpoint. The API adds `GET /notifications/push/public-key`, `POST /notifications/push-subscriptions` and `POST /notifications/push-subscriptions/remove`, with tenant and user taken from the JWT. The web gets `public/sw.js` and a "Weather alerts on this device" toggle on every notifications screen; on iPhone, push needs the site added to the Home Screen. |
| EDTR verification | `logWeatherDiscrepancies()` is now shared by the OCR worker and `EdtrService.capture()`. **Digital entries are now checked too.** A discrepancy adds `weather_D1`/`weather_D2` to `review_flags` and logs `edtr_weather_discrepancy`, once per EDTR, rule and half-day. The event carries every half-hourly reading (rain, wind, code), so the reviewer can see whether it kept raining. A digital entry is **not** held and money is not touched (RFC-2). The OCR path keeps its existing review hold. |
| Incident log | Each discrepancy row now states the recorded evidence (millimetres of rain, peak wind, rain in N of M readings) and ends "For review, not a finding." |
| Customer notice | `/terms#weather-monitoring` publishes the policy. Checkout links to it before payment, and the customer's weather panel says monitoring is on. |
| Class map | **Bug fix:** the catalog renames (Mobile Crane, Crawler Crane, Boom Lift (Manlift), Generator Set, …) had stopped matching `EQUIPMENT_TYPE_CLASS`, so every crane fell back to `general` and missed the gust rules. The current names are now mapped. |
| Infra | `weather_briefing_job` (reuses the `cron_job` module), `weather_briefing_cron`, `vapid_public_key`, `vapid_subject`, and `vapid_private_key` (sensitive, ACA secret) in dev and prod. `.env.example` gains the `VAPID_*` keys. |

## 3a. Equipment weather-risk categories (Philippine site conditions)

Each catalog type maps to one risk class (`EQUIPMENT_TYPE_CLASS`). Each class has its own thresholds, based on:
- PAGASA's rainfall colours: Yellow 7.5–15 mm/h, Orange 15–30, Red above 30;
- PAGASA's Tropical Cyclone Wind Signals (TCWS);
- thunderstorms;
- gusts;
- the PAGASA heat index, which applies to every operator.

| Class | Catalog types | Why it is at risk | Stop work at | Caution at |
|---|---|---|---|---|
| Lifting | Mobile Crane, Crawler Crane, Boom Truck | Wind on the boom and the load; lightning hits tall booms first | Gust ≥ 50 km/h, any TCWS, thunderstorm, Red rain | Gust ≥ 38, Orange rain |
| Aerial work | Boom Lift (Manlift) | People on a platform at height | Gust ≥ 45 km/h, any TCWS, thunderstorm, Orange rain | Gust ≥ 30, Yellow rain |
| Concrete pumping | Concrete Pump | Wind on the placing boom, and heavy rain ruins the pour | Gust ≥ 50, any TCWS, thunderstorm, Orange rain | Gust ≥ 38, Yellow rain |
| Material handling | Forklift | Raised loads sway, and wet ramps tip it over | Gust ≥ 50, any TCWS, Red rain | Gust ≥ 40, thunderstorm, Orange rain |
| Earthmoving | Excavator, Mini Excavator, Backhoe Loader, Bulldozer, Wheel Loader (Payloader), Skid Steer Loader, Motor Grader | Soft ground, trench collapse, landslides and flooding | Red rain, TCWS 2 | Orange rain, TCWS 1, thunderstorm, gust ≥ 62 |
| Hauling | Dump Truck, Transit Mixer, Water Truck, Self-Loading Truck (moves equipment between sites by road) | Flooded roads, visibility, slippery haul roads | Red rain, TCWS 2 | Orange rain, TCWS 1, gust ≥ 62 |
| Compaction | Road Roller, Pneumatic Tire Roller, Plate Compactor | Wet soil doesn't compact, and the drum slides | Orange rain, TCWS 2 | Yellow rain, TCWS 1 |
| Paving | Asphalt Paver | Asphalt can't be laid on a wet base | Yellow rain (any steady rain), TCWS 2 | TCWS 1, thunderstorm, gust ≥ 62 |
| Power | Generator Set, Air Compressor | Electrics in flood water, and lightning | TCWS 3 | Red rain, thunderstorm, TCWS 2 |
| General | Others | General site rules | Red rain, TCWS 2 | Orange rain, TCWS 1, thunderstorm, gust ≥ 62 |

For every class, a heat index of 42°C or more is Caution (PAGASA Danger), and 52°C or more is Stop work (PAGASA Extreme Danger).

`packages/shared/src/equipment-weather.spec.ts` tests this against seven Philippine scenarios:
- amihan/habagat gusts of 45 km/h;
- Yellow, Orange and Red rain;
- an afternoon thunderstorm;
- Signal No. 1 and Signal No. 3.

It also asserts two things:
- every catalog type except "Others" has a real class;
- **no two classes react the same way across the scenarios**. This check caught crane and concrete pump, and trucks and rollers, sharing a profile. The pump and the rollers now stop at Orange rain.

## 4. Open items (recorded, not resolved)

- **Open-Meteo call budget.** Per site per day, the budget is 48 poll calls, plus 1 briefing call, plus up to 11 watch calls. The watch calls happen only on bad days. The `WEATHER_POLL_MAX_SITES=200` ceiling was sized for the poll alone. On a day when every site is on watch, 200 sites would make about 12,000 calls, more than the free tier's 10,000/day. Revisit the ceiling, or move to the commercial plan (G-4's non-commercial item is still open).
- **VAPID keys** must be generated (`npx web-push generate-vapid-keys`) and set per environment before push works. Until then, in-app and email still go out.
- **Terms of service** remain a draft. Only the weather section is published.

## 5. Verification

- **Unit tests:**
  - `packages/weather`: hourly parsing, pinned units, short block.
  - `packages/shared`: `weather-notify.spec.ts` for text, links and email; `equipment-weather.spec.ts` for the catalog names.
  - `apps/web`: `notification-feed.test.ts`, covering every weather type in each console.
- **Integration tests** against the test DB:
  - `jobs/src/weather-briefing.spec.ts`: the timekeeper and customer are briefed; the watch stays quiet while unchanged and re-sends on a change; a calm briefing is logged but not sent.
  - `jobs/src/weather-poll.spec.ts`: an undelivered site is not polled.
  - `apps/api/test/edtr-weather-verification.spec.ts`: D1 and D2 are flagged and logged on digital entries without a hold; a matching entry is not flagged.
