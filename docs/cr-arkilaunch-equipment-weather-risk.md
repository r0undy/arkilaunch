# Change Record

**Title:** Weather risk is judged per equipment type (PAGASA-style levels), and anchors the incident log
**Project:** ArkiLaunch
**Date:** 2026-09-26
**Version:** 0.1
**Status:** `Proposed`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1; product request to make weather warnings equipment-aware for both customer and admin
**Docs touched by this record:** [prd-arkilaunch.md](prd-arkilaunch.md) PRD-F5, [sdd-arkilaunch.md](sdd-arkilaunch.md) §4 (on apply)

---

## 1. Problem

PRD-F5 judges a **site** with one rule (`DEFAULT_WEATHER_THRESHOLDS`: wind 40/60 kph, rain 15/30 mm).
That rule ignores which machines are on the site. A crane has to stop in 35 kph wind, but an excavator
can keep working in it. With one rule for everything we either warn too often, so people stop reading
the warnings, or too late for tall machines. The rule also can't support the incident log, which needs to
say *"this unit was told to stop and kept working"*.

## 2. Decisions (confirmed with the product owner 2026-09-26)

| Question | Decision |
|---|---|
| Who owns thresholds | **Global defaults + admin override.** Admins can only make a profile *stricter*; a looser value is ignored. |
| Levels | **PAGASA-style 4 levels**: Normal "Safe to work" / Yellow "Use with caution" / Orange "Limit use" / Red "Stop using". |
| Hazards | **Wind (incl. gusts), rain intensity, thunderstorm/lightning, heat index.** Messages must be plain language on both ends. |
| Detecting use despite warning | **EDTR hours on a warning day.** A unit that reports active hours on a day it was Orange/Red gets flagged. |

## 3. Design

Six **risk classes**. Each equipment type is assigned to one by its name (`classifyEquipmentType`); a
type that matches no class falls back to `general`.

| Class | Wind Y/O/R (kph) | Rain Y/O/R (mm/hr) | Lightning | Source |
|---|---|---|---|---|
| Cranes & lifting | 25 / 35 / 45 | 7.5 / 15 / 30 | Red | Crane OEM lift limit ≈ 10 m/s |
| Boom & scissor lifts | 25 / 35 / 45 | 7.5 / 15 / 30 | Red | EN 280 / ANSI A92: 12.5 m/s |
| Earthmoving | 40 / 62 / 89 | 7.5 / 15 / 30 | Orange | PAGASA TCWS 2/3 wind, PAGASA rainfall |
| Compaction & paving | 40 / 62 / 89 | 2.5 / 7.5 / 15 | Orange | Paving and rolling are ruined by rain |
| Trucks & haulers | 40 / 62 / 89 | 7.5 / 15 / 30 | Orange | |
| Other equipment | 40 / 62 / 89 | 7.5 / 15 / 30 | Orange | |

Heat index (all classes): 33 / 42 / 52 °C, from PAGASA's caution / danger / extreme danger classes.

Each evaluation returns:
- **customerMessage**: one short instruction per hazard, with no numbers ("Wind is too strong. Stop and
  lower the machine now.").
- **adminSummary**: the class, the level and the measured values ("Cranes & lifting: Stop using, Wind
  50 kph (red), Rain 8 mm/hr (yellow)"). When no humidity reading was available, the summary says the
  heat check ran without it.

**Incident anchor:** `findWeatherBreaches(warnings, edtrDays)`. This works per day, because EDTR records
hours per day, not clock times. The incident text must therefore say "worked on a Red day", not
"worked during the Red hour".

## 4. This PR vs follow-ups

Landed here: the pure engine `packages/shared/src/equipment-weather-risk.ts` and its tests. Nothing
calls it yet, and the existing site-level `evaluateSeverity` is unchanged.

Follow-ups, each gated on this CR being Accepted:
1. Adapter: request `wind_gusts_10m` and `relative_humidity_2m` from Open-Meteo (free tier, no extra cost).
2. Migration: `equipment_types.risk_class`, backfilled with `classifyEquipmentType`, and
   `weather_risk_overrides` (tenant_id + full RLS) for admin overrides.
3. Poller: evaluate every deployed unit on each site and store the per-unit level.
4. Job: run `findWeatherBreaches` when an EDTR is approved, and append the incident `events` row.
5. UI: customer site banner with per-machine cards (colour + one instruction). Admin incident log with
   class, values, and the breach flag.
