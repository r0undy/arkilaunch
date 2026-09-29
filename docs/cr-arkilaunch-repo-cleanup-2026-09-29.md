# Change Record

**Title:** Repo cleanup, third pass: holes, over-engineering, comment essays
**Project:** ArkiLaunch
**Date:** 2026-09-29
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (brownfield change workflow); a full-repo audit for defects, over-engineering and comment bloat
**Docs touched by this record:** [index.md](index.md) §2, [log-arkilaunch.md](log-arkilaunch.md) §1. The hourly-only rate-card change ships in the same PR and has its own record: [cr-arkilaunch-hourly-rate-cards.md](cr-arkilaunch-hourly-rate-cards.md).

---

## 1. Why this pass exists

The earlier passes ([cr-arkilaunch-repo-cleanup-audit.md](cr-arkilaunch-repo-cleanup-audit.md), [cr-arkilaunch-repo-cleanup-2026-09-25.md](cr-arkilaunch-repo-cleanup-2026-09-25.md)) removed dead code only. This pass had three aims: fix real defects, cut over-engineering, and bring roughly 7,000 comment lines down to near zero. It did all three without breaking behaviour. Four auditors read the whole repo. Eight independent verifiers then re-traced every reported defect: 60 of 63 were confirmed.

Decisions taken while scoping (2026-09-29):
- Holes get code-only fixes, one regression test each. A fix that needs a migration, an API contract change or a product call is recorded in §3 instead.
- Comments are near zero. A comment stays only where the code would be dangerous to change without it.
- Big files are simplified in place, not split.
- Every password minimum is 12 characters.
- Timekeeper 2FA stays unenforced for now (§3).

## 2. What shipped

**Money path and concurrency**
- Checkout locks the rental or truck request. Two tabs can no longer create two payable sessions for one booking.
- EDTR approve, reject and review lock the reconciliation first, so a rejection that commits mid-approve is no longer overwritten.
- `reconcileEdtr` no longer pairs with a decided (approved or rejected) log.
- Capture refuses a unit that is not on the rental. Approval refuses a date outside the unit's span.
- Adjustments are capped at 24 h.
- The hold-expiry job re-checks for a pending online payment after taking its lock.
- Scope-denial audit rows commit in their own transaction, so the refusal no longer rolls them back.
- Deposit totals are rounded.

**Auth and security**
- Refresh rotation claims the token atomically, so a concurrent replay is treated as reuse.
- `/auth/2fa/verify` is throttled and has a per-account lockout.
- The equipment report requires `report:read`.
- The global exception filter logs unmapped 500s by Postgres error code only.
- Telemetry drops `url.query`.
- A deployed container with no Resend key logs only the recipient and subject, never the activation link.
- The two-tenant seed refuses a remote database unless explicitly allowed.
- The OCR fixture puller redacts every KYC field.

**Correctness**
- Fleet reports count one approved day per machine-day. Before, a matched pair counted twice and approved discrepancies were left out.
- Invoice filters and the financial report use Manila day bounds. The GasWatch reading date is also a Manila date.
- Staff cannot cancel an on-site or closed booking.
- A quote revision cannot move to another customer.
- A retired unit cannot be deployed through the legacy route.
- Auto-quote approvals carry an audit reason.
- Re-deciding an application returns 404, not 500.
- Catalog paging is deterministic.

**Web**
- Staff capture works again: the status check polled `/api/v1/api/v1/edtr/:id` and always failed. Staff now choose the machine explicitly.
- A network drop, 5xx or 429 on refresh no longer signs the user out.
- The site dialog cannot post a site twice.
- Push alerts re-bind to the signed-in user.
- A stale diesel override is no longer revived by saving operating costs.
- The negotiation "Total due" no longer double-counts a paid deposit.
- /help shows the tenant's own contacts.
- Machine names come from the whole fleet, not just the first 20 units.
- The cart survives blocked storage.
- About 57 `<Link><Button>` nestings are replaced by button-styled links.
- The Open-Meteo credit now appears on per-machine weather.
- Screen readers announce unread notifications.
- About ten smaller fixes (stale-closure search, toast during render, deep links past page one, dt/dd order, error messages).

