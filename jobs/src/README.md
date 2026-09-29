# ACA Job entrypoints

- `diesel.ts` — weekly GasWatch PH national-average diesel price, gated behind `ENABLE_DIESEL_SCRAPE`.
- `edtr-ocr-worker.ts` — claim/lock/retry loop against the Azure DI port plus the RFC-2 reconciliation gate, behind `ENABLE_OCR_PIPELINE`.
- `weather-poll.ts` — Open-Meteo poll per active site, severity evaluation, liability-incident logging, behind `ENABLE_WEATHER_POLL`; `WEATHER_POLL_MAX_SITES` aborts the cycle rather than exceed the free tier's daily cap.
- `weather-briefing.ts` — pre-workday briefing (05:30 Manila) for every site with deployed equipment, plus the hourly watch `weather-poll` runs for sites on watch. Behind `ENABLE_WEATHER_POLL`.
- `maintenance-notify.ts` — preventive-maintenance threshold notifications; notifies only, no state change.
- `hold-expiry.ts` — hourly (`hold_expiry_cron`, :05). Cancels unpaid `pending` requests whose date hold lapsed, voids their unpaid invoices, notifies (`hold_expired`). Skips any request with an online payment still pending.
- `weekly-billing.ts` — weekly (`weekly_billing_cron`). Issues invoices for unbilled `deposit_accruals` rows (usage past a spent deposit).
- `ocr-fixtures-pull.ts` — CLI, not a cron: stages labeled EDTR/KYC scans for the OCR evals (`pnpm ocr:fixtures:pull`, `docs/runbook-ocr-fixtures.md`).
