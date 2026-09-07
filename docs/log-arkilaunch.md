# Build Session Log (LOG)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Project slug:** arkilaunch
**FMD engine:** 1.28.1
**Platform / model:** Claude Code / Claude Opus 4.8
**Scale:** Full
**Session started:** 2026-07-25

---

> **Agent Instructions**
>
> Append-only audit trail of every FMD action this session. One row per action. Friction goes in §2; field-report distillation in §3 at wrap-up. Survives `exit fmd`.

---

## 1. Action log

| # | Timestamp (UTC) | Trigger / action | Template loaded | Doc written / updated | Gate / verdict | check.py result |
|---|-----------------|------------------|-----------------|----------------------|----------------|-----------------|
| 1 | 2026-07-25 | "Build the FMD" (full suite) | LOG_Template.md | docs/log-arkilaunch.md | n/a | not run |
| 2 | 2026-07-25 | IDEA distill from root thesis | IDEA_Template.md | docs/idea-arkilaunch.md | n/a | not run |
| 3 | 2026-07-25 | Scrutiny Gate on IDEA (web fact-check) | SCRUTINY_Template.md | docs/scrutiny-arkilaunch.md | PROCEED WITH FIXES | not run |
| 4 | 2026-07-25 | Create manifest | INDEX_Template.md | docs/index.md | n/a | not run |
| 5 | 2026-07-25 | BRD (Wave B) | BRD_Template.md | docs/brd-arkilaunch.md | n/a | not run |
| 6 | 2026-07-25 | PRD + UES (Wave C); froze PRD-F1..F8 | PRD/UES templates | docs/prd-arkilaunch.md, docs/ues-arkilaunch.md | n/a | not run |
| 7 | 2026-07-25 | Research-first currency pass (web) | n/a | scratch build-context | n/a | not run |
| 8 | 2026-07-25 | DSD + SDD (Wave D) | DSD/SDD templates | docs/dsd-arkilaunch.md, docs/sdd-arkilaunch.md | n/a | not run |
| 9 | 2026-07-25 | RFC-1/2/3 + QAD (Wave E) | RFC/QAD templates | docs/rfc-arkilaunch-*.md, docs/qad-arkilaunch.md | n/a | not run |
| 10 | 2026-07-25 | SAD + CLR + OPS (Wave F) | SAD/CLR/OPS templates | docs/sad-, clr-, ops-arkilaunch.md | n/a | not run |
| 11 | 2026-07-25 | BUILD + AIA + GTM (Wave G; AIA web-verified) | BUILD/AIA/GTM templates | docs/build-, aia-, gtm-arkilaunch.md | n/a | not run |
| 12 | 2026-07-25 | PITCH + WRAP + VALIDATION + VOICE (Wave H) | PITCH/WRAP/VAL/VOICE templates | docs/pitch-, wrap-, val-, voice-arkilaunch.md | n/a | not run |
| 13 | 2026-07-25 | Materialize root artifacts | materialize.py + README/AIA/SAD | AGENTS.md, BRAND.md, DESIGN.md, MODEL_CARD.md, README.md, CLAUDE.md, .claude/agents/*.md | n/a | n/a |
| 14 | 2026-07-25 | Validate suite | n/a | fixed voice-arkilaunch example phrases + materialization banners | n/a | **0 failures** over generated suite + materialized artifacts (root IDEA.md thesis excepted); 2 warnings cleared |
| 15 | 2026-08-01 | Semantic reconcile / remediation pass (three-agent audit + hand-verification, then fix) | n/a | rfc-arkilaunch-quotation-pricing-engine.md, rfc-arkilaunch-tenancy-rls-auth.md, rfc-arkilaunch-ocr-edtr-reconciliation.md, sdd-arkilaunch.md, sad-arkilaunch.md, qad-arkilaunch.md, ops-arkilaunch.md, clr-arkilaunch.md, aia-arkilaunch.md, ues-arkilaunch.md, scrutiny-arkilaunch.md, prd-arkilaunch.md, dsd-arkilaunch.md, wrap-arkilaunch.md, pitch-arkilaunch.md, index.md, build-arkilaunch.md, IDEA.md; root AGENTS.md, BRAND.md, DESIGN.md, MODEL_CARD.md, LICENSE; .claude/agents/migration-rls-guardian.md, .claude/agents/edtr-ocr-worker.md | n/a | not run (fmd/ not vendored in this repo; see index.md §4) |
| 16 | 2026-08-01 | Doc lock pass ahead of implementation start: web-verified the pinned stack (Vite 8/Rolldown confirmed stable since March 2026; Drizzle `pgPolicy` API confirmed against current orm.drizzle.team/docs/rls, matches the AGENTS.md golden-path shape) with no drift found, then moved PRD, SDD, DSD, QAD, and RFC-1/2/3 from Draft to Locked so the PRD-F7 tenancy scaffold builds against contracts, not drafts | n/a | index.md (status column + Health Check) | n/a | not run |
| 17 | 2026-08-02 | EDTR reconciliation double-approve/double-deduction fix (closes the follow-up deferred by CR #18's predecessor, cr-f4-f5-fleet-weather): `EdtrService.approve()` now locks and jointly transitions both reconciliation rows of a matched pair | n/a | rfc-arkilaunch-ocr-edtr-reconciliation.md §3 addendum, index.md §2 | n/a | not run |
| 18 | 2026-08-02 | PRD-F2 (PayMongo) + PRD-F8 (Bookings) backend implementation, the last two PRD features to get a backend: authenticated `customer` role, bookings as `rentals`+`equipment_assignments`, real PayMongo checkout/webhook adapter (live-verified request/response/signature shape) behind `ENABLE_PAYMENTS`, SECURITY DEFINER webhook tenant lookup | n/a | sdd-arkilaunch.md §4, index.md §2/§5, rfc-arkilaunch-tenancy-rls-auth.md (RBAC catalog note) | n/a | not run |
| 19 | 2026-08-02 | Merged a user-supplied SprintForge visual system into the DSD as a new, scoped Marketing tier (S1/S22 only); kept the Console tier's amber/steel/IBM Plex instrument-panel rules unchanged; landed the Console token layer (Tailwind v4 `@theme`, self-hosted fonts) and first primitives/domain components in `apps/web/` for the first time (`pnpm typecheck`/`lint`/`build` clean, 13 Vitest tests passing, Playwright e2e passing); fixed a pre-existing Vitest/Playwright test-runner collision along the way; also fixed Locked-doc Status/`Last reconciled` header drift on 7 files and a stale "all docs Draft" line in build-arkilaunch.md/AGENTS.md | n/a | dsd-arkilaunch.md, DESIGN.md, BRAND.md, index.md §1/§2/§4/§5, build-arkilaunch.md §1, AGENTS.md §1, prd/sdd/qad/rfc-001/002/003 headers | n/a | not run |
| 20 | 2026-08-02 | Read a user-supplied Figma prototype via the Figma MCP server; found it describes Almara's own single-tenant storefront plus features outside the frozen PRD (negotiation flow, in-app payment capture, Ticket Management, Security Logs, Extend Rental, an Operator role); built the intersection per the user's decisions -- a five-layout route tree with role guards, the five DSD Marketing-tier components, a full storefront landing page (dropped the Figma's ISO 9001 badge and testimonials as unverifiable), a fixture-backed registration flow, and a Playwright build-time prerender closing the BUILD §5.2 crawlability checklist (`pnpm typecheck`/`lint`/`build` clean, 19 Vitest tests passing, Playwright e2e passing, prerender output verified end to end) | user-supplied Figma prototype | sdd-arkilaunch.md §2/§6, build-arkilaunch.md §5.2, voice-arkilaunch.md §2, index.md §1/§2/§4/§5 | n/a | not run |
| 21 | 2026-08-20 | Doc-reconcile audit (triggered by "let me know if there are any reconciliation things we need to do or database failures"): found `cr-arkilaunch-pilot-honesty.md` (2026-08-13) had named RFC-2 §2/§3/§7, QAD §2/§4, and AIA as touched, but `manual_transcription` -- its central mechanism, and the only way a deposit deduction currently gets approved -- was never written into any of the three; also found two CRs recorded as closed while carrying unfilled verification/gate sections, and `index.md` §4 asserting `[x]` on both counts. Wrote back the missing RFC-2/QAD/AIA addenda, corrected two `index.md` §4 rows to `[~]`, bumped PRD/SDD/QAD/RFC-2 header dates, and fixed two code comments that asserted the opposite of what the migration/schema actually does (`0009_tenant_registration.sql`'s false "INSERT revoked" claim; `schema/events.ts`'s false "NULL tenant_id still readable" claim). Separately ran a static DB audit (RLS clean across all 32 tenant tables; found a `tenants`/`equipment_types`/`subscription_plans` grant hole and a no-migrate-step gap in `deploy.yml`) but could not execute the live test suites -- no reachable Docker daemon in this environment -- so pass/fail state of `pnpm test` remains unconfirmed and is flagged as such rather than assumed | n/a | rfc-arkilaunch-ocr-edtr-reconciliation.md, qad-arkilaunch.md, aia-arkilaunch.md, prd-arkilaunch.md, sdd-arkilaunch.md, index.md §1/§2/§4, packages/db/migrations/0009_tenant_registration.sql, packages/db/src/schema/events.ts | n/a | not run |
| 22 | 2026-09-07 | PRD §9 **M4 (Testing & QA) iteration 1**, scoped by the user to correctness fixes plus real CI gates: closed the reconciliation false-accept that M4's own risk column names (`reconcileEdtr()` compared one summed `hours_active + hours_idle` scalar per log, so an 8h-active/0h-idle sheet matched a 0h-active/8h-idle counterpart at `delta_hours = 0` while `approve()` prices active hours alone — `evaluateGate()` now requires active, idle, AND the summed total to sit within tolerance, the total kept deliberately so the new gate cannot be looser than the old one for same-signed errors, and `delta_hours` stores the worst dimension via a `worstDelta()` shared with the gate so the stored number can never disagree with the one that decided it); closed the `tenants`/`equipment_types`/`subscription_plans` grant hole (migration `0016`: 0002 granted all four verbs, 0007 narrowed only UPDATE/DELETE and only on `tenants`, so INSERT on `tenants` was still live — self-approving a tenant past the PRD-F6 KYC gate in `tenants_register()` — the two global catalogues were rewritable by any authenticated tenant, and `tenants` had no RLS at all so the platform's whole customer list was cross-tenant readable); and turned `money-path-e2e` and `ocr-accuracy-gate` from `echo` stubs into jobs that actually run, giving QAD-T26/T40 CI enforcement for the first time. Three adjacent defects found while proving the first fix: a log with zero `edtr_line_items` summed to zero in every dimension and so auto-accepted on no evidence (now fails closed); `approve()` replaced the whole `adjustments` jsonb with the human's hours, erasing the machine's own `reason` that `get()` reads (now merges, per `reject()`'s existing precedent); and `delta_hours`' definition had drifted across SDD §3, RFC-2 §4, and PRD §5.6. Deliberately **not** claimed: `ocr-accuracy-gate` does not assert >= 90.06% (synthetic golden set at 6/8, `arkilaunch-edtr-neural-v1` still untrained), no QAD §6 release box is ticked, and the DB-backed suites could not be executed in this environment — no Docker daemon and no local Postgres, and `.env` points at a live Supabase with pilot data — so they are verified by the PR's own CI run, not by a local pass. Also added the `.github/pull_request_template.md` that `cr-arkilaunch-pilot-honesty.md` §6 said it had added but never did | build-arkilaunch.md §5.1 | rfc-arkilaunch-ocr-edtr-reconciliation.md header/§2/§4, qad-arkilaunch.md header/§4/§6, sdd-arkilaunch.md header/§3/§4, prd-arkilaunch.md header/§5.6, index.md §1/§2/§4; packages/shared/src/edtr.ts, packages/shared/src/ocr-accuracy.ts, packages/db/src/reconciliation.ts, packages/db/migrations/0016_reference_table_grants.sql, apps/api/src/edtr/edtr.service.ts, apps/api/test/money-path.spec.ts, packages/db/test/rls-enumeration.spec.ts, .github/workflows/ci.yml, .github/pull_request_template.md | n/a | **not run locally** (no Docker daemon, no local Postgres); non-DB suites pass: shared 62, document-intelligence 8, weather 10, web 67; `lint`/`typecheck`/`build` clean. CI on PR #6 then executed the DB-backed suites: `money-path.spec.ts` **passed**; the new privilege assertion correctly found one further global-table write grant (`diesel_price_readings:INSERT`, justified by RFC-3's platform-admin manual-entry route, now allowlisted as `table:VERB` so a widened grant still fails); and it exposed a date collision of my own making — `money-path.spec.ts` took 2021-04-0X to avoid `edtr-engine.spec.ts` but `ai-abuse.spec.ts` already held 2021-04-01/02 on the same seeded rental, so parallel specs paired against each other's rows and broke AI-04 (moved to 2021-06-0X). Also fixed a **pre-existing** red `lint-typecheck-build`: it typechecked without building the workspace packages, failing TS2307 on document-intelligence and weather on every run since those landed; reproduced locally by deleting `packages/*/dist` before fixing. Left red and pre-existing: the 9 `api-integration-suite` failures across users-admin/billing-engine/refresh-rotation, unrelated to this pass, deferred to M4 iteration 2 |

---

## 2. Friction (engine feedback)

| # | Area | What happened | Candidate flag / fix |
|---|------|---------------|----------------------|
| 1 | source | Root `IDEA.md` is a 2,351-line capstone thesis, not the FMD IDEA shape. Build distilled it into `docs/idea-arkilaunch.md` before the gate. Working as intended, worth noting for academic inputs. | Accepted; AGENTS handles root IDEA.md as source/pointer. |
| 2 | idea | The thesis carried unresolved tensions (SaaS vs single-client with no tenant table; Azure DI vs zonal-OCR; unnamed payment gateway + diesel source). Resolved by four user decisions, not the template. | Accepted; captured as scrutiny gaps + divergence notes. |
| 3 | orchestration | Parallel doc subagents edited the shared `index.md` / `log` concurrently, causing minor drift; the orchestrator took ownership of both. A mid-build org spend limit then terminated several subagents (after they wrote their files), so the rest were authored inline. | Minor: document "orchestrator owns index + log; content agents never edit them." |
| 4 | validator / materialize | `check.py` voice flagged the `materialize.py` banner because the HTML comment close `-->` reads as a spaced `--`. It also voice-scans the root `IDEA.md` thesis (G15), which is the user's source doc. | Candidate fix: materialize.py banner should avoid `-->`, or check.py should skip HTML comments + non-generated root IDEA.md. |
| 5 | validator / process | Entry #14's "0 failures" was a lint/voice pass, not a semantic reconcile: it caught formatting and banned-phrase violations but not stale "pending"/"Wave N" claims left behind when later waves shipped, an under-specified RLS policy a downstream RFC introduced, a table-count drift across four files, or an arithmetic double-count in the UES. A 2026-08-01 audit (three parallel review agents plus hand-verification of every finding against the actual files) found ~45 such defects across the suite; see index.md's Health Check and Notes for the fix summary. | Candidate engine fix: `check.py` (or a companion pass) should include cross-doc semantic checks, not only per-file lint/voice: numeric consistency (table counts, arithmetic totals) and staleness detection (a doc marked "pending Wave N" when that wave's target file already exists on disk). |

---

## 3. Field report distillation (for FMD maintainers)

**Engine version:** 1.28.1
**Project:** ArkiLaunch (arkilaunch)
**Scale:** Full
**Platform / model:** Claude Code / Claude Opus 4.8
**Outcome:** Full FMD suite generated (19 suite docs + this index, 20; plus 3 RFCs = 23 `docs/*.md` files total) + materialized root artifacts; validator green over the generated suite as of this session's lint/voice pass (see entry #15 and friction #5 for the 2026-08-01 semantic-reconcile follow-up). Implementation not started.

**Routing / gate / fill summary:**

- "Build the FMD" on a thesis-as-IDEA: distilled to FMD shape, Scrutiny PROCEED WITH FIXES, then full Wave A to H generation with frozen PRD-F1..F8 traceability.
- Four decision points confirmed with the user up front (scope, OCR engine, payments, stack) kept the suite internally consistent.

**Friction items (map to flag register):**

| # | Severity guess | Description | Suggested owner doc |
|---|----------------|-------------|---------------------|
| 1 | Minor | Parallel agents editing shared index/log drift | AGENTS (orchestration note) |
| 2 | Minor | materialize.py banner `-->` trips the voice `--` check | scripts/materialize.py or check.py |
| 3 | Accepted | check.py G15 voice-scans a non-FMD root IDEA.md (a long academic thesis) | check.py / AGENTS note |

**Validator last run:** 0 failures over `docs/` generated suite + materialized artifacts (2026-07-25); root `IDEA.md` thesis fails voice by design (user source doc).
**Field report filed:** pending (candidate `benchmarks/field-reports/fr-arkilaunch-20260725.md`).

---

## Self-Check

- [x] Every FMD action this session has a row in §1
- [x] §2 records friction
- [x] At WRAP: §3 filled; `fr-*.md` path named as pending
- [x] Log referenced in `docs/index.md`
