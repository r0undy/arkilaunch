# Change Record

**Title:** Frontend deploy-readiness pass: Vercel build config, RFC-1 access-token drift fix, 2FA flow, and wiring the console screens onto the read/write surface the three 2026-08-06 backend-unblock CRs shipped
**Project:** ArkiLaunch
**Date:** 2026-08-07
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [index.md](index.md) §2 (Change Log)

---

## 1. Summary

The backend deploys to Azure via Terraform (`ca-arkilaunch-dev-api` + 4 cron jobs), but `apps/web` was never part of that pipeline: no Vercel deploy step, no `VITE_API_BASE_URL` set anywhere, and the API's stable-FQDN output was actually the revision-specific one. Several console screens also still said "no backend endpoint yet" about endpoints the three 2026-08-06 CRs (`cr-arkilaunch-storage-upload`, `cr-arkilaunch-tenant-registration-catalog`, `cr-arkilaunch-frontend-contract-unblock`) had already shipped. This pass closes both gaps for the dev environment.

## 2. Deploy readiness

- `infra/terraform/modules/api_app/outputs.tf`: `fqdn` now returns `azurerm_container_app.this.ingress[0].fqdn`, not `latest_revision_fqdn` (which changes on every deploy and could never be a stable `VITE_API_BASE_URL`).
- Root `vercel.json` (new) builds `@arkilaunch/shared` before `@arkilaunch/web` and points `outputDirectory` at `apps/web/dist` — Vercel's Root Directory must be the repo root, not `apps/web`, since `@arkilaunch/web` depends on `@arkilaunch/shared` via `workspace:*`. `apps/web/vercel.json` removed (superseded).
- `apps/web/.env.example` (new): documents `VITE_API_BASE_URL` and the new `VITE_PUBLIC_SITE_URL`.
- `apps/web/scripts/prerender.mjs`: domain is now `VITE_PUBLIC_SITE_URL`-driven instead of hardcoded `https://almara.example`; the six equipment-detail routes are fetched live from `GET /catalog/equipment` at build time instead of the hardcoded `eq-1`..`eq-6` fixture list (skipped, not faked, if the fetch fails). `robots.txt`/`sitemap.xml` point at `https://arkilaunch-dev.vercel.app` for now.
- `.env.example`: `JWT_ACCESS_TOKEN_TTL=10m` corrected to `600` (seconds) — `Number('10m')` is `NaN`, so the example never matched what the code or Terraform actually used.
- `.github/workflows/ci.yml`: added a `web-unit-tests` job — the web Vitest suite (41 tests) was not running in CI at all.
- **Per-deployment Vercel preview URLs are not supported**: the API's CORS allowlist (`WEB_ORIGIN`) is a single origin, so only the production alias (`arkilaunch-dev.vercel.app`) works against the deployed dev API. Widening this to a preview-URL pattern is a backend/security decision, out of scope here.

## 3. RFC-1 §3 drift fix: access token in memory

`apps/web/src/lib/auth-client.ts` held the access token in `sessionStorage`; RFC-1 §3 requires memory only. It is now a module-level variable, with `bootstrapSession()` (awaited in `main.tsx` before the router renders) doing one silent refresh on load so a page reload still restores the session from the refresh token. `setAccessToken()` is exported for tests, which previously seeded state by poking the now-removed `arkilaunch.accessToken` sessionStorage key directly.

## 4. 2FA flow

`login.tsx` previously dead-ended a `TwoFaChallenge` response with an honest "not supported here" message, even though `POST /auth/2fa/verify` was a live, tested endpoint. It now renders a code-entry step and calls it. The "Remember me" checkbox (wired to state, sent nowhere) was removed rather than left dishonest.

## 5. Console screens wired onto the existing backend

Five `DataPanel` routes (`app.payments`, `app.incidents`, `app.deployment`, `account.bookings`, `field.deployment`) rendered `JSON.stringify(data.items)` as a placeholder; they now use a new `apps/web/src/components/table.tsx` primitive against the already-typed shared response schemas.

