# ACA Job entrypoints

- `diesel.ts` — DOE price scrape, gated behind `ENABLE_DIESEL_SCRAPE` (RFC-3, `QUOTE-04`). **Landed**, flag off by default (CLR legal-review note pending).
- `edtr-ocr-worker.ts` — claim/lock/retry loop against the Azure DI port, reconciliation gate (RFC-2, `RFC2-02`). **Landed**, runs against the stub `DocumentIntelligencePort` until a real Azure DI adapter lands.
- `weather.ts` — Open-Meteo poll (PRD-F5). Not yet built.
- `pm-notify.ts` — preventive-maintenance notifications (PRD-F4). Not yet built.
