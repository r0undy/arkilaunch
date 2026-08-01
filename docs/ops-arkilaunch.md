# Operations & Observability Runbook (OPS)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with prod)
**SDD:** [sdd-arkilaunch.md](sdd-arkilaunch.md)
**PRD:** [prd-arkilaunch.md](prd-arkilaunch.md)
**Event / context:** FMD engine v1.28.1; Scale Full.

---

> **Note:** The [SDD](sdd-arkilaunch.md) says how ArkiLaunch is built (§6 infrastructure, §7 NFRs); this OPS says how the team keeps it alive once Almara's money moves through it. Rollback is owned by the [PRD §9](prd-arkilaunch.md) as the single source of truth; this doc links to it and never re-defines it. SLIs trace to SDD §7 NFRs and to the frozen `BRD-M#` metrics; alerts and events trace to [PRD §5.6](prd-arkilaunch.md). Feature IDs `PRD-F1`..`PRD-F8` are frozen upstream. Carried gaps referenced here: G-3 diesel source (RFC-3), G-4/FC-7 Open-Meteo commercial quota, G-5 Azure DI residency (AIA/CLR), G-6 persistent host, G-10 PayMongo webhook detail (RFC-2).

---

## 0. Operating Posture

ArkiLaunch runs one production tenant during the pilot: Almara Construction, under 10 daily active users, load-bearing hours in Asia/Manila business time. That shapes every decision below. We do not staff a 24/7 NOC. We do wire alerts that page a human, because the two things this product exists to protect (billing integrity and tenant isolation) fail silently if nobody is watching.

Three invariants drive the whole runbook:

1. **No autonomous money movement.** A deposit deduction requires a two-log reconciliation match plus an explicit human approve (SDD §1, US-01). Any alert or runbook that touches the deduction path treats a false-accept as the worst outcome, worse than an outage.
2. **Tenant isolation is defense in depth.** Every tenant query runs under an app-layer `tenant_id` filter and Postgres RLS keyed on `app.current_tenant_id` (SDD §3/§5). A cross-tenant read reaching a client is a P0, not a bug ticket.
3. **Fail loud in dev, degrade gracefully in prod.** Every external dependency has a defined fallback and emits `external_dependency_degraded` (SDD §1, PRD §5.6). The runbooks in §4 are the human half of that contract.

**Hosting surface under watch (SDD §6):** Vercel (React frontend), Azure Container Apps (persistent NestJS API + ACA Jobs cron/workers), Supabase (PostgreSQL + Storage), Cloudflare (WAF + L3/L4/L7 DDoS + TLS 1.3). External: Azure AI Document Intelligence, PayMongo, Open-Meteo (commercial plan), and the diesel-price source (DOE price-watch scrape per RFC-3, admin manual input as the standing fallback).

---

## 1. SLOs & SLIs

*What "healthy" means in numbers. Targets pull from SDD §7 NFRs and the `BRD-M#` metrics. Every row names a real measurement source, not an aspiration. Availability is measured over a rolling 30-day window; latency over rolling 1h and 24h windows.*

*IDs are prefixed `SLO-#` (not bare `S#`) so they never collide with the PRD/DSD screen IDs `S1`..`S25`.*

