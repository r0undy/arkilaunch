# Wrap & Next Steps (WRAP)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with outcome)
**IDEA:** [idea-arkilaunch.md](idea-arkilaunch.md)
**PITCH:** [pitch-arkilaunch.md](pitch-arkilaunch.md)

---

> Blameless retro on the documentation build, plus the continuation path into implementation. Systems and decisions, not individuals.

---

## 1. Outcome Snapshot

**Event / sprint:** FMD full-suite documentation build for ArkiLaunch, distilled from the capstone thesis.

**Result:** Complete Full-scale FMD suite generated: IDEA, SCRUTINY (PROCEED WITH FIXES), VALIDATION, VOICE, BRD, UES, PRD, DSD, SDD, three RFCs, QAD, SAD, BUILD, CLR, AIA, GTM, OPS, PITCH, WRAP, plus the index and session log. Implementation has not started; the suite is the deliverable of this sprint.

**What shipped:** a cross-linked, traceable documentation suite with frozen feature IDs (PRD-F1..F8), a currency-verified pinned stack, resolved architecture (multi-tenant RLS, Azure DI OCR + reconciliation, diesel-indexed pricing), and the compliance + AI-assurance registers.

**What we cut and don't regret:** ML demand forecasting, IoT/GPS, native card-data handling, and fully automated government-portal verification. All are explicit out-of-scope, and cutting them keeps V1 shippable and lawful.

**What we cut and should revisit:** per-equipment-type fuel-consumption overrides in pricing (deferred as documented tech debt in RFC-3), read replicas / Redis caching (SDD V1 tech debt), and multi-yard support (post-MSME segment, GTM secondary audience).

---

## 2. Keep / Cut / Borrow

| Category | Item | Rationale |
|----------|------|-----------|
| **Keep** | The multi-tenant SaaS framing with Almara as anchor tenant | Gave the BRD/UES/GTM real substance and matched the thesis SaaS narrative |
| **Keep** | Confidence gate + double-entry reconciliation as the money-path guardrail | The single control that lets an imperfect OCR system be safe to bill on |
| **Cut** | The thesis's "deterministic zonal OCR vs Azure DI" contradiction | Resolved to Azure DI labeled extraction (the zonal idea, ML-backed) and stated as a documented divergence |
| **Borrow** | The shared build-context file pattern (one source of truth for all doc agents) | Reusable for any future FMD build to keep parallel agents consistent |

---

## 3. Learnings (blameless)

**What worked:**

- Front-loading the four decision questions (scope, OCR, payments, stack) meant the whole suite stayed internally consistent from IDEA onward.
- The research-first currency pass caught real issues (Open-Meteo commercial licensing, ISO 25010 2023 revision, Azure prebuilt-ID scope) before they hardened into wrong specs.
- Freezing PRD-F1..F8 early let downstream docs trace cleanly without renumbering.

**What didn't:**

- Parallel doc agents editing the shared index and log caused minor drift; the orchestrator took over both to fix it.
- A mid-build org spend limit killed several subagents; the orchestrator switched to inline authoring to finish the suite.

**Process notes (FMD / agents / tools):**

| Tool / doc | Helped / Hurt | Note |
|------------|---------------|------|
| Scrutiny Gate fact-check | Helped | Verified market/tooling claims and surfaced the Open-Meteo commercial-licensing gap |
| Shared build-context file | Helped | Kept parallel agents on one set of decisions and versions |
| Parallel subagents writing index/log | Hurt | Concurrency drift; fixed by making the orchestrator own index + log |
| Concept-visual generation (taste-skill) | Absent | Image tooling unavailable this session; visual direction captured textually in DSD §0 |

---

## 4. Scale & Continuation

**Decision:** Continue (into implementation).

