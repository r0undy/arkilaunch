> Materialized from docs/build-arkilaunch.md by scripts/materialize.py on 2026-07-25. Do not hand-edit; edit the canonical doc and re-run.

# Project Build Guide

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with code)
**PRD:** [docs/prd-arkilaunch.md](docs/prd-arkilaunch.md)
**SDD:** [docs/sdd-arkilaunch.md](docs/sdd-arkilaunch.md)
**SAD:** [docs/sad-arkilaunch.md](docs/sad-arkilaunch.md)

---

> The spec-to-code bridge for ArkiLaunch. Materializes to the project root `AGENTS.md`. Stack pinned and currency-verified 2026-07-25. This guide overrides training memory where the two conflict.

---

## 1. How to Build From These Docs

The documentation suite is the source of truth. Read in this order before writing code:

1. **`docs/index.md`**; what exists, each doc's status, what's stale. Start here every session.
2. **SCRUTINY** ([docs/scrutiny-arkilaunch.md](docs/scrutiny-arkilaunch.md)); verified claims and the carried-gap register (`G-1`..`G-10`) that every downstream doc resolves against.
3. **BRD** ([docs/brd-arkilaunch.md](docs/brd-arkilaunch.md)); the business case, `BRD-M#` metrics, `BRD-V#` impact variables.
4. **PRD** ([docs/prd-arkilaunch.md](docs/prd-arkilaunch.md)); features PRD-F1..F8, user stories, flows, §7 AI spec, §9 rollback, §NFR.
5. **SDD** ([docs/sdd-arkilaunch.md](docs/sdd-arkilaunch.md)); architecture, 35-table schema, APIs, §5 security/RLS, §8 AI architecture.
6. **RFCs**; [rfc-001 tenancy-rls-auth](docs/rfc-arkilaunch-tenancy-rls-auth.md), [rfc-002 ocr-edtr-reconciliation](docs/rfc-arkilaunch-ocr-edtr-reconciliation.md), [rfc-003 quotation-pricing-engine](docs/rfc-arkilaunch-quotation-pricing-engine.md).
7. **DSD** ([docs/dsd-arkilaunch.md](docs/dsd-arkilaunch.md)); the Yardboard design system, tokens, components, a11y.
8. **QAD** ([docs/qad-arkilaunch.md](docs/qad-arkilaunch.md)); test matrix and release criteria.
9. **CLR** ([docs/clr-arkilaunch.md](docs/clr-arkilaunch.md)); PH data-privacy register, KYC, scraping posture.
10. **AIA** ([docs/aia-arkilaunch.md](docs/aia-arkilaunch.md)); AI assurance for the Azure DI OCR component.
11. **OPS** ([docs/ops-arkilaunch.md](docs/ops-arkilaunch.md)); SLOs, alerts, runbooks.
12. **This guide**; stack conventions, patterns, guardrails.

**Only build against `Locked` docs.** PRD, SDD, DSD, QAD, and RFC-001/002/003 are `Locked` per `docs/index.md` §1; the remaining suite docs stay `Draft`. Lock a doc before building against it, or flag and do not guess. If reality diverges from a Locked doc, trigger a Change Record (`docs/cr-arkilaunch-*.md`), do not silently code around it.

**Re-ground triggers (anti context-rot):** reload `docs/index.md` + Locked PRD/SDD (and any active change proposal) at session start, after any CR is Applied, before brownfield `apply change`, and after a long tool/search detour.

### Traceability map; "to build X, read Y"

