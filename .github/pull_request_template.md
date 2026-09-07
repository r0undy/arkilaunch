<!-- Promised by docs/cr-arkilaunch-pilot-honesty.md §6 and added by
     docs/cr-arkilaunch-m4-money-path-gates.md, which found it had never
     actually landed. Its purpose: make an unrun pre-merge gate visible in
     the PR body rather than discovered ten Change Records later. -->

## What this changes

<!-- One paragraph. Name the PRD-F#, RFC §, or QAD-T# this serves. -->

## Change Record

<!-- Locked docs (PRD, SDD, DSD, QAD, RFC-1/2/3) may not drift without one.
     Link the docs/cr-arkilaunch-*.md for this pass, or state why none is
     needed (e.g. no Locked doc is affected). -->

- CR:

## Pre-merge gates (AGENTS.md §2)

Record a verdict or an explicit reason for skipping. "Not run" is an
acceptable answer; silence is not.

| Agent | Applies when | Verdict |
|---|---|---|
| `tenant-isolation-checker` | any diff touching auth, queries, repositories, or new tables | |
| `migration-rls-guardian` | any Drizzle schema or migration diff | |
| `edtr-ocr-worker` | OCR, extraction, reconciliation, KYC, or deduction-gate changes | |
| `ai-ocr-abuse-runner` | any change to the OCR/AI path | |
| `restraint-guardian` | any non-trivial PR | |

## Verification

<!-- Commands actually run, and their real result. If a suite could not be
     executed in this environment (no Docker, no local Postgres), say so and
     name the CI job that covers it instead of implying it passed. -->

- [ ] `pnpm lint && pnpm typecheck && pnpm build`
- [ ] Unit suites that need no database
- [ ] DB-backed suites (locally, or by the CI job that runs them)

## Money-path and tenancy checklist

Delete any line that genuinely does not apply — do not tick it blind.

- [ ] No deposit deduction can fire from extraction output without a passing
      reconciliation or explicit human approval (RFC-2).
- [ ] No `tenant_id` is taken from client input; it is derived from the
      verified JWT (RFC-1).
- [ ] No `service_role` or other superuser on a request path.
- [ ] New tenant-owned tables have `tenant_id` + ENABLE + FORCE RLS + a
      `tenant_isolation` policy scoped to `app_authenticated`.
- [ ] New global tables are read-only to `app_authenticated`, or the write
      grant is justified here.
