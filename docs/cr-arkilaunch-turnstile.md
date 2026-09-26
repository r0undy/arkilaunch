# Change Record

**Title:** Cloudflare Turnstile on the public auth writes; throttle stops trusting a client-settable `CF-Connecting-IP`
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Applied` (repo). Live on `arkilaunch.app` once `enable_turnstile = true` ships in `dev/terraform.tfvars` (§4)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §2/§6 (addenda), [qad-arkilaunch.md](qad-arkilaunch.md) QAD-T22 (addendum), `.env.example`, [index.md](index.md) §2

---

## 1. Summary

The public, unauthenticated writes (customer signup, company registration, forgot-password, login) were protected only by per-IP throttles. Those throttles could be bypassed:

- The API is reached directly on its ACA ingress FQDN, not through Cloudflare. Only the static frontend is on Cloudflare (`cr-arkilaunch-cloudflare-frontend.md` §2).
- Even so, `PlatformThrottlerGuard` keyed buckets on the `CF-Connecting-IP` header. Any caller could send a different value on each request and get a fresh bucket every time.

The SDD's claim that "Cloudflare WAF fronts every public route" was therefore untrue for the API. This record adds Cloudflare Turnstile where bots do damage and closes the spoof.

## 2. Decisions

| Route | Turnstile |
|---|---|
| `POST auth/register-customer` | Always |
| `POST tenants/register` | Always |
| `POST auth/forgot-password` | Always |
| `POST auth/login` | Only after **2 failures** for that email **or** that IP in the 15-min lockout window |
| `POST auth/activate`, `2fa/verify`, `refresh`, webhooks | None (each already holds a single-purpose token or an HMAC) |

- **Managed widget.** Most visitors get an automatic pass in about a second and never see a puzzle. A normal login never shows the widget at all.
- **Fails closed.** If siteverify is unreachable (5 s timeout) or returns 5xx, the API answers 503 `captcha_unavailable`, not a pass. A bot cannot get through by making verification time out.
- **Flag.** `TURNSTILE_ENABLED` is off by default (local dev, tests, emergency switch-off). Turned on without `TURNSTILE_SECRET_KEY`, the API refuses to boot, the same posture as `ENABLE_PAYMENTS`.
- **API stays on the ACA FQDN.** Proxying it through Cloudflare (`api.<domain>` plus ingress locked to Cloudflare IPs) was considered and deferred. Turnstile does not need it.
- **No other Cloudflare features now:** no CSP/headers, edge rate rules or Bot Fight Mode.

## 3. Repo changes

- **Spoof fix.** `apps/api/src/common/throttler/platform-throttler.guard.ts` is deleted, and `app.module.ts` registers the stock `ThrottlerGuard`. With `trust proxy 1`, `req.ip` is the rightmost `X-Forwarded-For` entry, the one ACA's envoy appends from the real socket. A client can prepend entries but cannot replace that one.
- **`apps/api/src/common/turnstile.ts`:**
  - `verifyTurnstile(token, ip)` calls siteverify. Missing token → 403 `captcha_required`; rejected → 403 `captcha_failed`; unreachable → 503 `captcha_unavailable`.
  - `TurnstileGuard` reads the `X-Turnstile-Token` header. The token rides in a header, so no request DTO changes.
- **Guards.** `@UseGuards(TurnstileGuard)` is on `registerCustomer`, `forgotPassword` and `tenants/register`. The existing `@Throttle` limits stay and run first, so a throttled caller never costs a siteverify call.
- **Adaptive login.** `AuthService.login` takes `ip` and the token. It keeps a per-IP failure map beside the existing per-email one (same window) and requires a token once either count reaches 2. Lockout at 5 is unchanged. Both maps are in-process per replica, the same ceiling as the lockout.
- **Web:**
  - `components/turnstile.tsx` loads Cloudflare's script (no new dependency). It renders nothing when `VITE_TURNSTILE_SITE_KEY` is unset, and remounts via `key` for a fresh single-use token.
  - Signup, company registration and forgot-password show the widget above submit, which stays disabled until the widget passes.
  - Login shows it only after the API answers `captcha_required`, then retries by itself when the widget passes.
- **Infra.** Dev and prod Terraform get `enable_turnstile` (default false) and `turnstile_secret_key` (sensitive), wired into the Container App like the PayMongo secret. `deploy.yml` passes `TF_VAR_turnstile_secret_key` and builds the web app with `VITE_TURNSTILE_SITE_KEY`.
- **Tests.** `apps/api/test/turnstile.spec.ts` covers the verifier (pass, reject, missing, unreachable, flag off) and adaptive login (per-email and per-IP thresholds).

## 4. Operator cutover (dev = `arkilaunch.app`)

1. **Done.** Turnstile widget created in the Cloudflare dashboard: Managed mode, hostname `arkilaunch.app` (covers the `*.arkilaunch.app` storefronts).
2. **Done.** GitHub `dev` environment: variable `VITE_TURNSTILE_SITE_KEY`, secret `TURNSTILE_SECRET_KEY`.
3. Merge the code with the flag off. The frontend ships the widget, and the API ignores the header.
4. Set `enable_turnstile = true` in `infra/terraform/environments/dev/terraform.tfvars` and merge. Rollback: revert that line.

## 5. Compliance

- Cloudflare is already a sub-processor ([clr-arkilaunch.md](clr-arkilaunch.md)). Turnstile sends the visitor's IP and browser signals to Cloudflare, and the API forwards the client IP as `remoteip`. It is cookie-free, and no new category of personal data is stored by ArkiLaunch.
- **QAD-T22** gains a bot gate on login. The throttles behind QAD-T22/T31 now key on an IP a client cannot forge.

## 6. Verification

- `apps/api` `vitest run test/turnstile.spec.ts test/auth-lockout.spec.ts test/forgot-password.spec.ts`: green. Typecheck and lint for api and web: green.
- **Live, after step 3:** six `forgot-password` calls, each with a different `CF-Connecting-IP`, get a 429 on the sixth.
- **Live, after step 4:**
  - `register-customer` without a token → 403 `captcha_required`.
  - In a browser, signup on a storefront passes the widget and succeeds.
  - Forgot-password succeeds.
  - Three bad logins bring up the widget, then the right password signs in.
  - Company registration on the platform host succeeds.
