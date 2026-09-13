# Change Record

**Title:** Repo cleanup audit — a dead weather cron in the runtime image, a README that understated the build by seven features, and two overclaiming crawlability boxes
**Project:** ArkiLaunch
**Date:** 2026-09-13
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (brownfield change workflow); a full-repo staleness and dead-code audit
**Docs touched by this record:** [index.md](index.md) §1/§2/§5, [build-arkilaunch.md](build-arkilaunch.md) §5.2, [log-arkilaunch.md](log-arkilaunch.md) §1, root `README.md`, `AGENTS.md`, `BRAND.md`, `DESIGN.md`

---

## 1. Why this pass exists

A comprehensive audit of the repository for stale documentation, dead code, and configuration rot. The finding that justifies the pass on its own is not a documentation defect: **the Docker runtime image has never contained `packages/weather`**, so the dev weather-poll cron job has been failing on every tick since the package landed on 2026-08-20.

The audit's broader result is worth recording honestly, because it shapes what this record does *not* do: the source tree is clean. No `TODO`/`FIXME`/`HACK` markers anywhere in `apps`, `packages`, `jobs`, `infra` or `.github`; no skipped or `.only` tests; no commented-out code; no `.bak`/`.orig` files; no empty directories; no secrets tracked in git; and zero broken relative links across the documentation. The rot that exists is concentrated in a small number of specific claims, and those are what this pass corrects.

## 2. What shipped

**The weather cron fix.** `Dockerfile`'s runtime stage copied `packages/shared`, `packages/db`, `packages/document-intelligence`, `jobs` and `apps/api`, but not `packages/weather`. This is invisible at build time: `node_modules` carries pnpm's workspace symlinks, so `jobs/node_modules/@arkilaunch/weather -> ../../../packages/weather` is copied into the image as a *dangling* symlink and fails only on first import, at runtime, inside a cron job with no interactive observer. `jobs/src/weather-poll.ts` imports `createWeatherAdapter` from it, `infra/terraform/environments/dev/main.tf` deploys `weather_poll_job`, and `dev/terraform.tfvars` sets `enable_weather_poll = true`, so every scheduled run died on `ERR_MODULE_NOT_FOUND`. The deps stage already carried a comment warning about this exact failure mode — it was fixed there and in `build`, and not in `runtime`. That warning is now repeated on the runtime stage.

**README.md, rewritten.** It stated that `F3/F1/F5/F6/F4/F8/F2 are not yet built`. All eight PRD features had working, tested backends as of 2026-08-02 (`index.md` §5). Seven features were reported as unbuilt for over a year, in the first file any reader opens, with the same claim baked into a shields.io status badge. The rewrite states the real position, including the parts that are *not* finished: the frontend is a working shell rather than a finished product, the deploy pipeline is unproven, the OCR path has never analyzed a real document, and two Change Records remain open. It also resolves an ambiguity three files disagreed about — `index.md` §1 grouped README with the four materialized artifacts, `CLAUDE.md` did not, and README's own footer claimed template materialization. **README is hand-maintained and is not a materialized artifact;** it now says so, and `index.md` §1 has been corrected to match.

**The crawlability checklist, corrected in both directions.** `AGENTS.md` §5.2's indexability checklist was entirely unchecked while its canonical source `build-arkilaunch.md` §5.2 was fully checked — `cr-arkilaunch-frontend-storefront-shell.md` named BUILD §5.2 as touched but never re-materialized the root artifact. Auditing which file was right showed that BUILD was overclaiming: `apps/web/scripts/prerender.mjs` exists and does the work, but `apps/web/vercel.json`'s `buildCommand` never invokes it, so the deployed public pages are still the client shell and no canonical URLs are injected. Those two boxes are now `[~]` with the reason in both files. The other two hold independently of the prerender step and stay `[x]`: the sitemap is a hand-maintained static file, and `noindex` is the shell's default — prerender is what would *remove* it, so not running it fails safe on that box.

**Materialization banners.** `AGENTS.md`, `BRAND.md` and `DESIGN.md` each credited `scripts/materialize.py`, a path that does not exist in this repo because the FMD engine is not vendored here — as `CLAUDE.md` and `index.md` §4 both state. It was the only dead path reference in the documentation.

**Repo hygiene.** `.gitignore` now carries `.claude/settings.local.json` and `.claude/scheduled_tasks.lock`, which were previously ignored only by a developer's global gitignore and `.git/info/exclude` — neither of which travels to another clone. The root `build` script filtered `./packages/*` and `./apps/*` only, silently skipping the `jobs` workspace, so a compile break in `jobs/` could not fail CI's `lint-typecheck-build` and would surface only during `docker build` after merge. `.vercelignore` was deleted: `vercel.json` lives at `apps/web/vercel.json`, so the Vercel project root is `apps/web` and a repo-root ignore file is never consulted — and if it ever were applied at the root, it ignores `jobs` and `apps/api` while `pnpm-workspace.yaml` declares them, which would break `pnpm install --frozen-lockfile`. `.env.example` now documents `DOE_PRICE_WATCH_URL` and `OCR_FIXTURES_DIR`, both read from the environment and previously discoverable only by reading the source.

**Dead code.** `apps/web/src/components/evidence-hero.tsx` (nothing imported `EvidenceHero`) and four `queryOptions` factories in `apps/web/src/lib/queries.ts` with zero call sites (`depositQueries`, `maintenanceQueries`, `quoteQueries`, `invoiceQueries`).