Screens that said "no endpoint yet" about endpoints that now exist:
- `app.users.tsx`: full invite/role-change/reinvite/reset-password/deactivate/reactivate UI against `/users/*`.
- `account.settings.tsx`: reads `GET /users/me` (still no edit — no editable field exists server-side yet, per `cr-arkilaunch-frontend-contract-unblock.md` §8).
- `account.applications.tsx`: reads `GET /tenants/me/application`.
- `app.settings.tsx`: rate-card create/list/retire against `/rate-cards`.
- New `app.platform-applications.tsx` (platform_admin only): the first platform-console screen, approve/reject against `GET /tenants/applications` + `POST /tenants/:id/{approve,reject}`. The returned `activationToken` is surfaced in the UI for out-of-band relay — there is still no email provider.
- `account.cart.tsx`: a real (client-side, sessionStorage-backed — bookings have no cart table by design) cart feeding `POST /bookings` then `POST /bookings/:id/checkout`. Checkout works against the `StubPaymentsAdapter` returned whenever `ENABLE_PAYMENTS=false`, so no frontend flag-gating was needed.

## 6. EDTR/KYC de-POC

`edtr.tsx`/`kyc.tsx` had stale comments claiming no Supabase Storage upload existed (untrue since `cr-arkilaunch-storage-upload.md`) and no shared response schema for the API's own shapes.

- Added `EdtrCaptureResponse`/`EdtrDetailResponse` (`packages/shared/src/edtr.ts`) and `KycExtractResponse`/`KycDetailResponse` (`packages/shared/src/kyc.ts`) — the one part of the OCR contract with no shared type. `edtr.service.ts`/`kyc.service.ts` now return-type-annotate against them (the same convention `users.service.ts#me()` already used — a compile-time check, not a runtime response interceptor).
- `edtr.tsx` now polls `GET /edtr/:id` automatically every 3s using the `pollUrl` the capture response hands back, stopping at a terminal status, instead of a manual "Poll status" button. The dev-only `/edtr/dev/run-worker` trigger is now hidden behind `import.meta.env.DEV`.
- `kyc.tsx` extraction is synchronous server-side (no worker), so no polling loop was added there — a single follow-up `GET` after extract already reflects the final values.
- Both screens now render extracted fields with `ConfidenceChip` instead of only raw JSON.

**Not built**: the Evidence Split View. `StorageService.createSignedDownloadUrl` exists but is exposed on no HTTP route — there is no way for the frontend to fetch a signed image URL. Needs its own backend endpoint and CR.

## 7. Verification

- `pnpm typecheck` clean across `packages/shared`, `apps/api`, `apps/web`.
- `pnpm lint` clean (added a `fetch` global for the Node 24 build scripts eslint config, fixed an unused import).
- `pnpm --filter @arkilaunch/web test` — 41/41 passing (updated `auth-client.test.ts`, `guards.test.ts`, `login.test.tsx` for the in-memory access token).
- `pnpm build` clean end to end; `node scripts/prerender.mjs` run against the built `dist/` with no live API reachable — correctly skips the equipment-detail routes and prerenders the six static routes with `VITE_PUBLIC_SITE_URL`'s default.
- **Not run in this environment** (no live Supabase/Azure deployment reachable here): an actual login against the deployed dev API, a CORS round-trip from the Vercel production alias, a real file upload, or the pre-merge subagent gates named in `AGENTS.md` §2 (`tenant-isolation-checker`, `restraint-guardian`, `ai-ocr-abuse-runner` for the EDTR/KYC changes). **Run these before merging.**

## 8. Scope note

Deferred, named explicitly:
- Prod Vercel/Terraform values (`prod/terraform.tfvars`'s placeholder `supabase_url` and `web_origin`) — dev-only per this pass's scope.
- Supabase preview-URL CORS support.
- Evidence Split View (§6 above).
- `PATCH /users/me` — still no editable field server-side.
