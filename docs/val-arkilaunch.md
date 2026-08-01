# Validation Brief (VALIDATION)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with reality)
**IDEA:** [idea-arkilaunch.md](idea-arkilaunch.md)

---

> Sprint-sized evidence and kill criteria for the venture-level go/no-go. One page of evidence, not a market report.

---

## 1. Problem Evidence

**Claim:** Small Philippine heavy-equipment rental firms lose real revenue to paper-based billing, slow manual quoting, and flood-vulnerable records, and a lone administrator cannot scale that back office.

**Evidence we have** (stable IDs `VAL-E1`..`VAL-E4`, never renumbered):

| ID | Source | What it shows |
|----|--------|---------------|
| `VAL-E1` | Direct study of Almara Construction (Quezon City) | One administrator hand-calculates every quote (20 to 30 min) and re-keys paper EDTRs; records live in physical cabinets exposed to flooding |
| `VAL-E2` | Arizton PH construction equipment rental market report | The market was USD 175.9M (2023) growing to USD 236.5M by 2029 at 5.06% CAGR, driven by infrastructure and flood-mitigation projects, so more MSMEs face this back-office load |
| `VAL-E3` | Existing PH rental sites (Hastings, Monark) | "Quick quote" is a web form emailed back hours later, not an instant quote; confirms the quoting gap |
| `VAL-E4` | Prior academic systems (Denuwan 2024; Patil 2023; Owen and Fitrisia 2025) | Rental platforms exist but assume born-digital data; they do not bridge the handwritten-paper reality, which is the adoption blocker here |

**Evidence we don't have (and accept for this sprint):** a quantified peso figure for Almara's current leakage (measured during the pilot, BRD-M8), and validated willingness-to-pay across firms beyond the anchor (measured in beta).

---

## 2. Competitor / Substitute Scan

| Substitute | How users cope today | Our wedge |
|------------|----------------------|-----------|
| Pen, paper, Excel, Messenger | Hand-calculate quotes, re-key EDTRs, file paper by project | Scan the paper they already keep; reconcile two logs before deducting |
| Hastings / Monark web forms | Submit a request, wait hours for an emailed quote | Diesel-indexed quote in under a minute, printable |
| Generic rental / fleet software | Assumes clean digital entry; no PH diesel index, no weather liability logging | OCR-of-paper bridge + Open-Meteo advisories + PH KYC (SEC/TIN) |

**Why we still build:** the underserved wedge is the paper-to-digital bridge for PH rental MSMEs plus diesel-indexed pricing and weather-aware liability logging, which no existing tool combines. Moat and positioning detail live in the [UES](ues-arkilaunch.md) §4 to §5 (the double-entry reconciliation trust moat, UES-M2; the OCR-of-paper adoption bridge, UES-M1).

---

## 3. Feasibility in Timebox

**Available time:** capstone build window (multi-week academic term; not a 1 to 3 day sprint).

**Must ship for demo:** the core slice PRD-F3 (OCR usage-based billing + reconciliation) + PRD-F1 (diesel-indexed quote) + PRD-F7 (multi-tenant auth), running for Almara.

| Workstream | Estimate | Risk |
|------------|----------|------|
| Multi-tenant auth + RLS (RFC-1) | Medium | RLS + Drizzle discipline; mitigated by the isolation-checker agent |
| OCR + reconciliation (RFC-2) | High | Handwriting accuracy, Azure DI region; mitigated by confidence gate + HITL |
| Quotation + diesel ingestion (RFC-3) | Medium | DOE scrape fragility; mitigated by manual-entry fallback |

**Biggest technical unknown:** handwritten EDTR extraction accuracy against the >=90.06% target on real field paper.

**Mitigation:** confidence gate + double-entry reconciliation + human-in-the-loop, so accuracy variance never produces a wrong deduction; measure accuracy on a gold set before relying on auto-accept.

---

## 4. Kill Criteria

Stable IDs `VAL-K1`..`VAL-K4`, never renumbered:

| ID | Kill signal | Status (Go / Pivot / Stop) |
|----|-------------|----------------------------|
| `VAL-K1` | Azure DI cannot extract handwritten EDTR fields above a usable confidence even with HITL | Go (Azure DI handwriting + custom extraction verified; HITL backstops accuracy) |
| `VAL-K2` | No rental firm outside the team can repeat the one-liner or would not care | Go (scrutiny §4.1 audience stress passed; the flood/leakage pain is concrete and repeatable) |
| `VAL-K3` | No lawful diesel-price source and admins reject manual entry | Go (DOE public data + manual-entry fallback; legal-review note to CLR) |
| `VAL-K4` | The anchor tenant will not run it in production | Go (Almara is the committed pilot tenant) |

**Decision:** Go. The pain is evidenced and specific, the wedge is defensible, and the highest technical risk (OCR accuracy) is contained by the confidence gate + reconciliation + human review rather than bet on.

---

## 5. Concept Visual Reactions

IDEA §5 concept frames are not yet generated (image tooling unavailable this session), so there are no team reactions to record. The visual direction (the Yardboard rugged-control-panel aesthetic) is captured in the [DSD](dsd-arkilaunch.md) §0 and is the brief for those frames.

**Visual go/no-go:** deferred to concept-frame generation; DSD §0 provenance stands as the approved direction.

---

## Self-Check

- [x] At least one piece of real evidence cited (Almara study, Arizton market data, competitor forms); evidence rows carry stable `VAL-E1`..`VAL-E4` IDs so downstream docs can cite them (previously this doc defined no IDs at all)
- [x] Kill criteria are concrete; carry stable `VAL-K1`..`VAL-K4` IDs
- [x] Kill set includes the audience-repeat / indifference fail
- [x] Feasibility table fits the (capstone) timebox
- [x] AGENTS hard bans applied (no em-dashes)
- [x] Next suggested doc: PRD (already authored)
