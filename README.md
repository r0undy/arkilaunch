# ArkiLaunch

[![License](https://img.shields.io/badge/License-Proprietary%20(pending)-lightgrey.svg)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Docs%20Complete-green)](docs/index.md)
[![Stack](https://img.shields.io/badge/Stack-React%20%2B%20NestJS%20%2B%20Postgres-black)](docs/build-arkilaunch.md)
[![Docs: FMD](https://img.shields.io/badge/Docs-FMD-333)](docs/index.md)

The operating system for Philippine heavy-equipment rental MSMEs: scan the handwritten field logs your crew already keeps, price every rental against live diesel in under a minute, and flag weather risk on site, so paper-based rental firms stop leaking revenue. Multi-tenant SaaS; Almara Construction (Quezon City) is the pilot tenant.

Built with the Foundational Matrix Documents (FMD) workflow: IDEA to build to pitch to wrap.

## Quick start

Implementation has not started; this repo currently holds the FMD documentation suite. Read the docs first:

1. Start at [docs/index.md](docs/index.md) for the manifest and current Health Check status.
2. Read in the order [BUILD §1](docs/build-arkilaunch.md) sets out (index -> SCRUTINY -> BRD -> PRD -> SDD -> RFCs -> DSD -> QAD -> CLR -> AIA -> OPS -> BUILD).

This repo does not vendor the FMD engine's own tooling (`fmd/scripts/*.py`); doc validation and materialization here are done by hand, per [docs/index.md](docs/index.md) §4.

**Planned stack (pinned, verified 2026-07-25):** React 19.2 + Vite 8, NestJS 11.1 on Node 24 LTS, Drizzle ORM + Supabase Postgres, Azure AI Document Intelligence (OCR), PayMongo (payments), Open-Meteo (weather), Azure Container Apps + Vercel + Cloudflare. See [BUILD](docs/build-arkilaunch.md) §3.

## What it does

- Scans handwritten Equipment Daily Time Reports (EDTRs) with OCR and reconciles two independent logs before any deposit is deducted (PRD-F3).
- Generates diesel-indexed rental quotes in under a minute (PRD-F1).
- Manages a multi-tenant fleet with maintenance timers, weather-aware liability logging, and OCR-assisted KYC (PRD-F4, F5, F6).

## Documentation

| Doc | Purpose |
|-----|---------|
| [IDEA](docs/idea-arkilaunch.md) | The spark and scope |
| [PRD](docs/prd-arkilaunch.md) | Product scope and features (PRD-F1..F8) |
| [SDD](docs/sdd-arkilaunch.md) | System architecture and data model |
| [DSD](docs/dsd-arkilaunch.md) | Yardboard design system (canonical) |
| [Index](docs/index.md) | Full doc manifest |

**Living design files (materialized from DSD):** [BRAND.md](BRAND.md) and [DESIGN.md](DESIGN.md). **Build guide (materialized to):** [AGENTS.md](AGENTS.md). **AI system card:** [MODEL_CARD.md](MODEL_CARD.md).

## Demo

See [docs/pitch-arkilaunch.md](docs/pitch-arkilaunch.md) for the defense and demo script.

## Team

ArkiLaunch Team, Almara Construction capstone.

## License

All rights reserved pending resolution of capstone IP ownership (CLR escalation flag E10); see [LICENSE](LICENSE) and [docs/clr-arkilaunch.md](docs/clr-arkilaunch.md).

---

*README materialized from FMD README_Template.md on 2026-07-25.*