**Over-engineering**
- Shared helpers exported once: `Tx`/`Executor`, `round2HalfUp`, `manilaDate` reuse, upload caps, `normalize`, `SEVERITY_RANK`.
- `runJobIfMain` for all jobs, `createDocumentIntelligenceAdapter`, one `CtxRequest`/`MulterFile`.
- The per-route `UuidParamPipe` is gone (the global pipe covers it). Quote revisions share one insert.
- API and web duplicate helpers are merged: branding, storage buckets, own-site, pins, labelers, chips, dates, query factories, API client, icons (lucide-react).

**Comments**
- About 8,000 comment lines removed net across apps, packages, jobs, infra and CI.
- Kept comments are one line each, on RFC-1/RFC-2 gates, RLS/GUC reasons, PII/OCR constraints, platform gotchas and `ponytail:` ceilings.
- Stale claims were corrected or deleted. For example, the 2FA comment now says 2FA is not enforced, and the KYC comment now describes the real verified gate.
- Parser checks confirmed the comment commits change no code.

**Tooling**
- ESLint ignores local `.wrangler/` output.
- CI now runs the db specs that no job ran before.
- The Dockerfile drops an unused `corepack` step.

## 3. Recorded, not fixed

- **Timekeeper 2FA is not enforced.** The web app has no enrollment screen. Enforcing it would lock every timekeeper out. It needs an enroll UI first.
- **Ops wiring is missing.** `RESEND_API_KEY`/`EMAIL_FROM` and the VAPID keys are not wired into Terraform or `deploy.yml`, so deployed environments send no email and no Web Push. `USER node` is missing in the Dockerfile; it needs a Docker build to verify.
- **Infra consolidation.** Terraform: `for_each` cron jobs, merging the dev and prod roots, inlining the single-resource modules, and removing unused outputs. CI: a composite setup action, the `newman` stub, and the duplicate `ocr-accuracy-gate` run.
- **Contract changes.** The legacy `/kyc/*` endpoints have no web caller. The TIN schema could be tightened.
- **Deferred refactors.** Modal to native `<dialog>`. Moving the truck editors out of `app.trucks.tsx`; that is a file split, which this pass ruled out. `TotpService` to plain functions: 10 specs construct it, so the churn outweighs the gain. The seed `firstOrInsert` helper. Merging the alnum normalizers. KYC sign-then-fetch.
- **Kept on purpose.** `HazardDivider` and the night-yard theme stay because the DSD specifies them.
- **Needs a migration and a product call.** Unique indexes against duplicate field logs and sites. Worker-side `outside_rental` flags.
- **Test data in the shared dev DB.** Leftover rows (for example, about 1,300 test-tenant `project_sites`) make `sites-engine`, `sites-deployment`, `weather-business-journey` and the jobs weather specs fail or time out locally. The real `RESEND_API_KEY` in local `.env` also makes weather tests call Resend. CI's clean Postgres is the arbiter.

## 4. Verification

- `pnpm build:packages`, `pnpm typecheck` and `pnpm lint` are clean. `pnpm --filter @arkilaunch/web build` succeeds.
- web 421/421 (baseline 392, with 30 new tests), shared 262/262, document-intelligence 17/17, weather 20/20.
- api, run per stream: 315/317 pass. The two failures, plus the `sites-deployment` file, are the known leftover-data failures. The refresh-rotation replay test that failed at baseline now passes.
- jobs and packages/db: their specs pass, except the jobs weather timeouts noted in §3.
- The final combined DB-backed run was stopped by the host for low memory. The commits after the stream runs are comment-only and parser-verified. CI runs the full suite against a clean database.

## 5. Pre-merge gate runs

| Agent | Applies? | Verdict |
|---|---|---|
| `tenant-isolation-checker` | Yes (queries, locks, auth) | PASS |
| `migration-rls-guardian` | Yes (0071) | PASS |
| `restraint-guardian` | Yes | PASS. It found one comment encoding defect, fixed in `6153ffd` |
| `ai-ocr-abuse-runner` | Yes (reconciliation, approval, adapter factory, KYC uploads) | Pending |
| `edtr-ocr-worker` | Covered by the abuse runner and the tenant check | Not run separately |