| # | SLI (what we measure) | SLO (target) | Traces to | Measured by | Breach action |
|---|-----------------------|--------------|-----------|-------------|---------------|
| `SLO-1` | Core-module availability (auth, quotes, EDTR/billing, fleet) | 99.5% / 30 days | SDD §7 uptime; BRD-M6 | Uptime probe on `/health` + per-module synthetic checks; excludes third-party outages that hit a working fallback | Page on 2 consecutive failed checks (§3 A1); open P0/P1 per blast radius |
| `SLO-2` | API p95 latency, tenant CRUD reads/writes | < 400 ms | SDD §7 (p95 < 400 ms) | Azure Monitor request metrics from the NestJS API, measured inside the RLS transaction; excludes async OCR + external calls | Alert on p95 > 400 ms for 10 min; investigate slow query / missing `tenant_id`-leading index |
| `SLO-3` | Quote generation end to end | < 60 s (p95); typically < 5 s | SDD §7; US-03; BRD-M4 | `quote_generated.latency_ms` (PRD §5.6) | Alert on p95 > 60 s over 1h; check diesel-source latency and rate-card lookup |
| `SLO-4` | OCR extraction job success rate | >= 99% of jobs reach a terminal state (auto-accept / review / hard-fail) without worker error | SDD §7 (OCR async); SDD §8 ("0% unhandled error" = exhaustive terminal states) | ACA Job worker outcome counter; `ocr_field_confidence` volume vs enqueued `edtr` rows | Alert on success rate < 99% over 1h (§3 A2); check Azure DI health, then degrade to manual entry |
| `SLO-5` | OCR queue latency (enqueue to terminal state) | p95 < 5 min; hard ceiling 15 min | SDD §7 (seconds to ~60 s per doc, plus queue wait) | `edtr.status` timestamps (queued -> extracted/review/hard_failed); worker lag gauge | Alert on p95 > 5 min or any job > 15 min (§3 A2) |
| `SLO-6` | Reconciliation review-queue depth | < 25 open items; no item older than 24h | SDD §8.2 (queue smaller than the re-keying it replaces); guards BRD-V1 | Count of `edtr_reconciliations` in `pending`/`discrepancy` and `edtr` in `review` (PRD screen S8 backs this) | Alert on depth >= 25 or oldest > 24h (§3 A2); triage in S8, staff review, tune confidence gate / tolerance |
| `SLO-7` | Deposit-deduction success | >= 99.9% of human-approved deductions commit atomically; 0 deductions without a held gate | SDD §4 (approve path); US-01; BRD-M3 | `deposit_deduction_committed.gate_passed` (must always be true) vs 5xx on `POST /edtr/:id/approve` | Any deduction with `gate_passed=false` is a P0 (§4.5). Commit-error spike alerts P1 (§3 A3) |
| `SLO-8` | Weather poll freshness | every active site polled <= 30 min; staleness surfaced, not hidden | SDD §7 (poll every 30 min); US-05 | `POST /internal/jobs/weather-poll` run log; `weather_alerts.is_stale` rate | Alert if a site is unpolled > 45 min or stale rate climbs (§3 A1 dependency path) |
| `SLO-9` | Payment webhook reconciliation | 100% of `payment.paid`/`payment.failed` events durably written; status derived from webhook, not redirect | SDD §4 (US-08); G-10 | Webhook 2xx-after-durable-write rate; `payments.status` vs PayMongo event log | Alert on webhook 5xx or write-failure (§3 A4); reconcile via PayMongo API (§4.2) |
| `SLO-10` | Tenant-isolation integrity | 0 cross-tenant rows returned; `cross_tenant_access_denied` is expected and logged, never a served row | SDD §5; US-07 | RLS denial counter + `cross_tenant_access_denied` event; periodic isolation assertion in staging | Any confirmed cross-tenant read served to a client is P0 (§4.7). Denial-rate spike alerts (§3 A5) |
| `SLO-11` | Auth integrity | refresh-reuse detection fires correctly; abnormal reuse/failed-login rate stays within baseline | SDD §5 (rotation + reuse detection); US-07 | Token-family revocation counter; `login_succeeded` vs failed-login ratio; `two_factor_challenged` | Reuse spike or failed-login flood alerts (§3 A6); check for credential stuffing / token theft |
| `SLO-12` | External-dependency spend & quota | Azure DI per-page spend and Open-Meteo commercial quota stay inside the monthly budget envelope | SDD §6; §8 (per-page COGS in UES); G-4/FC-7 | Azure Cost Management (DI meter); Open-Meteo commercial dashboard usage | Alert at 80% and 100% of monthly budget/quota (§3 A7) |
| `SLO-13` | OCR extraction accuracy | Mean per-field accuracy on the running golden set stays >= 90.06% | SDD §8/§8.2; BRD-M2; QAD-T39 harness; the residual-risk basis for AIA-R5 | QAD-T39 accuracy harness re-run against the golden set on a schedule (weekly) plus after any Azure DI model or schema change | Alert if accuracy on the running golden set drops below 90.06% (§3 A2 extension); triggers a review of confidence-gate calibration, not a code rollback by itself |

**Error budget.** The 99.5% availability SLO (`SLO-1`) allows roughly 3h 40m of unavailability per 30 days on core modules. Third-party outages that land on a working fallback (Open-Meteo cache, diesel last-known price, Azure DI queue + manual entry) do not draw down the core-module budget; a broken fallback does. When more than half the monthly budget is spent, freeze non-critical deploys and prioritize reliability work over features until the window resets.

**Business SLIs feed the BRD metrics directly.** `SLO-3` -> BRD-M4 (quote < 1 min), `SLO-4`/`SLO-6` -> BRD-M2 + BRD-V1 (OCR accuracy behind the gate, review-queue size), `SLO-7` -> BRD-M3 (0% discrepancy at deduction), `SLO-1`/dependency alerts -> BRD-M6 (uptime). Do not treat these as vanity dashboards; they are the pilot's success evidence.

---

## 2. Observability; Logs, Metrics, Traces

**The three pillars; where each lives:**

| Pillar | Tool | What's captured | Retention |
|--------|------|-----------------|-----------|
| Logs | Winston (or the Nest Logger) emitting structured JSON from the NestJS API and ACA Job workers, shipped to Azure Monitor / Log Analytics; Vercel logs for the frontend; Supabase logs for Postgres/Storage | One JSON object per line: `timestamp`, `level`, `request_id`, `tenant_id`, `user_id` (UUID only), `role`, `route`, `status`, `latency_ms`, `event` (the PRD §5.6 name where applicable). Never raw PII or secrets | App logs 30 to 90 days (SDD §7); `audit_logs` immutable + long-lived in Postgres |
| Metrics | Azure Monitor metrics for API + ACA Jobs (request rate, p95/p99 latency, error rate, worker queue lag, cron run status); the SLIs in §1 as derived series | The §1 SLIs, plus the PRD §5.6 business events as counters (`reconciliation_discrepancy`, `deposit_deduction_committed`, `external_dependency_degraded`, `quote_generated`, `cross_tenant_access_denied`) | Metrics 90 days; business-event rows retained with the analytics sink below |
| Traces | OpenTelemetry from NestJS to Azure Monitor (Application Insights); one trace per request, spanning API -> Drizzle query -> external call (Azure DI, PayMongo, Open-Meteo, diesel) -> ACA Job continuation | Span timings for the RLS transaction, the external call, and the async worker handoff; `request_id` and `tenant_id` as span attributes | Traces 14 to 30 days (sampled; 100% on error) |

