# CLAUDE.md

> Read [AGENTS.md](AGENTS.md) first. It is the materialized ArkiLaunch build guide (read order, pinned stack, golden paths, guardrails). This file adds Claude-Code-only notes.

## Claude-Code-specific notes

- **Subagents:** the ArkiLaunch build agents live in `.claude/agents/` (tenant-isolation-checker, migration-rls-guardian, edtr-ocr-worker, ai-ocr-abuse-runner, restraint-guardian). Their canonical source is [docs/sad-arkilaunch.md](docs/sad-arkilaunch.md); edit the SAD and re-materialize, do not hand-edit the agent files as source of truth.
- **Docs first:** start every session at [docs/index.md](docs/index.md); build only against Locked docs; a Locked-doc change requires a Change Record.
- **Money path:** never let OCR output trigger a deposit deduction without a passing reconciliation or explicit human approval (RFC-2). Never trust a client-supplied tenant_id; derive it from the verified JWT (RFC-1).
- **Materialized files** (`AGENTS.md`, `BRAND.md`, `DESIGN.md`, `MODEL_CARD.md`) are build artifacts; edit their canonical docs and re-run `python fmd/scripts/materialize.py docs --out .`.
