# House Style & Voice (Project Tuning)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with usage)

---

> Project-specific voice tuning for ArkiLaunch. The FMD hard bans and register rules stay in force; this file adds the ArkiLaunch-specific layer. Canonical anti-slop rules live in the FMD [VOICE template](../fmd/templates/VOICE_Template.md).

---

## 1. Hard Bans (always on, inherited)

Every ArkiLaunch doc obeys the FMD hard bans without exception:

- **No em-dashes** anywhere (U+2014, spaced en-dash, or spaced `--` as punctuation). Use commas, colons, periods, parentheses, or split the sentence. Unspaced ranges (`1 to 3 days` or `Mon-Fri`) and badge/ID tokens are fine.
- No stock scene-setting openers, hedge stacks, performative-enthusiasm words, false intimacy, listicle-voice prose, or empty intensifiers. The full banned-phrase and overused-word lists live in the FMD VOICE template.
- No AI-tool markup artifacts pasted from chat tools.

`python fmd/scripts/check.py docs` enforces the high-confidence subset; the rest is a judgment pass before locking any doc.

## 2. Register by document type

| Document | Register |
|----------|----------|
| IDEA, VALIDATION, WRAP | Conversational, direct, "we" is fine |
| PRD, SDD, RFC, BUILD | Clear spec voice; no marketing adjectives |
| PITCH | Spoken rhythm; short lines; strong verbs |
| DSD, BRAND, DESIGN | Evocative but specific; every adjective traces to DSD §0 provenance |
| OPS, CLR, QAD, AIA | Precise, no flourish; imperative in step lists; disclaimer discipline in CLR/AIA |

## 3. AI-tell pass (before locking any doc)

Run the FMD nine-step self-check pass: grep for em-dashes and `--`; scan banned phrases and overused verbs/adjectives; strip markup artifacts; confirm at least one concrete specific per section; check headings describe rather than tease; cap hedging and contrasting-parallelism; vary sentence and paragraph length; read aloud; run `check.py` and fix every FAIL.

## 4. Project Voice Tuning

**Audience:** two readers. (1) The people who run the product: PH rental-company owners and administrators who are practical, time-poor, and skeptical of "systems". (2) The capstone panel and any future assessor, who want rigor and traceability.

**We sound like:** a sharp operator who has done the paperwork and is showing a working fix, not a vendor pitching a vision slide. Plain, concrete, grounded in the yard and the office.

**We never sound like:** enterprise SaaS marketing copy, or an academic paper padded with hedges.

**Signature phrases (use sparingly, max 2 per doc):** "Scan the paper." / "Keep the money."

**Reading level:** Grade 8 to 10 for product-facing and IDEA/PITCH copy; define any domain term (EDTR, mobilization, reconciliation) on first use. Spec docs may assume engineering literacy.

**Person / tense:** first person plural ("we") in IDEA, VALIDATION, WRAP, PITCH; third person, present tense in specs (PRD, SDD, RFC, BUILD, QAD, OPS, CLR, AIA).

**Domain vocabulary (use the real words):** EDTR (Equipment Daily Time Report), mobilization/demobilization, double-entry reconciliation, tenant, rate card, diesel-indexed, KYC/e-KYB, SEC number, TIN. Do not soften these into generic SaaS terms.

---

## Self-Check

- [x] §1 hard bans restated; em-dash rule explicit
- [x] §2 register table matches this project's doc set
- [x] §4 filled: audience, sound-like, never-like, signature phrases (<=2 per doc), reading level, person/tense
- [x] Grepped this file for em-dashes and `--` as punctuation: none
- [x] AGENTS hard bans applied
