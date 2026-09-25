# ACA Job entrypoints

- `diesel.ts` — weekly GasWatch PH national-average diesel price (customer feedback 3), gated behind `ENABLE_DIESEL_SCRAPE` (on in dev and prod tfvars). Was the RFC-3 `QUOTE-04` DOE scrape.
- `edtr-ocr-worker.ts` — claim/lock/retry loop against the Azure DI port, reconciliation gate (RFC-2, `RFC2-02`). **Landed**, runs against the stub `DocumentIntelligencePort` until a real Azure DI adapter lands.
- `weather-poll.ts` — Open-Meteo poll per active site, severity evaluation, liability-incident logging (PRD-F5). **Landed**, gated behind `ENABLE_WEATHER_POLL`; runs the real `OpenMeteoAdapter` (`@arkilaunch/weather`, free tier, keyless -- `docs/cr-arkilaunch-open-meteo-free-tier.md`) once the flag is on, with a `WEATHER_POLL_MAX_SITES` ceiling that aborts the cycle rather than exceeding the free tier's daily call cap.
- `maintenance-notify.ts` — preventive-maintenance threshold notifications (PRD-F4). **Landed**; notifies only, no state change (recording a maintenance log is the only path that advances the threshold).
