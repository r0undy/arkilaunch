# House Style & Voice (Project Tuning)

**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Draft
**Last reconciled:** N/A (not yet reconciled with usage)

---

> Project-specific voice tuning for ArkiLaunch. §1 below is this project's complete, self-contained hard-ban list; it does not depend on the FMD engine's own VOICE template (an external tool this repo does not vendor, so its canonical list is inlined here rather than linked).

---

## 1. Hard Bans (always on)

Every ArkiLaunch doc obeys these without exception:

- **No em-dashes** anywhere (U+2014, spaced en-dash, or spaced `--` as punctuation). Use commas, colons, periods, parentheses, or split the sentence. Unspaced ranges (`1 to 3 days` or `Mon-Fri`) and badge/ID tokens are fine.
- **No stock scene-setting openers:** "In today's fast-paced world", "In the ever-evolving landscape of...", "Imagine a world where...", "It's no secret that...". Open on the specific problem, person, or number instead.
- **No hedge stacks:** do not chain "might potentially perhaps somewhat" qualifiers. State the claim, then name its actual uncertainty once (a TBD, a confidence gate, a measured target), not with reflexive softening language.
- **No performative-enthusiasm words:** "game-changer", "revolutionize", "seamless", "cutting-edge", "unlock", "supercharge", "elevate", "empower", "robust" (as a filler adjective), "leverage" (as a verb for "use"), "delve", "boast", "harness" (as a verb for "use"), "unparalleled", "state-of-the-art" used as filler.
- **No false intimacy:** "we've all been there", "you know the feeling", "let's be honest". This product talks to a specific named user (Rhea), not a generic "you".
- **No listicle-voice prose:** sentences that exist only to introduce a bullet ("Here are the key benefits:") rather than saying something. Bullets stand on their own claims.
- **No empty intensifiers:** "very", "really", "truly", "incredibly", "extremely" as a substitute for a specific number or fact. "Fast" needs a number; "robust" needs a named failure mode it survives.
- **No AI-tell filler verbs/adjectives as a pattern:** "comprehensive", "holistic", "seamless", "streamlined", "innovative", "modern", "clean", "intuitive" used with no concrete referent. These are allowed only when immediately followed by the specific mechanism that earns the word.
- **No AI-tool markup artifacts** pasted from chat tools (stray `**`, curly-brace placeholders, "As an AI..." disclaimers, chat-turn framing).

**Enforcement:** grep for the literal em-dash and the banned phrases above before locking any doc (§3 below). There is no `check.py` in this repository; this pass is manual, done at lock time.

## 2. Register by document type

| Document | Register |
|----------|----------|
| IDEA, VALIDATION, WRAP | Conversational, direct, "we" is fine |
| BRD, UES | Business-case voice: numbers and named assumptions, not narrative; every dollar/peso figure states whether it is measured or illustrative |
| SCRUTINY | Auditor voice: claim, finding, source, severity; no editorializing beyond the verdict line |
| PRD, SDD, RFC, BUILD | Clear spec voice; no marketing adjectives |
| SAD | Agent-card voice: purpose, responsibilities, guardrails, done-when, stated as operating instructions, not prose about the agent |
| PITCH | Spoken rhythm; short lines; strong verbs |
| DSD, BRAND, DESIGN | Evocative but specific; every adjective traces to DSD §0 provenance |
| OPS, CLR, QAD, AIA | Precise, no flourish; imperative in step lists; disclaimer discipline in CLR/AIA |
| GTM | Plain marketing-ops voice: channel, audience, action; illustrative figures marked as such, same discipline as UES |
| Landing page copy (S1, CR: frontend-storefront-shell) | Inherits PITCH's spoken rhythm and short lines for hero/narrative copy, plus UES's discipline for any number: every peso figure and every proof-point number states whether it is measured or a mechanism claim, never a customer result that was not observed. No testimonials, no unverified certifications. |
| LOG, index | Ledger voice: one row per fact, no narrative; the log is append-only, the index is a manifest, neither argues a case |

## 3. AI-tell pass (before locking any doc)

Run this eight-step manual pass (the FMD engine's own nine-step check.py is not vendored in this repo, so this is done by hand): grep for em-dashes and `--`; scan for the §1 banned phrases and overused verbs/adjectives; strip markup artifacts; confirm at least one concrete specific per section (a number, a name, a file path, not a generality); check headings describe rather than tease; cap hedging and contrasting-parallelism ("not just X, but Y" used more than once or twice); vary sentence and paragraph length; read the doc aloud and fix anything that sounds like it is performing confidence rather than stating a fact.

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

- [x] §1 hard bans are inlined in full (banned phrases, hedge/intensifier/false-intimacy rules), not delegated to an unvendored external template
- [x] §2 register table covers every doc type in `docs/index.md` §1 (IDEA/VALIDATION/WRAP, BRD/UES, SCRUTINY, PRD/SDD/RFC/BUILD, SAD, PITCH, DSD/BRAND/DESIGN, OPS/CLR/QAD/AIA, GTM, LOG/index); no doc type left unassigned
- [x] §4 filled: audience, sound-like, never-like, signature phrases (<=2 per doc), reading level, person/tense
- [x] Grepped this file for em-dashes and `--` as punctuation: none
- [x] AGENTS hard bans applied