| To implement… | Read | Then verify against |
|---------------|------|---------------------|
| A feature `PRD-F#` | PRD §3/§4 → SDD components → the `rfc-…` for it | QAD scenarios tagged with its `US-##` |
| The multi-tenant data layer | SDD §3 → RFC-1 | QAD cross-tenant isolation rows |
| Auth / identity / RBAC | SDD §5 → RFC-1 | QAD auth + refresh-reuse abuse rows |
| A schema change / migration | SDD §3 → RFC Data Model Changes | expand/contract strategy; migration-rls-guardian (SAD-A2) |
| The OCR / reconciliation / KYC path | SDD §8 → RFC-2 | QAD AI-01..AI-06 + AIA risk register |
| The quotation / diesel engine | SDD §3/§4 → RFC-3 | QAD `QAD-T43`..`T48` rows (§3.6) |
| A UI surface | DSD §4 + PRD §5.1 (screen states) + §5.2 (navigation) | DSD a11y + §0 compliance |
| Public marketing/booking discoverability | BUILD §5.2 + GTM §8 | robots.txt live; indexability checklist; CLR training-vs-search decision |

---

## 2. Subagents

Specialist build agents are defined in the SAD ([docs/sad-arkilaunch.md](docs/sad-arkilaunch.md)) and materialized to `.claude/agents/`: `tenant-isolation-checker`, `migration-rls-guardian`, `edtr-ocr-worker`, `ai-ocr-abuse-runner`, `restraint-guardian`. Spawn them per SAD §4. The tenant-isolation and migration-RLS guards run on every data/schema diff; the abuse-runner gates any AI-path merge.

---

## 3. Stack Currency & Deprecations

> Do not rely on training memory for fast-moving framework conventions. Verify against the pinned version's official docs before writing framework code. If you cannot verify, say so and ask; do not emit a plausible-but-stale API. Model cutoff is January 2026; the versions below were verified 2026-07-25.

### Pinned stack

| Layer | Technology | Pinned version | Verified | Authoritative source |
|-------|------------|----------------|----------|----------------------|
| Language | TypeScript | 5.7 | 2026-07-25 | typescriptlang.org |
| Frontend framework | React | 19.2 | 2026-07-25 | react.dev/versions |
| Frontend build | Vite | 8.0 (Rolldown bundler) | 2026-07-25 | vite.dev/blog/announcing-vite8 |
| Routing / data | TanStack Router 1.121 + TanStack Query 5.90 | 1.121 / 5.90 | 2026-07-25 | tanstack.com |
| Styling | Tailwind CSS | 4.1 | 2026-07-25 | tailwindcss.com |
| Client validation | Zod | 4.0 | 2026-07-25 | zod.dev |
| Backend framework | NestJS | 11.1 (SWC compiler, Vitest default) | 2026-07-25 | docs.nestjs.com |
| Runtime | Node.js | 24 LTS | 2026-07-25 | nodejs.org |
| ORM | Drizzle ORM | 0.44 (pgPolicy RLS) | 2026-07-25 | orm.drizzle.team/docs/rls |
| Database + storage | Supabase (PostgreSQL + Storage) | n/a; managed platform (Postgres 17) | 2026-07-25 | supabase.com/docs |
| Auth | Passport-JWT in NestJS (@nestjs/passport) | passport-jwt 4.0, @nestjs/passport 11.x | 2026-07-25 | docs.nestjs.com/security/authentication |
| OCR / IDP | Azure AI Document Intelligence (Foundry Tools) | doc-intel 4.x | 2026-07-25 | learn.microsoft.com/azure/ai-services/document-intelligence |
| Payments | PayMongo (Hosted Checkout + webhooks) | n/a; managed API, no client SDK version to pin | 2026-07-25 | paymongo.com/docs |
| Weather | Open-Meteo (commercial plan) | n/a; versionless HTTP API | 2026-07-25 | open-meteo.com |
| Backend hosting | Azure Container Apps (app + ACA Jobs cron) | n/a; managed platform | 2026-07-25 | learn.microsoft.com/azure/container-apps/jobs |
| Frontend hosting | Vercel (Edge) | n/a; managed platform | 2026-07-25 | vercel.com/docs |
| Edge security | Cloudflare (WAF + L3/L4/L7 DDoS) | n/a; managed platform | 2026-07-25 | developers.cloudflare.com |
| Unit tests | Vitest | 3.2 | 2026-07-25 | vitest.dev |
| E2E tests | Playwright | 1.55 | 2026-07-25 | playwright.dev |
| API tests | Postman / Newman | Newman 6.2 | 2026-07-25 | postman.com |