**Business-event sink decision (resolves the SDD §1 / PRD §5.6 TBD).** Send the frozen PRD §5.6 events to a **first-party `events` table on Supabase Postgres**, not to an external analytics vendor, for the pilot. Rationale: keeps PH document-adjacent telemetry inside our existing RA 10173 boundary, adds no new sub-processor to the CLR, and lets SLI queries (`SLO-3`/`SLO-6`/`SLO-7`) run next to the tenant data they describe. Revisit PostHog (self-host or a PH/EU-residency region) only if product-analytics depth outgrows SQL. Event names stay frozen either way. Escalate the final call to the CLR before launch.

**Per-tenant dimensions.** `tenant_id` is a first-class dimension on every log line, metric series, and trace. It is already in scope on the request path: the RLS transaction sets `app.current_tenant_id` via `set_config(..., true)` before any query (SDD §3), so the logging middleware reads it from request context and tags every line. This lets us slice availability, latency, OCR queue depth, and review-queue depth per tenant the moment a second tenant onboards (BRD-M7), without a schema change. Cron/job logs carry the `tenant_id` they are acting for (or `platform` for cross-tenant maintenance running under `service_role`).

**Correlation ID.** A `request_id` is generated at the edge (or first API hop) and propagated client -> API -> ACA Job worker -> logs/traces, so one user action (upload an EDTR, generate a quote, pay a deposit) is traceable end to end across the async OCR handoff. The `request_id` is returned on error responses so a support report maps to exact log lines.

**Health checks for every external dependency.** Each dependency has a probe and a degraded signal; the fallback is the human/automated response in §4.

| Dependency | Health check | Degraded signal | Fallback (runbook) |
|------------|--------------|-----------------|--------------------|
| Azure AI Document Intelligence | OCR worker records per-job success/failure + latency; synthetic analyze on a canary EDTR in staging | `external_dependency_degraded{dependency=azure_di, mode=down/fallback}` | Queue + retry with backoff; degrade to manual entry; never fabricate a value (§4.1) |
| PayMongo | Webhook 2xx-after-durable-write rate; checkout-session create canary in staging | `external_dependency_degraded{dependency=paymongo, mode=down}` + webhook 5xx rate | Reconcile via PayMongo GET payment API; idempotent on `payments.provider_ref` UNIQUE (§4.2) |
| Open-Meteo (commercial) | Weather-poll cron reports per-cycle success + per-site poll age; quota usage from the commercial dashboard | `external_dependency_degraded{dependency=open_meteo, mode=stale}` | Serve last-known Luzon reading, `weather_alerts.is_stale=true`; retry, never drop the cycle (§4.3) |
| Diesel-price source (DOE scrape, RFC-3) | Diesel-refresh cron reports success + price age; scrape parses expected structure | `external_dependency_degraded{dependency=diesel, mode=stale}` | Last-known price snapshot, quote `price_stale=true`; admin manual price entry (§4.4) |
| Supabase Postgres | ACA readiness probe runs a cheap `SELECT`; connection-pool health; PITR/backup status | Pool exhaustion / connection errors in API logs | Failover / PITR restore per RTO 4h / RPO 24h (§4.6) |
| Supabase Storage | Signed-URL issue + read canary on a known blob | Storage 5xx in API logs | EDTR/KYC upload retry queue; images never served on a public URL |
| Azure Container Apps (API + Jobs) | Container liveness + readiness probes; revision health | Revision unhealthy / restart loop | ACA auto-restart; roll back to previous revision (PRD §9) |
| Cloudflare / Vercel edge | Synthetic HTTPS check on `/health` and the public landing | Edge 5xx / TLS failure | Cloudflare status watch; Vercel rollback for frontend |