| FMD doc | Action | Owner | Target date |
|---------|--------|-------|-------------|
| PRD | Lock v1 after review; the frozen PRD-F# are the build contract | Product | Before implementation |
| DSD | Generate concept visuals (still not-yet-generated); BRAND.md / DESIGN.md re-materialized 2026-08-01 per the §9 contract | Design | Concept visuals: before UI build |
| SDD | Lock; the RFC-1 `refresh_tokens` and RFC-3 `diesel_price_readings`/`pricing_parameters` tables were folded into the §3 catalog 2026-08-01 (35 tables total) | Architect | Before implementation |
| BUILD | Root `AGENTS.md` materialized 2026-08-01 with `docs/`-prefixed links; Cursor/Gemini pointers remain genuinely optional and not yet generated; keep the stack-currency register live | Eng | Cursor/Gemini pointers: when those tools' users join |
| CLR | Clear the counsel-review flags (RA 10173 cross-border, KYC) before launch | Compliance | Before public launch |
| AIA | Clear the Azure DI residency + KYC escalations (AIA §4) before launch | Compliance | Before public launch |
| OPS | Wire the SLOs + alerts once the system is deployed | Eng | Before production |

**README:** `README.md` exists at the project root, materialized from the README template.

---

## 5. Production Readiness Gate (final check)

*Documentation is complete; the gate is at the documentation level until code exists.*

- [~] Security reviewed (SDD §5 + RFC-1 designed; verify on code)
- [x] CLR complete (register drafted; counsel-review flags open, tracked)
- [x] AIA complete (dossier drafted; escalation flags open, tracked)
- [x] Context hygiene designed (uploads/extraction untrusted; no autonomous money movement)
- [~] QAD Must-Have happy/sad/abuse specified (execute on code)
- [x] OPS SLOs, alerts, rollback drafted
- [x] BUILD stack pinned; PRD §9 rollback documented
- [x] DSD §8 gate defined (verify on built UI)

**Gate status:** Pass at the documentation level. Not yet a shippable-system pass: implementation, the QAD execution, and the CLR/AIA counsel clearances remain before a real launch.

---

## 6. Owned Next Steps

| # | Action | Owner | Due | Lands in |
|---|--------|-------|-----|----------|
| 1 | Lock PRD/SDD (root artifacts already materialized: AGENTS.md, BRAND.md, DESIGN.md, README.md, MODEL_CARD.md, and the 5 `.claude/agents/`) | Eng | Implementation start | root files + docs |
| 2 | Build the core slice (PRD-F3 OCR billing + PRD-F1 quote + PRD-F7 tenancy) for Almara | Eng | Pilot | code |
| 3 | Clear CLR + AIA counsel/residency flags | Compliance | Before public launch | CLR / AIA |
| 4 | Measure recovered billable hours at Almara (BRD-M8 baseline) | Product | Pilot | GTM / UES |

---

## 7. Engine feedback (field report)

**Friction summary:**

- Root `IDEA.md` was a 2,351-line thesis, not the FMD IDEA shape; the build distilled it first (working as intended, worth noting for other academic inputs).
- The thesis carried unresolved internal tensions (SaaS vs single-client with no tenant table; Azure DI vs zonal-OCR; unnamed payment gateway and diesel source), resolved by the four user decisions rather than by any template.
- Parallel doc agents editing `index.md` / `log-*.md` concurrently caused drift; making the orchestrator own both fixed it.
- An org monthly spend limit terminated several subagents mid-run (after they had written their files); the orchestrator switched to inline authoring.

**Candidate engine improvements:**

| # | Area | Issue | Suggested fix | Severity |
|---|------|-------|---------------|----------|
| 1 | AGENTS / orchestration | Parallel agents editing the shared index/log drift | Document a rule: the orchestrator owns index.md + log; content agents never edit them | Minor |
| 2 | templates | No explicit guidance for distilling a long-form academic thesis into the IDEA shape | Add a note to IDEA/SCRUTINY on academic-thesis inputs | Accepted |

**Field report filed:** pending (candidate `benchmarks/field-reports/fr-arkilaunch-20260725.md`; file into the FMD source repo if the team wants these upstreamed).

---

## Self-Check

- [x] Keep/cut list is honest (real cuts named)
- [x] Scale & Continuation names concrete FMD docs and actions
- [x] Production Readiness Gate verified at the documentation level; remaining blockers documented
- [x] Every next step has an owner and target
- [x] Session-log friction distilled; field report named as pending
- [x] AGENTS hard bans applied (no em-dashes)
- [x] Repo + docs live at the arkilaunch project root; suite under `docs/`
