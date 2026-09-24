# Proposal: EDTR v2, with timekeeper weather reports checked against system weather

**Status:** Draft proposal. Not locked; nothing here is built yet.
**Affects:** PRD-F3 (EDTR OCR), PRD-F5 (Weather-Aware Module), S14 Liability Incident Log.
**Before building:** needs a Change Record against the locked PRD/SDD (CLAUDE.md: "a Locked-doc change requires a Change Record").

---

## 1. Problems with the current form (ALMARA Equipment Daily Time Report)

| # | Problem | Why it costs us |
|---|---------|-----------------|
| 1 | Header (Charge To, Eqpt. Type, Project Location, Date Covered) is handwritten | These are already in our system. Rewriting them is slow, and OCR can misread them and link the sheet to the wrong rental. |
| 2 | Times are free-hand (`7:30`, `730`, `7.30`, `1:00` = 13:00?) | Hardest thing to OCR. Also makes AM/PM mistakes more likely, which pushes confidence below `CONFIDENCE_GATE` (0.9) and sends the sheet to manual review. |
| 3 | No record of **why** a row is short | A 4-hour day could be rain, a breakdown, or the operator leaving early. Each means something different for billing and for the deposit, but the sheet doesn't say which. |
| 4 | No weather field at all | We can't tell a genuine weather stoppage from an excuse. This is also the main gap in the liability log. |
| 5 | "Total Hours" is hand-summed per row and again at the bottom | Adding up by hand causes mistakes. The system already recomputes totals, so the handwritten total is only a cross-check (keep it as that). |
| 6 | Signature per row but no name/role | We can't tell who attested each day. |

## 2. Proposed form changes

Principle: **tick boxes over handwriting.** Azure Document Intelligence reads *selection marks* much more reliably than handwritten text, and the timekeeper fills a box faster than writing a word.

### 2.1 Header: pre-printed, not handwritten
- The system prints the sheet per rental/site/week, with **Charge To, Equipment (type + unit/plate no.), Project Location, Date Covered** already filled in.
- Add a **QR code** carrying the `edtr_id` / rental id. The OCR worker reads the QR and never has to guess which rental a sheet belongs to, which removes a whole class of wrong-rental matches.
- A blank generic sheet is still allowed as a fallback (manual transcription path already exists: `MANUAL_TRANSCRIPTION_MODEL_ID`).

### 2.2 Rows: one row per date, date pre-printed
Pre-print the 7 dates of the covered week (one row each) instead of 20 blank rows. Blank rows invite writing in the wrong row.

### 2.3 Time columns: pre-formatted 24h boxes
Print `[ ][ ]:[ ][ ]` boxes with a "24H" header, e.g. `07:30`, `13:00`. One digit per box is much easier to OCR than cursive, and 24h removes the AM/PM ambiguity.

### 2.4 NEW: Weather column (timekeeper's report)
Per row, the timekeeper ticks **one** box per half-day:

| Code | Tick box | Meaning |
|------|----------|---------|
| `C` | ☐ Clear / Sunny | |
| `O` | ☐ Cloudy / Overcast | |
| `LR` | ☐ Light rain | work continued |
| `HR` | ☐ Heavy rain | |
| `W` | ☐ Strong wind | |
| `T` | ☐ Storm / typhoon signal | |

Two tick groups per row (**AM** and **PM**). Weather changes during the day, and one value for the whole day would hide the afternoon downpour that stopped work.

### 2.5 NEW: Stoppage columns
| Column | Type | Notes |
|--------|------|-------|
| **Idle hrs** | 2-digit box | Equipment on site but not working. The system already stores `hoursActive` / `hoursIdle`. |
| **Idle reason** | tick box: ☐ Weather ☐ Breakdown ☐ No operator ☐ Client hold ☐ Other | |

This fixes problem #3: short days now carry a reason, and "Weather" is the reason we can verify independently.

### 2.6 Footer
- Operator: **printed name + signature**
- Timekeeper: **printed name + signature** (the person attesting the weather)
- Certified correct by (client site engineer): **printed name + signature + date**
- Keep the handwritten TOTAL as a cross-check against the system's computed total. It is not the source of truth.

### 2.7 Suggested layout (one row)

```
DATE  | AM IN | AM OUT | PM IN | PM OUT | OT IN | OT OUT | TOTAL | IDLE | IDLE REASON      | WEATHER AM        | WEATHER PM        | SIGN
09/24 | 07:30 | 12:00  | 13:00 | 15:00  |       |        | 6.5   | 2.0  | [x]Wx [ ]Brk ... | [x]C [ ]O [ ]LR.. | [ ]C [ ]O [x]HR.. | ____
```

Landscape A4 fits this. If it gets crowded, drop the per-row signature and keep the footer signatures (one daily initial is enough).

---

## 3. System side: comparing reported vs. fetched weather

### 3.1 What we already have (no new infrastructure)
- `jobs/src/weather-poll.ts` polls Open-Meteo every **30 min** (`WEATHER_POLL_CADENCE_MINUTES`) per active site and stores `WeatherObservation { tempC, windKph, precipMm, code }`.
- `evaluateSeverity()` in `packages/shared/src/weather.ts` classifies a reading as `none | watch | warning` (wind 40/60 kph, precip 15/30 mm).
- The `events` table + `SitesService.incidents()` is the Liability Incident Log (S14). It currently lists `weather_liability_incident` rows.