**`/health` and `/ready`.** The API exposes a shallow `/health` (process up) and a deep `/ready` (checks a DB round-trip and each external dependency's last-known state, returning a per-dependency `degraded` map). The uptime probe (`SLO-1`) hits `/health`; the dependency dashboard reads `/ready`.

**Dashboards.**
- **Health dashboard:** the §1 SLIs (availability, p95, quote latency, OCR success/queue, review-queue depth, deduction success, poll freshness), sliced by `tenant_id`.
- **Dependency dashboard:** the `/ready` map, per-dependency degraded rate, and `external_dependency_degraded` event stream.
- **Billing-integrity dashboard:** `reconciliation_discrepancy`, `deposit_deduction_committed` (with `gate_passed`), review-queue age. This is the one Rhea's trust rides on; watch it during the pilot daily.
- **Security dashboard:** `cross_tenant_access_denied` rate, refresh-reuse revocations, failed-login ratio, `two_factor_challenged`.
- **Cost dashboard:** Azure DI per-page spend vs budget, Open-Meteo commercial quota vs plan, ACA compute, Supabase.

**No-PII-in-logs rule.** Never log raw SEC/TIN, card or bank-account numbers, ID/KYC image bytes or their contents, `password_hash`, `totp_secret`, or full JWT payloads. Identifiers only (UUIDs); hash or omit anything sensitive. This mirrors the PRD §5.6 naming convention (no PII in property values) and SDD §5 data protection, and is reconciled with the CLR before launch. OCR output is data, never logged verbatim where it could carry a document's PII; log the field name and confidence, not the extracted string.

---

## 3. Alerting & On-Call

Every alert below is actionable: it names a condition, a severity, and a human. A page that a responder cannot act on gets tuned or deleted. Thresholds are starting points for the pilot and get retuned from real traffic after the first month.

| ID | Alert | Condition | Severity | Who / how notified | First move |
|----|-------|-----------|----------|--------------------|-----------|
| A1 | External dependency degraded / down | `external_dependency_degraded` for one dependency sustained > 5 min, OR `/health` fails 2 consecutive probes | P1 if no working fallback; P2 if fallback holding | Primary on-call, phone push | Open the matching §4 runbook; confirm the fallback is actually serving |
| A2 | OCR / reconciliation backlog or accuracy drift | OCR success rate < 99% over 1h (`SLO-4`), OR queue p95 > 5 min / any job > 15 min (`SLO-5`), OR review-queue depth >= 25 or oldest item > 24h (`SLO-6`), OR golden-set accuracy < 90.06% (`SLO-13`) | P1 (pipeline stuck or accuracy regression) / P2 (staffing backlog) | Primary on-call + admin (Rhea) for queue staffing; eng lead for an accuracy regression | Check Azure DI health (A1); if down, degrade to manual entry (§4.1); if healthy and backlog, staff S8 review; if accuracy-triggered, review confidence-gate calibration and the last Azure DI model/schema change |
| A3 | Deposit-deduction failures | 5xx rate on `POST /edtr/:id/approve` above baseline over 15 min, OR commit/rollback errors on the deduction transaction | P1 | Primary on-call, phone | Stop the bleeding: verify no partial deductions; check DB health; do not bypass the gate (§4.5) |
| A4 | Payment webhook failure | `POST /webhooks/paymongo` 5xx or durable-write failure, OR signed events arriving but `payments.status` not advancing | P1 | Primary on-call, phone | Verify signature-check and idempotency; reconcile via PayMongo API (§4.2) |
| A5 | Tenant-isolation anomaly | `cross_tenant_access_denied` rate spikes above baseline (a burst of denied cross-tenant attempts), OR any assertion that a cross-tenant row was served | P0 if a row was served; P1 on a denial spike | Primary on-call + eng lead, immediate | If a row was served, invoke §4.7 breach response now. If denials only, hunt the source (bug vs probing) |
| A6 | Auth / refresh-reuse spike | Refresh-token-family revocations spike (reuse detection firing repeatedly), OR failed-login flood / 2FA-challenge anomaly | P1 | Primary on-call + eng lead | Check for credential stuffing or token theft; consider rate-limit tightening; rotate signing key if theft suspected |
| A7 | Cost / quota alert | Azure DI per-page monthly spend crosses 80% then 100% of budget, OR Open-Meteo commercial quota crosses 80% then 100% of plan (G-4/FC-7) | P2 at 80%; P1 at 100% (risk of hard cutoff) | Primary on-call + product lead | At 80% investigate volume; at 100% confirm the plan will not hard-cut the weather poll or OCR mid-pilot; upgrade or throttle |
| A8 | Cron freshness / overlap | A scheduled ACA Job (weather poll, PM-threshold notify, diesel refresh, OCR reconcile) misses its window, errors, OR two runs overlap despite the guard | P1 (weather poll / OCR) / P2 (others) | Primary on-call | Check ACA Jobs execution history + the overlapping-run guard (§5); re-run manually if a window was missed |
| A9 | Availability / error rate | Core-module `/health` fails (`SLO-1`), OR API 5xx rate > 2% for 5 min | P0 (full outage) / P1 (single module) | Primary on-call + eng lead | Assess blast radius; mitigate first (roll back per PRD §9, or disable the failing module via feature flag) |
| A10 | Latency SLO burn | API p95 > 400 ms for 10 min (`SLO-2`), OR quote p95 > 60 s over 1h (`SLO-3`) | P2 | Primary on-call | Trace the slow path; check for a missing `tenant_id`-leading index or a slow external call |
| A11 | Backup / PITR health | A daily Supabase snapshot is missing, OR PITR lag exceeds RPO (24h) | P1 | Primary on-call + eng lead | Confirm backup pipeline; a backup we cannot restore is not a backup (§5) |

**On-call model.** Lightweight rotation across the ArkiLaunch eng team: one **primary** responder per week plus a **backup**, alerts to phone via the alerting tool. This is a pilot, not a 24/7 service; the honest posture is best-effort coverage weighted to Asia/Manila business hours, with P0/P1 paging around the clock because billing-integrity and isolation failures cannot wait for morning. The primary acknowledges within 15 min during business hours, best-effort off-hours.

**Escalation ladder.** Primary on-call -> eng lead (milestone DRI, SDD/PRD §9 owner) -> product lead. External vendor escalation when a dependency is the confirmed cause: Azure support (DI, Container Apps), Supabase support (DB/Storage), PayMongo support (payments/webhooks), Cloudflare status. Record the vendor ticket ID in the incident thread.

**Alert hygiene.** Every alert here routes to a real person and maps to a §4 runbook or a clear first move. Review alert noise monthly during the pilot: an alert that fired without action taken gets its threshold retuned or the alert retired. Alert fatigue kills response, and this team is small. Do not add an alert without a runbook.

---

## 4. Incident Response

**Severity ladder.** The QAD owns the canonical P0-P3 bug-triage scale (`docs/qad-arkilaunch.md` §5); this OPS ladder is the incident-response reading of the same four severities (QAD "Blocker" = OPS P0, "High" = P1, "Medium" = P2, "Low" = P3), scoped to production incidents rather than pre-launch bugs.

| Sev | Definition | ArkiLaunch examples | Response |
|-----|-----------|---------------------|----------|
| **P0** | System down, or active harm to billing integrity or tenant isolation | Cross-tenant row served to a client; a deposit deducted without the gate holding (`gate_passed=false`); full API/DB outage; confirmed data leak | Page immediately, 24/7. Mitigate now. Postmortem required within 48h |
| **P1** | A core module is broken or degraded with no working fallback, or a load-bearing SLO is burning fast | OCR pipeline stuck with the queue climbing; PayMongo webhooks not reconciling; auth broken for a role; sustained 5xx > 2%; Open-Meteo down AND the cache empty | Page during on-call; mitigate fast. Postmortem required within 48h |
| **P2** | Degraded with a working fallback, user-visible but contained | Open-Meteo down but cache serving `is_stale`; diesel stale-labeled and admin can enter manually; latency SLO burn within budget; cost at 80% | Ticket, handle next business day |
| **P3** | Minor or cosmetic, no SLO impact | A single noisy log, a dashboard glitch, a copy fix | Backlog |

**When an incident fires:**
1. **Acknowledge.** Claim it in the incident channel so nobody double-drives.
2. **Assess.** Severity, blast radius (which tenant, which module, is money or isolation involved), is it getting worse?
3. **Mitigate first, diagnose later.** Stop the bleeding: roll back per [PRD §9](prd-arkilaunch.md), disable the failing module via its feature flag, or degrade to the defined fallback. Recovery beats root-cause in the moment. The one exception: never bypass the reconciliation gate to "unblock" a deduction.
4. **Communicate.** For a user-facing P0/P1, tell Almara's admin (Rhea) plainly what is affected and the workaround (for example, "OCR is queued, enter hours manually, nothing is lost").
5. **Resolve & verify.** Confirm the §1 SLIs are back to normal and the fallback (if used) has caught up (queue drained, webhooks reconciled, price refreshed).
6. **Postmortem.** For any P0/P1, write `docs/pm-arkilaunch-NNN.md` within 48h (§6).

**Rollback trigger & mechanism:** owned by [PRD §9](prd-arkilaunch.md) as the single source of truth. In short: redeploy the previous tagged release from CI; Drizzle migrations are expand/contract so the prior build runs against the current schema (SDD §3/§6); per-module feature flags disable one failing module without a full redeploy. Do not re-specify triggers here; cite PRD §9.

**Kill switches / feature flags.** Per-module flags let a single failing module go dark without a redeploy (PRD §9): weather (F5), booking/portal (F8), payments (F2), KYC (F6). Two billing-specific switches: **force-review** (send every OCR result to the S8 review queue, disabling auto-accept, when confidence calibration is suspect) and **degrade-to-manual** (route EDTR capture straight to manual entry when Azure DI is down). Neither ever bypasses the reconciliation gate.

### Runbooks

Each runbook is the human half of a fallback the system already implements. Symptom -> confirm -> mitigate -> recover -> verify.

#### 4.1 Azure Document Intelligence outage (PRD-F3 / PRD-F6)

- **Symptom / alert:** A1/A2; OCR job failures, `external_dependency_degraded{dependency=azure_di}`, queue climbing (`SLO-5`).
- **Confirm:** Check `/ready` DI state and the OCR worker error logs. Distinguish a transient 429/5xx (retry with backoff will clear it) from a sustained outage.
- **Mitigate:** Uploads already queue and retry with backoff; the pipeline does not drop work. If the outage is sustained, flip **degrade-to-manual** so admin/timekeeper can key active/idle hours directly, which still count as one of the two independent logs. Never fabricate a value; unreadable input hard-fails to manual entry by design (SDD §8).
- **Recover:** When DI returns, the queued jobs drain; watch S4/S5 recover. Confidence-gated results still route through the two-log reconciliation before any deduction; the gate does not relax during degradation.
- **Verify:** Queue back under 5 min p95; no `edtr` stuck in `queued`; no deduction posted without a held gate. Check per-page spend did not spike from retries (A7).
- **Notes:** Region/residency for PH images is carried gap G-5 (AIA §5 + CLR). A residency incident (images processed outside the SE-Asia target) is a compliance event, escalate to the CLR owner, not just an ops retry.

#### 4.2 PayMongo webhook failure (PRD-F2)

- **Symptom / alert:** A4/S9; webhook 5xx, or `payments.status` not advancing after a customer pays.
- **Confirm:** Payment status is derived from the signed webhook, not the browser redirect (US-08). Check that the signature verification passes (endpoint secret current) and that the durable write happens before the 2xx. Non-2xx tells PayMongo to retry, so a brief blip self-heals.
- **Mitigate:** If our endpoint is failing, fix the endpoint; PayMongo's retry will redeliver. If events are lost or delayed, **reconcile via the PayMongo GET payment API** and replay them into our handler; the `payments.provider_ref` UNIQUE index makes replays idempotent, so re-processing cannot double-post.
- **Recover:** Reconcile any bookings left `pending` against PayMongo's record of truth; advance `payments.status` and booking status from the API result.
- **Verify:** Every `payment.paid`/`payment.failed` in PayMongo's log has a matching durable row; no booking stuck pending against a completed payment.
- **Notes:** Webhook/idempotency/refund/dispute detail is carried gap G-10 (RFC-2 or an SDD addendum). A refund/dispute incident follows that spec once it lands.

#### 4.3 Open-Meteo outage (PRD-F5)

- **Symptom / alert:** A1/A8; `external_dependency_degraded{dependency=open_meteo, mode=stale}`, poll cycle failing.
- **Confirm:** Check the weather-poll cron run history and quota (a 100% commercial-quota cutoff looks like an outage; see A7/G-4).
- **Mitigate:** The poll serves the **last-known Luzon reading** per site with `weather_alerts.is_stale=true`; the cycle retries and alerts rather than dropping silently (US-05). No manual action needed to keep serving; confirm the cache is actually populated (a cold worker restart reads the persisted last-known row, not an in-memory cache, per SDD §3).
- **Recover:** When Open-Meteo returns, the next successful poll clears `is_stale` and resumes auto-logging liability incidents on threshold crossings.
- **Verify:** No site unpolled > 45 min once recovered; stale flags cleared. If the root cause was quota, resolve the plan (A7) before it recurs.

#### 4.4 Diesel-scrape failure (PRD-F1)

- **Symptom / alert:** A1/A8; `external_dependency_degraded{dependency=diesel, mode=stale}`, diesel-refresh cron failing or the DOE page structure changed and the scrape stopped parsing.
- **Confirm:** Check the diesel-refresh cron and whether the DOE price-watch source changed layout or blocked the scrape (respect robots.txt; the scrape is public non-PII, RA 10175-compliant, per build context).
- **Mitigate:** Quotes use the **last-known diesel price** and label the quote `price_stale=true` with the price date; the engine never prices silently against an unknown value (US-03). If the outage runs long, the **admin enters the current diesel price manually** as the standing fallback (RFC-3 decision), and the quote snapshots that value for reproducibility.
- **Recover:** Restore or re-point the scrape (RFC-3 owns the source decision, G-3). Confirm fresh prices flow and `price_stale` clears on new quotes.
- **Verify:** New quotes carry a fresh `diesel_price_date`; historical quotations keep their snapshotted price (never retroactively repriced).

#### 4.5 Deposit-deduction failure (PRD-F3, money path)

- **Symptom / alert:** A3/S7; 5xx rate on `POST /edtr/:id/approve` above baseline, commit/rollback errors on the deduction transaction, or any `deposit_deduction_committed` event with `gate_passed=false`.
- **Confirm:** Any `gate_passed=false` is an immediate **P0**, not a P1: it means either the reconciliation gate was bypassed (never allowed) or a commit failed mid-transaction. Distinguish the two: check whether the reconciliation status was `matched`/human-resolved at the time of the call (if not, the 409 path should have fired instead of a commit) versus a genuine DB/transaction failure (connection drop, deadlock, constraint violation) during an otherwise-valid approve.
- **Mitigate:** **Never bypass the gate to "unblock" a deduction, under any operational pressure.** If the transaction is failing on a valid approve, treat it as a Postgres/transaction issue (see §4.6): check DB health, connection pool, and lock contention. If a deduction appears to have committed without a held gate, treat it as a P0 tenant-trust incident: freeze further approvals for the affected tenant via feature flag, and do not attempt a compensating write until the evidence trail (`audit_logs`, `edtr_reconciliations`, the invoice/payment rows) is captured.
- **Recover:** Once the root cause is fixed (transaction bug, DB issue, or a genuine gate-bypass defect), replay any legitimately queued approvals. A gate-bypass defect requires a QAD abuse test that reproduces the exact path before the flag is lifted.
- **Verify:** `deposit_deduction_committed.gate_passed` is `true` for 100% of commits going forward (`SLO-7`); no orphaned or partial deduction; `audit_logs` cites both source logs and the reconciliation for every committed deduction.
- **Notes:** This is the runbook a P0/P1 on A3 or a `gate_passed=false` alert on `SLO-7` routes to. It is distinct from a Postgres/Supabase infrastructure incident (§4.6), though a DB-side failure can trigger both.

#### 4.6 Postgres / Supabase incident (PRD-F7 data tier)

- **Symptom / alert:** A9/A11; connection errors, pool exhaustion, DB unavailable, or a data-loss event.
- **Confirm:** Distinguish a connection/pool problem (app-side, check ACA readiness + pool config) from a Supabase-side outage or data corruption.
- **Mitigate (outage):** For a connection/pool issue, roll back a bad deploy or scale ACA; for a Supabase-side outage, open a Supabase support ticket and, if needed, restore.
- **Mitigate (data loss / corruption):** Restore from Supabase automated daily snapshots with **point-in-time recovery**; 30-day retention (SDD §6). Targets: **RTO 4h** (max downtime), **RPO 24h** (max data loss, tighter where PITR is enabled). KYC/ID image blobs in Storage restore on the same cadence with RA 10173 retention limits.
- **Recover:** Bring the app back on the restored DB; replay any queued OCR/webhook work; verify `audit_logs` (append-only, immutable) are intact so the billing evidence trail survives.
- **Verify:** Deduction evidence trails still cite both source logs and the reconciliation; no orphaned `payments` or `edtr` rows. Confirm RLS policies came back with their tables (they ship in the same migration, SDD §3).
- **Note:** Migrations and cron run under `service_role` (BYPASSRLS); the request path never does. A restore does not change that boundary.

#### 4.7 Tenant-isolation breach response and drill (PRD-F7)

- **Trigger:** A5 with a confirmed served cross-tenant row. This is **P0** the moment a row crosses a tenant boundary to a client.
- **Immediate response:** Contain first. Identify the leak path (app-filter miss, an RLS policy gap on a table, a route running outside the RLS transaction, or a `service_role` connection on the request path, which must never happen). Disable the affected route/module via feature flag if containment needs it. Preserve `audit_logs` and `cross_tenant_access_denied` evidence.
- **Assess scope:** Which tenants, which rows, was PII (KYC SEC/TIN, customer data) involved? A confirmed leak of sensitive personal information is an RA 10173 event, not only an eng fix.
- **NPC 72-hour breach-notification clock (RA 10173 §20; resolves CLR §3 E-flag hand-off).** The moment PII exposure is confirmed (not merely suspected), this runbook, not the CLR, owns starting the clock:
  1. **T+0 (on confirmation):** the on-call responder who confirmed PII exposure immediately pages the eng lead **and** the CLR owner named in [clr-arkilaunch.md](clr-arkilaunch.md) §3.1 (E2, the designated DPO). Record the confirmation timestamp in the incident thread; this timestamp is the start of the 72-hour statutory window to notify the National Privacy Commission (NPC) under RA 10173 §20(f).
  2. **T+0 to T+24h:** eng captures the full scope (which tenants, which rows, which PII fields, how many data subjects) needed for the NPC notification content; CLR owner drafts the notification using that scope.
  3. **By T+72h:** the CLR owner files the NPC notification (or a documented, counsel-approved decision that the incident does not meet the NPC's notification threshold). This deadline is not extendable by an ongoing investigation; a partial notification with a promised follow-up is the correct move over silence.
  4. **Affected data subjects:** notified per the CLR's data-subject-notification procedure, in parallel with or immediately after the NPC filing, per counsel's guidance on the specific incident.
  5. **Record:** the confirmation timestamp, the NPC filing timestamp (or the documented non-notification decision), and the data-subject notification timestamp all go into the postmortem (§6) as first-class timeline entries, not narrative color.
- **Remediate:** Fix the policy or the query path; add the missing RLS policy or app-filter; ship it as an expand/contract migration. Add a QAD abuse test that reproduces the exact leak so it can never silently return.
- **Blameless drill (run in staging, rehearsed with the M5 rollback):** Author a Tenant A user, craft a request for Tenant B's data across each tenant-owned table, and assert the database returns **zero rows** (US-07) and logs `cross_tenant_access_denied`. Run this drill before go-live and after any change to RLS policies, the auth guard, or the connection-pool/GUC pattern. A drill that ever returns a row is a P0 in staging and blocks the deploy. The drill also rehearses the NPC-clock paging step above (simulated, no real NPC contact) so the on-call responder has done it once before it counts for real.
- **Verify:** Isolation assertion green across all tenant-owned tables; the new abuse test in the QAD suite passes in CI; for a real PII-exposure incident, the NPC clock was met or a documented exception was filed.

---

## 5. Routine Operations

*The boring work that prevents the incidents in §4.*

- **Backups & restore test.** Supabase automated daily snapshots with point-in-time recovery, 30-day retention (SDD §6). A backup nobody has restored is not a backup: run a **restore drill in M5 before go-live**, rehearsed alongside the PRD §9 rollback, then quarterly during the pilot. The drill restores to a scratch project, boots the app against it, and confirms `audit_logs` and deduction evidence trails survive intact. A11 watches snapshot health and PITR lag against RPO.
- **Expand/contract migrations.** Every Drizzle migration is forward-only and backward-compatible for one release, so the prior tagged build runs against the new schema; this is what makes the PRD §9 rollback safe (SDD §3/§6). CI runs a migration-compatibility check on every PR. RLS policies ship in the same migration as the table they protect; never merge a tenant-owned table without its policy. Migrations run under `service_role`; the request path never gets DDL rights.
- **Secret rotation.** Rotate on a schedule and on any suspected exposure: Azure DI keys, PayMongo secret + webhook endpoint secret, Open-Meteo commercial key, diesel-source credentials (if any), Supabase DB credentials, and the JWT signing key. Secrets live in platform env only (Vercel, Azure Container Apps, Supabase), never committed (SDD §5). Rotating the JWT signing key invalidates live sessions by design; use it as a break-glass on suspected token theft (A6). Argon2id password hashing and `totp_secret` encryption at rest are covered in the CLR.
- **ACA Jobs cron monitoring + overlapping-run guard.** Four scheduled jobs run on ACA Jobs: weather poll (every 30 min), PM-threshold notifications, diesel-price refresh, and async OCR reconciliation. **Azure Container Apps jobs can run concurrently by default**, so a slow run can overlap the next trigger; guard against it with a replica/parallelism limit of 1 per job or a Postgres advisory lock the job takes at start and releases at end (SDD §4/§6). A8 alerts on a missed window, a job error, or a detected overlap. Monitor execution history each week; a job that silently stops (weather poll, OCR reconcile) is worse than one that errors loudly. Re-run a missed window manually and confirm the guard held.
- **Dependency & security patching.** Dependabot (or equivalent) weekly on the React/Vite frontend and the NestJS/Node 24 LTS backend; security patches applied within 7 days, critical ones faster. Keep Node on the 24 LTS line; verify Drizzle, NestJS 11.1, and the PayMongo/Azure SDKs on upgrade. CI (lint, type-check, Vitest, migration check, Newman API, Playwright E2E on the two load-bearing flows) gates every patch before it reaches staging then prod (SDD §6).
- **Cost review.** Monthly check of Azure DI per-page spend (COGS line in the UES), Open-Meteo commercial quota (G-4/FC-7), ACA compute, and Supabase against the budget envelope; A7 automates the 80%/100% tripwires so the review is a trend check, not a surprise. Confirm no plan will hard-cut the weather poll or OCR mid-pilot.
- **Cert / domain expiry.** TLS terminates at Cloudflare with auto-renew; keep a calendar reminder as a backstop and watch domain-registration expiry. An expired cert on the public booking portal is a self-inflicted outage.

---

## 6. Postmortems

Every P0 and P1 gets a written postmortem at `docs/pm-arkilaunch-NNN.md` within **48h** of resolution. `NNN` is the next number in sequence; the postmortem is linked from the Incident Log in [docs/index.md](index.md) §3 (maintained by the index owner, not this doc).

**Blameless.** The postmortem asks what in the system let a human make the mistake, not who to blame. The output is a stronger system, not a scapegoat. A responder who surfaces a near-miss is doing the job right.

**Contents (minimum):** timeline (detection -> mitigation -> resolution, with `request_id`s), user/tenant impact, root cause, what went well, what did not, and dated action items each with an owner.

**Action items feed back into the doc suite:**
- A missing test or an escaped abuse case -> a new eval/abuse test in the **QAD** (for example, the exact cross-tenant query from a §4.7 breach, or a reconciliation false-accept case).
- A missing alert, blind spot, or runbook gap -> a new row in this **OPS** (§3 alert or a §4 runbook), folded in the same week.
- A dependency, config, migration, or guard fix (for example the ACA overlapping-run guard) -> the **BUILD** guide and, where it changes behavior, a note in the SDD.

Do not close a P0/P1 postmortem until its action items have owners and dates. The index §4 health check tracks open postmortems; keep the count at zero.

---

## Self-Check

- [x] Every SLO in Section 1 has a real measurement source (Azure Monitor, PRD §5.6 events, DB status), not aspirational; each traces to an SDD §7 NFR and/or a `BRD-M#`
- [x] SLO IDs are prefixed `SLO-1`..`SLO-12`, not bare `S1`..`S12`, so they never collide with the PRD/DSD screen IDs `S1`..`S25` (a prior version of this doc used bare `S#` for both, which was ambiguous, e.g. `S8` meaning both "SLO-8 weather freshness" and "screen S8 reconciliation review queue")
- [x] Logs carry a correlation ID (`request_id`) and a per-tenant dimension (`tenant_id`) and contain no PII/secrets (reconciled with CLR)
- [x] Every alert in Section 3 is actionable, routes to a real person, and maps to a §4 runbook or a clear first move (A1-A11)
- [x] The required alert set is present: external-dependency degraded/down (A1), OCR/reconciliation backlog (A2), deposit-deduction failures (A3), tenant-isolation anomaly / RLS denial spike (A5), auth/refresh-reuse spike (A6), and Azure DI + Open-Meteo cost/quota (A7)
- [x] Section 4 defines P0/P1, names the rollback mechanism (PRD §9, not re-specified) and kill switches, and carries runbooks for Azure DI (§4.1), PayMongo webhook (§4.2), Open-Meteo (§4.3), diesel scrape (§4.4), deposit-deduction failure (§4.5), Postgres/Supabase (§4.6, RTO 4h / RPO 24h), and a tenant-isolation breach drill with the NPC 72h notification clock (§4.7); runbooks are numbered contiguously 4.1 through 4.7 with no gaps or duplicates
- [x] Section 5 covers backups + restore test, expand/contract migrations, secret rotation, ACA Jobs cron monitoring with the overlapping-run guard, dependency patching, cost review, and cert expiry
- [x] A backup restore is scheduled (M5 before go-live, then quarterly), not assumed (SDD §6)
- [x] P0/P1 incidents have a Postmortem SLA (48h), a blameless process, and action items that feed QAD/OPS/BUILD
- [x] Cross-linked to SDD (§6 infra, §7 NFRs) and PRD (§9 rollback, §5.6 events); did not edit `docs/index.md` or `docs/log-arkilaunch.md`
- [x] AGENTS hard bans applied (no em-dashes, no AI-tells, sharp-teammate voice)