**Reading the "n/a" rows:** six rows above are managed platforms or versionless HTTP APIs (Supabase, PayMongo, Open-Meteo, Azure Container Apps, Vercel, Cloudflare); there is no package/client version to pin, so "n/a" is an honest terminal value, not an unfilled one. Every row backed by an installable package or SDK carries an exact version.

### Deprecations & convention changes; DO NOT use the stale form

This register **overrides training memory**. It records the deliberate divergences from the thesis stack (each is a defensible best-practices decision, not a gratuitous change) plus version traps. Add a row whenever drift is caught.

| Stale / avoided | Current convention for ArkiLaunch | Since / why | Source |
|-----------------|-----------------------------------|-------------|--------|
| Prisma ORM (thesis) | **Drizzle ORM** with in-schema `pgPolicy` RLS | First-class, reviewable RLS for a multi-tenant system; avoids the "owner connection bypasses RLS" trap Prisma extensions must work around | orm.drizzle.team/docs/rls |
| Backend on Vercel serverless (naive reading) | **Azure Container Apps** (persistent API) + **ACA Jobs** (cron) | Serverless cannot run the weather poll, diesel refresh, PM notifications, or async OCR workers; a persistent host + scheduled jobs can. Vercel hosts the frontend only | learn.microsoft.com/azure/container-apps/jobs |
| Supabase GoTrue as session authority | **NestJS/Passport-JWT** as the single identity authority; RLS driven by app-injected GUCs | We connect directly to Postgres via Drizzle, so `auth.uid()` binding does not apply; one issuer owns identity + the RBAC tables | docs.nestjs.com/security/authentication |
| `service_role` / owner DB connection on request paths | Dedicated **non-BYPASSRLS** app role; `service_role` only for migrations + trusted cron | RLS is only enforced for non-superuser, non-owner roles | supabase.com/docs (RLS) ; RFC-1 |
| Axios | Native `fetch` (thin typed wrapper) | Universal, no extra dependency; Axios optional | developer.mozilla.org |
| class-validator / class-transformer | **Zod** (+ `nestjs-zod`) end to end | One schema shared client and server; less duplication | github.com/BenLorantfy/nestjs-zod |
| `prebuilt-idDocument` for PH corporate docs | Azure DI **layout + query fields / custom neural** | prebuilt ID model covers only US licenses + international passports, not PH SEC/TIN | learn.microsoft.com (id-document) |
| Open-Meteo free tier for production | Open-Meteo **commercial plan** | Free tier is non-commercial (10k/day, CC BY 4.0); ArkiLaunch is a commercial SaaS | open-meteo.com/en/about |
| Only Vitest + Postman (thesis) | Add **Playwright** for E2E | The money paths (OCR->deduction, quote->payment) need browser-level happy/sad/abuse coverage | playwright.dev |

**Fast-moving deps that require live verification before coding:** Azure AI Document Intelligence SDK/API (model IDs, query-fields, regions), Supabase RLS + Supavisor pooler behavior with `set_config(local=true)`, Drizzle RLS API, PayMongo API + webhook signature scheme, React 19 / Vite 8 build config. Verify the exact API shape against current docs every time.

**Self-anneal:** when drift is found, add a row here and, if behavior changed, consider a CR.

---

## 4. Golden-Path Patterns

> Version-tagged and dated. Confirm against §3 before copying. Update and re-date when a sample drifts.

### Tenant-scoped repository call (RLS GUC transaction) · *verified 2026-07-25 against Drizzle + Postgres/Supabase*