**Registry reconcile.** `index.md` §1's `Last Updated` column had 16 of 19 rows reading `2026-07-25`, a date true for none of them; `docs/runbook-local-dev.md` was registered nowhere despite existing since 2026-08-06; and the doc-count note said 23 files when the filesystem holds 43. `log-arkilaunch.md` had stopped recording Change Records after entry #22, leaving nine CRs, a runbook and all of PR #13 absent from a log whose banner calls it an append-only audit trail of every FMD action.

## 3. Recorded, not fixed

- **The prerender step still does not run on deploy.** Wiring it into `apps/web/vercel.json`'s `buildCommand` requires a Playwright browser download inside the Vercel build and `VITE_PUBLIC_SITE_URL` set in CI. That is a deploy-pipeline decision with real risk of breaking the web deploy, so this pass corrected the claim rather than the pipeline. Until it is wired, the public marketing pages are not crawlable HTML and BUILD §5.2's first and third boxes are honestly `[~]`.
- **`cross-tenant-isolation-suite` may run nowhere.** It is gated on `if: vars.RUN_LIVE_DB_TESTS == 'true'` (`ci.yml`), and it is the only job that runs `packages/db/test/guc-pooler-leak.spec.ts` against Supavisor — `api-integration-suite` excludes that file by name and deliberately. If that repository variable is unset, the GUC-no-leak test that RFC-1 §3 and QAD §3 both rest on is executed by no CI job at all. This cannot be verified from the working tree.
- **A direct push to `dev` deploys without CI.** `ci.yml` triggers on `pull_request` and `push: [main]`; `deploy.yml` triggers on `push: [dev, main]`. Since `main` is 69 commits behind `dev`, the `push: [main]` CI trigger has not fired in a long time, and the lint/typecheck/test gate protects only the PR path.
- **`newman-api-suite` is an `echo` stub** that reports green forever while testing nothing. It is deliberately declared rather than omitted so its absence stays visible, but `ops-arkilaunch.md` §5 lists it among live CI gates, which overstates it. The OPS correction is folded into this pass; the job itself is left alone.
- **Unused type exports** in `packages/shared` and `packages/db` (~19 symbols) were left in place: they are the API contract surface the web app is progressively typing itself against, and `schema/customers.ts`'s `customerAddresses` is a declared Drizzle table that exists in the database — deleting it would desync the schema from the migrations.
- **`packages/db/migrations/meta/`** holds snapshots for only `0001`, `0003` and `0013` of 17 migrations. Harmless for the hand-written SQL migrations, but `drizzle-kit generate` would diff against a baseline predating `0014`-`0016`.
- **`express` is a phantom dependency**, imported in 19 places across `apps/api/src` but declared only as `@types/express`. It resolves transitively through `@nestjs/platform-express`.
- **Two Change Records remain open** on their own terms and are not closed by this pass: `cr-arkilaunch-pilot-honesty.md` (§5 Verification still a placeholder, §6 gate table all `*pending*`) and `cr-arkilaunch-azure-di-provisioning.md`. There is still no `Superseded`/`Closed-by` convention in the CR vocabulary and no Status column in `index.md` §2, so supersession remains untrackable — a process gap this pass records rather than redesigns.

## 4. Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean across all seven workspaces, including `jobs`.
- `pnpm build` — clean, and now compiles `jobs` for the first time.
- `pnpm --filter @arkilaunch/web test` — 67/67 pass after the dead-code removal.
- Every relative link in the rewritten `README.md` resolves (22/22), checked against the filesystem.
- **Not verified locally:** the Dockerfile fix could not be proven by an image build — no Docker daemon was available in this environment. The mechanism was confirmed instead (`jobs/node_modules/@arkilaunch/weather` is a symlink to `../../../packages/weather`, whose `package.json` sets `main: ./dist/index.js`), so omitting the package from the runtime stage necessarily produces `ERR_MODULE_NOT_FOUND`. `deploy.yml`'s build/push step is the covering check.
- **Not run:** the DB-backed suites (`apps/api`, `jobs`, `packages/db`) need a live Postgres and are covered by CI's `api-integration-suite` and `money-path-e2e`. No code on those paths was touched by this pass.

## 5. Pre-merge gate runs

| Agent | Applies? | Verdict |
|---|---|---|
| `tenant-isolation-checker` | No — no auth, query, repository or table code touched | Not run |
| `migration-rls-guardian` | No — no Drizzle schema or migration diff | Not run |
| `edtr-ocr-worker` | No — no OCR, extraction, reconciliation, KYC or deduction-gate code touched | Not run |
| `ai-ocr-abuse-runner` | No — no change to the OCR/AI path | Not run |
| `restraint-guardian` | Yes — non-trivial PR | See §6 |

## 6. Restraint review

`restraint-guardian`'s ladder applies to what this pass *added*, which is deliberately almost nothing: one `COPY` line, one filter in a build script, two gitignore entries, two commented-out env keys, and prose. It removed more than it added. No validation, authz, RLS, a11y or security control was cut — the only deletions to executable code were an unreferenced component and four query factories with zero call sites, and the two ignore-file entries strengthen rather than relax the repo's posture.

The restraint judgement that mattered was on what *not* to do: the prerender wiring, the CI trigger change, the unused shared types, the `newman-api-suite` stub, and the migration snapshots were all left alone and recorded in §3 rather than changed opportunistically inside a cleanup pass.
