# ArkiLaunch

[![License](https://img.shields.io/badge/License-Proprietary%20(pending)-lightgrey.svg)](LICENSE)
[![Status](https://img.shields.io/badge/Status-F1--F8%20backends%20built%20%7C%20pilot%20not%20yet%20deployed-orange)](docs/index.md)
[![Stack](https://img.shields.io/badge/Stack-React%20%2B%20NestJS%20%2B%20Postgres-black)](docs/build-arkilaunch.md)
[![Docs: FMD](https://img.shields.io/badge/Docs-FMD-333)](docs/index.md)

The operating system for Philippine heavy-equipment rental MSMEs: scan the handwritten field logs your crew already keeps, price every rental against live diesel in under a minute, and flag weather risk on site, so paper-based rental firms stop leaking revenue. Multi-tenant SaaS; Almara Construction (Quezon City) is the pilot tenant.

Built with the Foundational Matrix Documents (FMD) workflow: IDEA to build to pitch to wrap.

## Status

Read this before trusting any other status claim in the repo; [docs/index.md](docs/index.md) §4 is the authoritative Health Check.

- **Backends for all eight PRD features (F1..F8) are built and tested**, including their read surfaces. See index.md §5 "Backend completion" and "Backend read-surface completion" (both 2026-08-02).
- **Database:** 35 tables against a real Supabase project, RLS forced on all 28 tenant-owned tables, RS256 JWT with refresh rotation.
- **Frontend:** a working shell, not a finished product. Storefront landing, auth flow, and role-aware route groups are live on the Yardboard design system; several routes are still thin and some query hooks return `unknown`.
- **Deployment: not yet proven.** `cr-arkilaunch-deploy-unblock.md` (2026-09-13) put every prerequisite in place, but no `Deploy` run has yet gone green, so the pipeline is unproven rather than fixed. PRD §9 M5 (anchor pilot deployment) has not started.
- **The OCR path has never analyzed a real *filled* document.** EDTR extraction now runs end to end against live Azure DI via `prebuilt-layout` tables, and one capture of the real Almara multi-day form fans out into one row per dated line (`docs/cr-arkilaunch-edtr-real-form.md`). But everything measured so far used machine-generated sheets: handwriting is entirely unexercised, no labeled corpus exists, and the QAD-T39 >= 90.06% accuracy gate is still unmeasured. `ENABLE_OCR_PIPELINE` is on in dev only; AIA-R7 stays Open (escalated) and CLR gap E1 is uncleared. See [docs/runbook-ocr-fixtures.md](docs/runbook-ocr-fixtures.md).

Two Change Records remain open on their own terms: `cr-arkilaunch-pilot-honesty.md` and `cr-arkilaunch-azure-di-provisioning.md`.

## Quick start

PRD, SDD, DSD, QAD, and RFC-1/2/3 are Locked. Read the docs first:

1. Start at [docs/index.md](docs/index.md) for the manifest and current Health Check status.
2. Read in the order [BUILD §1](docs/build-arkilaunch.md) sets out (index -> SCRUTINY -> BRD -> PRD -> SDD -> RFCs -> DSD -> QAD -> CLR -> AIA -> OPS -> BUILD).

To run the code: copy `.env.example` to `.env` (Supabase pooler connection strings and an RS256 keypair; see the comments in that file for the Supavisor-without-IPv4-addon connection shape), then `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm build`, `pnpm test`. [docs/runbook-local-dev.md](docs/runbook-local-dev.md) covers local setup in full.

This repo does not vendor the FMD engine's own tooling (`fmd/scripts/*.py`); doc validation and materialization here are done by hand, per [docs/index.md](docs/index.md) §4.

**Stack (pinned, verified 2026-07-25):** React 19.2 + Vite 8, NestJS 11.1 on Node 24 LTS, Drizzle ORM + Supabase Postgres, Azure AI Document Intelligence (OCR), PayMongo (payments), Open-Meteo (weather, **free tier** since 2026-08-20), Azure Container Apps + Vercel + Cloudflare. See [BUILD §3](docs/build-arkilaunch.md), including the divergence table.

## What it does

- Scans handwritten Equipment Daily Time Reports (EDTRs) with OCR and reconciles two independent logs before any deposit is deducted (PRD-F3).
- Generates diesel-indexed rental quotes in under a minute (PRD-F1).
- Manages a multi-tenant fleet with maintenance timers, weather-aware liability logging, and OCR-assisted KYC (PRD-F4, F5, F6).
- Takes bookings and payments through an authenticated customer portal (PRD-F2, F8).

## Documentation

42 documents live in [docs/](docs/); [docs/index.md](docs/index.md) is the manifest and the only complete list. The ones you are most likely to want:

| Doc | Purpose |
|-----|---------|
| [Index](docs/index.md) | Full doc manifest, Change Log, Health Check |
| [PRD](docs/prd-arkilaunch.md) | Product scope and features (PRD-F1..F8) · Locked |
| [SDD](docs/sdd-arkilaunch.md) | System architecture and data model · Locked |
| [QAD](docs/qad-arkilaunch.md) | QA and test plan · Locked |
| [RFC-1](docs/rfc-arkilaunch-tenancy-rls-auth.md) | Multi-tenant isolation + identity/auth · Locked |
| [RFC-2](docs/rfc-arkilaunch-ocr-edtr-reconciliation.md) | OCR EDTR + double-entry reconciliation · Locked |
| [RFC-3](docs/rfc-arkilaunch-quotation-pricing-engine.md) | Diesel-indexed quotation engine · Locked |
| [DSD](docs/dsd-arkilaunch.md) | Yardboard design system (canonical) · Locked |
| [BUILD](docs/build-arkilaunch.md) | Build guide, pinned stack, golden paths |
| [OPS](docs/ops-arkilaunch.md) | SLOs, alerts, incident runbooks |
| [AIA](docs/aia-arkilaunch.md) | AI assurance dossier |
| [CLR](docs/clr-arkilaunch.md) | Compliance and legal register |
| [IDEA](docs/idea-arkilaunch.md) | The spark and scope |

Root `IDEA.md` is the original capstone thesis and remains the source of record for the literature review, diagrams, and the 29-entity data dictionary the SDD schema derives from. It is not a generated artifact and is deliberately exempt from the FMD voice checks.

**Materialized from the DSD:** [BRAND.md](BRAND.md), [DESIGN.md](DESIGN.md). **Materialized from BUILD:** [AGENTS.md](AGENTS.md). **Materialized from AIA §1:** [MODEL_CARD.md](MODEL_CARD.md). These four are build artifacts; edit the canonical doc and re-materialize. This README is **not** one of them -- it is maintained by hand.

## Demo

See [docs/pitch-arkilaunch.md](docs/pitch-arkilaunch.md) for the defense and demo script.

## Team

ArkiLaunch Team, Almara Construction capstone.

## License

All rights reserved pending resolution of capstone IP ownership (CLR escalation flag E10); see [LICENSE](LICENSE) and [docs/clr-arkilaunch.md](docs/clr-arkilaunch.md).