### 3.2 Build the system's view per half-day
For each EDTR row, take the site's readings inside that half-day's shift window (the AM IN–OUT and PM IN–OUT from the row; fall back to 07:00–12:00 / 13:00–17:00 if blank):

- `maxWindKph`, `totalPrecipMm`, `worstSeverity`, and the dominant WMO `code`.
- Map to the same codes the form uses:

| System says | Maps to |
|-------------|---------|
| WMO 0–1, precip 0 | `C` |
| WMO 2–3, 45–48 | `O` |
| precip > 0 and < `precipMmWatch` | `LR` |
| precip ≥ `precipMmWatch` | `HR` |
| wind ≥ `windKphWatch` | `W` |
| severity `warning` or WMO 95–99 | `T` |

Put this in **one pure function in `packages/shared`** (e.g. `compareReportedWeather(reported, readings)`), next to `evaluateSeverity`, so the worker, API and tests all agree. That follows the same pattern as `evaluateGate()`.

### 3.3 Discrepancy rules

Categories are ordered by "wetness" (`C < O < LR < HR < T`, with `W` checked separately):

| Rule | Condition | Flag | Severity | Why it matters |
|------|-----------|------|----------|----------------|
| **D1 Unverified weather stoppage** | Idle reason = Weather **and** system severity = `none` **and** system precip < `precipMmWatch` | `weather_claim_unverified` | high | Idle hours billed/excused on weather the system didn't see. **Money path.** |
| **D2 Unreported hazard** | System severity = `warning` **and** reported `C`/`O` **and** full active hours | `weather_hazard_unreported` | high | Equipment worked through a storm we recorded. Safety + liability (damage claims, deposit disputes). |
| **D3 Category mismatch** | Reported vs system category differ by **≥ 2 steps** (e.g. `C` vs `HR`) | `weather_report_mismatch` | medium | Carelessness or a local micro-climate. Worth noticing if it happens repeatedly. |
| **D4 No system data** | No readings in the window (poller down / stale per `WEATHER_STALE_AFTER_MINUTES`) | `weather_unverifiable` | low | We can't judge. Do **not** blame the timekeeper. |
| **D5 Missing report** | Timekeeper left weather blank | `weather_report_missing` | low | Needed to make the form habit stick. |

A 1-step difference (`C` vs `O`, `LR` vs `HR`) is **not** flagged. The Open-Meteo grid cell is about 1–10 km wide and a site can get a shower the grid misses. Flag only what's clearly wrong, otherwise supervisors learn to ignore the log.

### 3.4 Where the flag goes
- Emit an `events` row (tenant-scoped, RLS already on the table) named `edtr_weather_discrepancy`, with properties: `edtr_id`, `project_site_id`, `date`, `half` (`am|pm`), `rule` (D1–D5), `reported`, `system` (`code`, `maxWindKph`, `totalPrecipMm`, `severity`), `reading_count`.
- Extend `SitesService.incidents()` to also include `edtr_weather_discrepancy` rows (it currently filters on one event name). Then they show up on the **existing S14 Liability Incident Log** with no new table or screen. Add a filter chip: *Weather incidents / Report discrepancies*.
- Show a badge on the EDTR review screen next to the affected row, so the approver sees it while deciding.

### 3.5 Guardrails (non-negotiable)
- **A discrepancy never changes money automatically.** Per RFC-2 / CLAUDE.md, OCR output can't trigger a deduction without passing reconciliation or human approval. D1/D2 **hold the EDTR in manual review** (same path as a failed confidence gate); a human decides.
- `tenant_id` comes from the verified JWT/context as everywhere else, never from the sheet or QR code.
- Weather tick boxes go through the same confidence gate as the other fields. A low-confidence tick counts as "missing" (D5), not a mismatch.

---

## 4. Suggested rollout

1. **Form v2 only** (print pre-filled sheets with QR + 24h boxes + weather/idle ticks). Gives better OCR accuracy before any comparison logic exists.
2. **Extraction**: map the new selection marks in `edtr-sheet.ts` (it already parses `ExtractedTable`; selection marks come from Azure DI's `selectionMarks`).
3. **Compare + flag**: the pure function + D1/D2 only (the two high-value rules). Emit events and show them in S14.
4. **Add D3–D5** after a few weeks of real data, and tune the 2-step threshold against what timekeepers actually report.

## 5. Open questions for you
1. Should D1 (unverified weather stoppage) **block** billing of those idle hours until approved, or just flag? (Recommendation: hold for review, don't block the whole EDTR.)
2. Who is the "timekeeper": ALMARA's staff or the client's? That decides whose signature attests the weather.
3. Is a weekly sheet (7 pre-printed rows) right, or do rentals run on a different period?
4. Should repeated D3 mismatches by the same timekeeper be reported (a per-timekeeper reliability score)? This is useful, but it's a people-accountability feature and should be a deliberate decision.