```typescript
// Every request runs inside a transaction that sets the tenant/user/role GUCs
// BEFORE any query, so Postgres RLS filters rows. The app connects as a
// non-BYPASSRLS role; service_role is never used here. See RFC-1.
export async function withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant_id', ${ctx.tenantId}, true)`);
    await tx.execute(sql`select set_config('app.current_user_id',  ${ctx.userId},   true)`);
    await tx.execute(sql`select set_config('app.current_role',     ${ctx.role},     true)`);
    return fn(tx); // all queries here are RLS-scoped to ctx.tenantId
  });
}
```

*Why this shape:* `local=true` binds the GUC to the transaction, so a pooled (Supavisor) connection cannot leak tenant context across requests. RLS is the backstop; never rely on an app-level `where tenant_id = ?` alone.

### NestJS endpoint: JWT guard + RBAC + Zod validation · *verified 2026-07-25 against NestJS 11.1*

```typescript
@Controller('quotes')
@UseGuards(JwtAuthGuard, PermissionsGuard) // Passport-JWT identity + RBAC
export class QuotesController {
  @Post()
  @RequirePermission('quote:create')
  async create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const dto = CreateQuoteSchema.parse(body);      // Zod at the boundary; reject bad input
    return withTenantTx(req.ctx, (tx) =>            // RLS-scoped
      this.quotes.createDraft(tx, dto),
    );
  }
}
```

*Why this shape:* identity, authorization, input validation, and tenant isolation are all enforced before any business logic. No client-supplied `tenant_id` is ever trusted; it comes from the verified JWT.

### Azure DI extraction with confidence gate + no autonomous money movement · *verified 2026-07-25 against Azure DI doc-intel 4.x*

```typescript
// EDTR extraction never triggers a deduction on its own. See RFC-2 / SDD §8.
const result = await docIntel.analyze(customEdtrModelId, imageStream);
const fields = mapFields(result); // { value, boundingRegion, confidence } per field
const lowConfidence = fields.some((f) => f.confidence < CONFIDENCE_GATE); // default 0.90
const reconciliation = reconcile(fields, counterpartLog, TOLERANCE_HOURS); // +/- 0.25h

if (lowConfidence || !reconciliation.withinTolerance) {
  await queueForHumanReview(edtrId, fields, reconciliation); // HITL; NO deduction
} else {
  await markAutoVerified(edtrId, fields, reconciliation);    // eligible; deduction still needs approval
}
// Deposit deduction fires only from an explicit verified/approved reconciliation, never here.
```

*Why this shape:* uploaded images and model output are untrusted; the confidence gate plus reconciliation plus human-in-the-loop keep an extraction error from silently deducting a client's deposit (the core financial-integrity control).

---

## 5. Conventions & Guardrails

**Repo layout:** `apps/web/` (React + Vite frontend) · `apps/api/` (NestJS backend) · `packages/db/` (Drizzle schema + migrations + RLS policies) · `packages/shared/` (Zod schemas shared client/server) · `jobs/` (ACA Job entrypoints: weather, diesel, pm-notify, ocr-reconcile).

**Naming:** kebab-case files; PascalCase React components + Nest classes; snake_case DB columns; `PRD-F#` / `US-##` referenced in PR titles for traceability.

**Always:**
- Validate external input at the boundary with Zod (shared schema).
- Run every DB access inside the tenant RLS transaction; connect as the non-BYPASSRLS role.
- Verify a webhook signature (PayMongo) and make handlers idempotent.
- Keep secrets in env only (Azure DI keys, PayMongo keys, DB creds, JWT signing keys).

**Never:**
- Trust a client-supplied `tenant_id`; derive it from the verified JWT.
- Deduct a deposit from OCR output without a passing reconciliation or explicit human approval.
- Use `service_role` on a request path.
- Use a deprecated pattern from §3 because it "looks right" from memory.

**Tests:** every Must-Have ships with its QAD happy + sad + abuse paths; the AI path must pass AI-01..AI-06. Run `pnpm test` (Vitest) + `pnpm e2e` (Playwright) before claiming done.

### Restraint / YAGNI (ponytail)

Stop at the first rung that holds: (1) does it need to exist? (2) already in the codebase? (3) stdlib? (4) native platform feature? (5) installed dependency? (6) one line? (7) the minimum that works. **Never on the chopping block:** input validation, error handling, security checks, RLS/tenant isolation, accessibility, or anything the QAD/CLR/AIA requires. The `restraint-guardian` (SAD-A5) enforces this without cutting a required control.

### Session brevity (caveman)

Optional agent-chat compression only. Never rewrite Locked docs, VOICE, PITCH, WRAP, or any `docs/*.md` into caveman-speak.

## 5.1 Brownfield Change Workflow

Once the code is live and PRD/SDD are Locked, prefer the Change Workflow over re-running "Build the FMD": `explore change` -> `propose change {slug}` -> validate -> review -> `apply change` -> `verify change` -> `archive change`. This is the FMD engine's own workflow (an external tool this repo does not vendor); reproduce these steps manually against `docs/cr-arkilaunch-*.md` if the engine tooling is unavailable. Locked PRD/SDD drift -> CR in the same pass as archive.

## 5.2 Public Surface & Crawler Policy

> ArkiLaunch has two public surfaces: a marketing site and the customer booking/quote portal entry (the tenant app itself is authenticated and must not be indexed). Allow search bots on public pages; the authenticated app is `noindex`.

**Public URL(s):** marketing site + customer booking portal (domain TBD at deploy). The authenticated tenant app and admin dashboards are private and carry `noindex`.

### Indexability checklist

- [ ] Public marketing/booking pages are crawlable HTML (server-rendered or pre-rendered, not empty client shells)
- [ ] `sitemap.xml` published for public pages only
- [ ] Canonical URLs set on public pages
- [ ] Authenticated app routes carry `noindex` and are excluded from the sitemap

### robots.txt policy

| Bot | Owner | Purpose | Our rule | Notes |
|-----|-------|---------|----------|-------|
| Googlebot | Google | Web search | Allow (public pages) | app routes disallowed |
| Google-Extended | Google | AI training | Disallow (pending CLR) | training decision -> CLR |
| OAI-SearchBot | OpenAI | ChatGPT search | Allow (public pages) | not the same as GPTBot |
| GPTBot | OpenAI | Model training | Disallow (pending CLR) | training decision -> CLR |
| ChatGPT-User | OpenAI | User fetches | Allow | user-initiated |
| Claude-SearchBot | Anthropic | Claude search | Allow (public pages) | citations |
| ClaudeBot | Anthropic | Training | Disallow (pending CLR) | training decision -> CLR |
| Claude-User | Anthropic | User fetches | Allow | user-initiated |
| PerplexityBot | Perplexity | Search / answers | Allow (public pages) | |

**robots.txt path:** `/robots.txt` · **Last reviewed:** 2026-07-25. Default: allow search bots on public marketing/booking pages; disallow all bots on `/app/*` and admin routes; training-crawler decision deferred to [CLR](docs/clr-arkilaunch.md) (B2B IP posture, conservative default is disallow).

### Schema.org

Organization + SoftwareApplication on the marketing site; no schema on authenticated app pages. Only markup that matches visible content.

### llms.txt

| Surface | llms.txt? | URL |
|---------|-----------|-----|
| Public docs / API | Optional | TBD |
| Marketing site | Skip | n/a |

### Semantic HTML / a11y

Landmarks, ordered headings, meaningful link text (also a DSD §6 requirement). Same practices that help assistive tech help crawlers parse the page.

**Cross-links:** answer-surface strategy -> [GTM §8](docs/gtm-arkilaunch.md); training opt-out / counsel -> [CLR](docs/clr-arkilaunch.md).

**Definition of Done (one task):**
- [ ] Implements the referenced `PRD-F#` / `US-##` acceptance criteria
- [ ] Approach validated against current best practices (security/architecture/data/a11y); source cited
- [ ] Restraint ladder applied (§5)
- [ ] Framework conventions verified against §3 (no stale APIs)
- [ ] Tests pass (Vitest + Playwright for money paths)
- [ ] No new secrets committed; input validated at boundaries; tenant RLS transaction used
- [ ] Locked-doc drift -> Change Record logged
- [ ] Public deploy -> §5.2 crawler policy honored

### Code review quality checklist

- [ ] **Security:** authz on every sensitive path; secrets in env; inputs validated at the boundary; tenant isolation proven (SAD-A1)
- [ ] **Must-Have tests:** QAD happy + sad + abuse for every `PRD-F#` this change claims
- [ ] **Restraint:** no abstraction/dependency that fails the §5 ladder
- [ ] **Context hygiene (AI paths):** untrusted upload/model output cannot trigger a deduction or override instructions
- [ ] **Docs:** Locked-doc drift logged as a CR; index row current

**Definition of Done (build / release):** ArkiLaunch's own Production Readiness Gate must pass before shipping: the checklist in [docs/index.md](docs/index.md) §4 Health Check, backed by [pitch-arkilaunch.md](docs/pitch-arkilaunch.md) §5 (pre-demo gate) and [wrap-arkilaunch.md](docs/wrap-arkilaunch.md) §5 (final check). The generic FMD-engine gate this pointed at (`fmd/AGENTS.md`) is an external tool this repo does not vendor; the three ArkiLaunch-specific checklists above are the ones that actually gate a release here.

---

## 6. Materialization

| Target | File | Notes |
|--------|------|-------|
| Canonical | `docs/build-arkilaunch.md` | edit here |
| All agents | `AGENTS.md` (project root) | full content; auto-read by Codex, Cursor, Gemini, Claude Code |
| Claude Code | `CLAUDE.md` | pointer to `AGENTS.md` + Claude-only notes |
| Cursor | `.cursor/rules/build.mdc` | **not generated this pass** (optional; add when a Cursor user joins the project) |
| Gemini CLI | `GEMINI.md` | **not generated this pass** (optional; add when a Gemini CLI user joins the project) |

Re-materialize whenever this guide changes. Root copies are build artifacts, not sources of truth. Only `AGENTS.md` and `CLAUDE.md` are generated today; the Cursor/Gemini pointers are genuinely optional and are not claimed as shipped until they exist on disk.

---

## Self-Check

- [x] Section 1 read-order lists all 12 upstream docs relevant to build (index, SCRUTINY, BRD, PRD, SDD, RFCs, DSD, QAD, CLR, AIA, OPS, this guide); intentionally omits doc types build never reads from directly (IDEA, VALIDATION, VOICE, PITCH, WRAP, UES, SAD, GTM, LOG; each has its own consumer named in BUILD/index)
- [x] Section 3 pins an exact version or SDK for every installable package/SDK, with a verified date (2026-07-25) and authoritative source; the 6 rows with no package to pin (Supabase, PayMongo, Open-Meteo, ACA, Vercel, Cloudflare) say so explicitly rather than "current"
- [x] Deprecations register holds the `use-X-not-Y` traps + every documented divergence from the thesis
- [x] Golden-path samples are version-tagged and dated (RLS tx, Nest endpoint, Azure DI gate)
- [x] Section 5 restraint ladder present; validation/security/RLS/a11y explicitly not cuttable
- [x] Public URL -> §5.2 crawler policy filled (robots table + indexability; app routes noindex)
- [x] Materialization targets state what is actually generated (AGENTS.md + CLAUDE.md) vs. genuinely optional and not yet generated (Cursor/Gemini pointers)
- [x] Definition of Done points at ArkiLaunch's own Production Readiness Gate (index.md §4 + PITCH §5 + WRAP §5), not the unvendored generic FMD one
- [x] AGENTS hard bans applied (no em-dashes)
- [x] All doc links are `docs/`-prefixed and resolve from the project root (this file lives at root, not in `docs/`)
