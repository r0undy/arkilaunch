> Materialized from docs/dsd-arkilaunch.md by scripts/materialize.py on 2026-07-25 (marketing-tier amendment hand-materialized 2026-08-02, CR: dsd-marketing-tier; see docs/cr-arkilaunch-dsd-marketing-tier.md). Do not hand-edit; edit the canonical doc and re-run.

# Brand: ArkiLaunch

> Verbal identity, materialized from the DSD (sections 0, 0.5, 1, 2.2, 2.4, 8.4, 8.6), renumbered here as this document's own contiguous §0, §0.5, §1, §2, §3, §4, §5, plus a voice link (§6) and governance (§7). See [docs/dsd-arkilaunch.md](docs/dsd-arkilaunch.md) §9 for the full materialization contract.

---

## 0. Brand Stance

> Filled before §1 to §7. Every downstream token, component, and motion rule is constrained by what is locked here.

### The Three Rules

| Rule | What it demands | Applied to ArkiLaunch |
|---|---|---|
| **Make it relatable** | Ground every aesthetic choice in a specific cultural moment, place, or shared experience | The interface reads like a heavy-equipment gauge cluster and a Manila terminal dispatch board: amber-and-black hazard signalling a yard crew already trusts, PAGASA yellow/orange/red weather warnings the whole country reads on the news, peso figures in a mono readout like a fuel-price sign on EDSA. Rhea approves a bill under a tin roof at 3pm; the palette is built for that light, not for a designer's retina monitor. |
| **Make it human** | Show a person's judgment call, not a generator's default | The field worker's own handwritten EDTR is shown as a first-class artifact beside the extracted numbers, never hidden behind a spinner. A diagonal amber/black hazard stripe appears only on states where money or safety is at stake (reconciliation discrepancy, stop-work weather), the way a real machine warns you. Operational numbers sit in a mono "gauge" readout, tabular-aligned, so a column of hours reads like an instrument, not a web table. |
| **Make them part of the branding** | Weave the users' actual presence into the identity | The timekeeper's handwriting IS the interface at the reconciliation step, and the invoice evidence trail cites their sheet by name. Each tenant's own firm name and mark ride in the app bar and on the customer portal, so the product feels like *that yard's* system (Almara's, then the next firm's), not generic multi-tenant chrome. |

**Test applied:** any color, type, or layout choice that could sit unchanged inside a generic B2B SaaS starter fails and is replaced. The distinctive line below is the tuning fork.

### Mode

- [ ] **Brand Mode**
- [x] **Product Mode**; task-first: fluent density, semantic states, repeatable components. ArkiLaunch is a working back office (dashboards, tables, review queues, billing), so the whole app UI is Product Mode.
- [ ] **Both**

**Selected mode:** `Product Mode`. Exception: S1 Public Landing and S22 Catalog Browse carry a light Brand-Mode surface (larger type, one image-led hero) so a prospective tenant or contractor gets an impression before the task. Every authed surface (S2 to S21, S25) is strictly Product Mode.

**Named tiers (CR: dsd-marketing-tier):** the Brand-Mode exception above is formalized as a second token **tier**, not just a loose exception, because it now carries its own radius scale, elevation language, and motion budget (see [DESIGN.md](DESIGN.md) §2 to §5). Every screen belongs to exactly one tier:

| Tier | Screens | Governs |
|---|---|---|
| **Console** (default) | S2 to S21, S25; all authed, task-first surfaces | The instrument-panel system: tight radii, border-first depth, <=250ms motion, IBM Plex only. |
| **Marketing** | S1 Public Landing, S22 Catalog Browse | The SprintForge-derived surface merged in by this amendment: large radii, layered/glass depth, Instrument Serif accent, rise-in/drift motion, all behind a progressive-enhancement gate ([DESIGN.md](DESIGN.md) §6). |

A component never silently crosses tiers. The tier is set once, on a route wrapper (`data-tier="marketing"` on the root of S1/S22, unset elsewhere).

### Aesthetic Provenance

| Question | Answer |
|---|---|
| **Specific cultural or aesthetic reference** | Heavy-equipment operator gauge clusters (Caterpillar / Komatsu instrument panels: high-contrast segmented readouts, bezelled status lamps, amber-on-dark legible through dust and glare) crossed with a Philippine terminal **dispatch board** (port and jeepney route boards, condensed all-caps legibility read at distance and in bad light) and grounded in **Filipino MSME pragmatism** (the sari-sari-store thumb-first practicality, a five-year-old Android as the primary device). Weather signalling borrows directly from **PAGASA rainfall warnings** (yellow / orange / red) and typhoon-signal escalation. Not "modern dashboard", not "inspired by Linear". |
| **One sentence that would NEVER appear in AI slop for this category** | "Your timekeeper's handwriting sits right next to the hours we will bill, so nothing gets deducted that you cannot see with your own eyes." This governs the voice: evidence-first, plain, protective of the user's money. |
| **The archetypical user (named, specific, one person)** | Rhea, sole back-office administrator at Almara Construction in Quezon City. They approve reconciled EDTRs between phone calls, on a five-year-old Android and a shared office desktop, under a tin roof where the afternoon light comes in sideways. They hand-computed every quote for years and do not trust a number they cannot trace to a source. |
| **The slop default for this product category** | Indigo-to-violet hero gradient, Inter everywhere, a glassy floating dashboard card over a stock photo of a smiling team in hardhats, zebra-striped tables that need a mouse and a wide screen, a generic gray illustration for every empty state. This is precisely what Yardboard does not produce. |
| **How users appear in the brand** | The field worker's actual handwritten EDTR image is a permanent, first-class panel at reconciliation (S8) and is cited on the invoice evidence trail (S9). The tenant's own firm name and logo appear in the app bar and drive the customer-facing catalog (S22). Onboarding and empty states name the real yard and crew, not a placeholder. |

### Anti-References

| Anti-reference | Why it is forbidden here |
|---|---|
| **Default SaaS purple** (indigo-to-violet gradients, purple primary buttons, gradient text) | It is the category's beige. It signals "another web app" to a crew that trusts machine panels and government weather colors, and it carries zero meaning in a yard. Amber, steel, and the PAGASA scale all carry meaning; purple carries none. |
| **Enterprise SaaS coldness** (Workday/Salesforce grey chrome, dense corporate shells, faceless stock imagery) | Rhea is one person carrying a back office, not a procurement department. Cold grey enterprise chrome reads as "built for someone else's IT budget" and breaks Rule 3 (make them part of the branding). |
| **Dense fintech / terminal tables that assume a retina desktop** (Bloomberg-terminal density, tiny 11px rows, hairline dividers, hover-only actions) | The primary device is a cheap Android over 3 to 5 Mbps in outdoor light. Hairlines vanish, hover does not exist on touch, and 11px rows fail both legibility and WCAG 2.2 target size. Density here must survive a thumb and the sun. |

**Scope note (CR: dsd-marketing-tier):** "Default SaaS purple" and "Enterprise SaaS coldness" stay absolute anti-references, everywhere, no exception. Glassmorphism and floating-card depth theater, previously banned outright, are now banned in **Console tier only**; the Marketing tier (S1, S22) is permitted the SprintForge-derived glass nav and layered shadows under an explicit perf gate ([DESIGN.md](DESIGN.md) §6), because Rhea never works from that surface on her cheap Android in the field, a first-time visitor evaluating the product does.

---

## 0.5 Concept Visuals (from IDEA)

*Carried forward from [docs/idea-arkilaunch.md](docs/idea-arkilaunch.md) §5. Lo-fi frames are **not yet generated**: image-generation tooling is unavailable this session. The visual direction below is the approved brief for those frames when tooling lands. No image asset is claimed to exist.*

**IDEA link:** [docs/idea-arkilaunch.md](docs/idea-arkilaunch.md) §5

**Approved visual direction (one sentence, from IDEA §5):** Field-rugged, high-contrast, data-dense "control room for the yard": trustworthy and legible on a cheap Android over a 3 to 5 Mbps connection, not default SaaS purple; Filipino-MSME-relatable, not enterprise-cold.

| Screen / section | Asset path | Approved in IDEA? | DSD notes |
|------------------|------------|-------------------|-----------|
| Admin dashboard (fleet + weather) | `docs/assets/concept/` (to be generated) | Direction yes; frame no | Maps to S4. Brief: work-queue-first control room; weather banner strip up top (PAGASA scale), fleet utilization tiles as gauge readouts, review-queue count as a lamp. |
| EDTR scan + reconciliation review | `docs/assets/concept/` (to be generated) | Direction yes; frame no | Maps to S7 + S8. Brief: side-by-side original handwritten image (zoom/pan) vs extracted fields with per-field confidence chips and a two-log delta bar. The load-bearing screen; see DESIGN.md §4.1 Evidence Split View. |
| Client booking + quote | `docs/assets/concept/` (to be generated) | Direction yes; frame no | Maps to S5/S6 (quote) and S22 to S24 (booking). Brief: quote builder with live diesel-price readout and staleness label; printable output; catalog cards that survive a slow connection. |

**Tooling status:** none run yet. Planned per IDEA: taste-skill `imagegen-frontend-web` / `imagegen-frontend-mobile` plus `/impeccable shape` on the hero and the EDTR reconciliation flow before DESIGN.md §2 tokens harden into code.

**UX shape pass:** deferred. Run `/impeccable shape` on S4 (dashboard) and the S7 to S9 trusted-billing loop before implementation, when the harness supports it.

---

## 1. Design Philosophy & Vision

**Core aesthetic:** Instrument-panel utilitarianism with Filipino warmth. Flat structural surfaces bounded by honest 1px borders (not floating glass), amber-and-steel signal color that carries meaning, and every operational number set in a tabular mono "gauge" so a yard crew reads it like a machine display. Density is high but the touch targets and contrast are built for a thumb in outdoor light, not a mouse on a retina screen.

**Emotional intent:** Rhea should feel *in control and unafraid of the number*. Nothing deducts money or issues a bill without a visible, traceable source next to it. The tone is a competent dispatcher, not a cheerful onboarding wizard: calm, legible, protective of the user's billing integrity.

**Aesthetic references:** Caterpillar / Komatsu operator instrument clusters; Philippine port and jeepney dispatch boards; PAGASA weather-warning color language; fuel-price signage. The nearest software cousins are logistics and fleet-ops control boards, not consumer SaaS dashboards.

**What this system explicitly avoids:**
- Purple/indigo gradients and gradient text (the category slop default; carries no yard meaning). Applies everywhere, both tiers.
- Glassmorphism, heavy blur, and floating-card depth theater in the **Console tier** (fails on cheap Android GPUs and reads as decoration, not signal). Permitted in the **Marketing tier** only, behind the progressive-enhancement gate ([DESIGN.md](DESIGN.md) §6); see §0 Named tiers.
- Hover-only affordances, hairline dividers, and sub-12px data rows (die on touch and in the sun). Applies everywhere, both tiers.
- Auto-playing or looping animation, and skeleton shimmer as the default loading gesture (burns battery and bandwidth for no information). Applies everywhere, both tiers; the Marketing tier's rise-in/drift motion is state-driven and gated by `prefers-reduced-motion`, not a shimmer loop.

---

## 2. Logo System

**Direction:** an "A" set as a **gauge needle / dispatch chevron** inside a bezelled square lamp, in signal amber on steel black. It should read as an instrument indicator, not a startup swoosh. Wordmark "ArkiLaunch" set in the condensed display face (see DESIGN.md §2 Typography), all-caps, tight tracking, dispatch-board cadence.

| Variant | Asset path | Use when |
|---------|------------|----------|
| Primary | `docs/assets/brand/logo-primary.svg` (to produce) | Default lockup: mark + wordmark, horizontal. App bar, landing, quote/invoice header. |
| Secondary | `docs/assets/brand/logo-stacked.svg` (to produce) | Tight/narrow space: mark over wordmark. Mobile app bar, timekeeper console. |
| Icon / mark | `docs/assets/brand/logo-mark.svg` (to produce) | Favicon, PWA icon, notification badge. The bezelled amber "A" lamp alone. |

**Tenant lockup rule (Rule 3):** in the authed app bar and on a tenant's public catalog, the **tenant's** name/mark leads; "Powered by ArkiLaunch" is the secondary line. ArkiLaunch never overrides the tenant identity inside a tenant's own workspace. This rule also governs the Marketing-tier FloatingNav (DESIGN.md §4) if a tenant surface ever reuses it.

**Clear space:** 1x the mark's bezel height on all sides.
**Minimum size:** mark 24px (favicon 16px permitted); full lockup wordmark cap-height >= 14px.
**Approved backgrounds:** page background, surface white, steel black `#10151B` (see DESIGN.md §2 for the exact tokens). On a photo, place on a solid steel scrim; never directly on a busy yard photo.

**Don'ts:** do not recolor the mark outside amber/steel, do not add a drop shadow or bevel-gloss, do not stretch or rotate the needle, do not place the ArkiLaunch mark above a tenant's mark inside that tenant's workspace, do not use a deprecated file after a version bump (§7).

---

## 3. Imagery & Illustration

**Style:** documentary, not stock. Real equipment in real Luzon yards and sites, shot in available light; the grit stays. Where photography is unavailable, use flat two-color diagrams (steel + amber) in the instrument-panel idiom, not soft rounded 3D blobs. The single most important "image" in the product is not decorative at all: it is the **user's own handwritten EDTR**, shown at full fidelity beside the extracted data.

**AI positive prompts:** "documentary photo, Philippine construction equipment yard, backhoe/excavator, overcast Luzon daylight, working crew, unstyled, mud and wear visible, high dynamic range, no logos"; for diagrams: "flat two-color technical schematic, steel-blue and safety-amber, instrument panel style, high contrast, thick strokes".
**AI negative prompts:** "no purple, no indigo gradient, no glassmorphism, no glossy 3D render, no smiling stock team in clean hardhats, no lens flare, no neon, no floating UI cards, no Western corporate office".
**Reference assets:** `docs/assets/concept/` (to be generated; see §0.5). The handwritten-EDTR sample fixtures live with the OCR test corpus, not in brand assets.

---

## 4. Application Examples

| Surface | Do | Don't |
|---------|----|-------|
| Admin dashboard (S4) | Lead with the work queue and a weather strip; Gauge Readouts for utilization and recovered hours; tenant mark in the app bar. | Float a glassy KPI card over a hero gradient; bury the review-queue count. |
| EDTR reconciliation review (S8) | Handwritten image beside extracted fields; loud below-gate Confidence Chips; Hazard Divider on discrepancy; Approve disabled until resolved. | Hide the source image; auto-accept a low-confidence field; let a discrepancy deduct. |
| Weather advisory (S13) | PAGASA-scale banner with label + icon + timestamp; stale marker when cached; link red to its auto-logged incident. | Red for an unknown/stale reading; color-only banner. |
| Printable quote (S6) | Clean print stylesheet, diesel price + date on the document, tenant lockup at the header. | Screen-only chrome bleeding into print; undated price. |
| Customer portal / catalog (S22) | Tenant's brand leads; compressed responsive images; honest availability; light Brand-Mode hero only here. | ArkiLaunch overriding the tenant identity; heavy hero that stalls at 3 to 5 Mbps. |
| Public landing (S1, CR: dsd-marketing-tier) | Marketing-tier shell (§0, DESIGN.md §2 to §5); amber/steel/IBM Plex identity carried through with an Instrument Serif accent and SprintForge-derived depth, gated by progressive enhancement; hero message per GTM §66. | Inter, SprintForge's `#E34A32` orange, ungated WebGL/parallax that ignores `prefers-reduced-motion` or the connection check, any surface that reads as a different brand than the app the visitor logs into next. |

**Mockup paths:** `docs/assets/concept/` (to be generated; §0.5).

---

## 5. Section 0 Compliance Check

- [x] **Relatable**; every color, typeface, and layout choice traces to the gauge-cluster + dispatch-board + PAGASA + Filipino-MSME provenance (§0 Aesthetic Provenance), not to a generic default. Amber/steel signal, PAGASA weather scale, mono gauge readouts, 360px cheap-Android baseline.
- [x] **Human**; deliberate idiosyncrasy documented: **the gauge rule** (every operational number in tabular mono, aligned like an instrument face; DESIGN.md §2 Typography) plus the **Hazard Divider** used only where money or safety is at stake. An AI default would have reached for one uniform sans and decorative dividers.
- [x] **Part of the branding**; the humanization from §0 (the field worker's own handwritten EDTR shown as a first-class artifact and cited on the invoice, plus tenant identity leading the app bar and catalog) is specified into real components (Evidence Split View, Nav shell, KYC panel, all in [DESIGN.md](DESIGN.md) §4.1), not deferred.

---

## 6. Voice

Verbal tone, banned phrases, and the per-document-type register live in [docs/voice-arkilaunch.md](docs/voice-arkilaunch.md); the Brand Stance above (§0) sets *what* ArkiLaunch sounds like, VOICE sets the enforceable rules for *how it is written*. Both apply together: a sentence can pass VOICE's banned-phrase check and still violate the Brand Stance if it could sit unchanged in a generic B2B SaaS starter.

---

## 7. Governance

**Brand asset version:** `1.0.0` (major = rebrand, minor = new variant, patch = file fix). This is version `0.1` of the DSD; asset production begins at DSD lock.
**Naming:** kebab-case; `logo-primary.svg`, `logo-mark.svg`, `logo-stacked.svg`, `concept-s4-dashboard.png`.
**Location:** brand assets in `docs/assets/brand/`; concept frames in `docs/assets/concept/`; deploy copies in `public/brand/`. Fonts self-hosted under `public/fonts/` (Latin-subset WOFF2).
**Approval / retirement:** the DSD DRI (ArkiLaunch design owner) approves asset changes; superseded files retire on a version bump and are removed from `public/` once no build references them.

---

## Self-Check

- [x] §0 to §1 carried verbatim from the DSD; no `{{PLACEHOLDER}}` values remain
- [x] §2 (Logo) and §3 (Imagery) match DSD §2.2/§2.4 exactly; assets are honestly marked "to produce", none claimed to exist
- [x] §4 (Application Examples) matches DSD §8.4 exactly
- [x] §5 (Section 0 Compliance Check) matches DSD §8.6, with cross-references repointed at DESIGN.md §4.1 (the section actually lives there, not in this file)
- [x] §6 links `docs/voice-arkilaunch.md`; this file no longer has a missing voice link
- [x] §7 (Governance) matches the DSD's Asset Governance content
- [x] No duplication of DSD §2.0/2.1/2.3/2.5 (token/color/typography/elevation) or §8.1-8.3/8.5 (audit machinery); those are DESIGN.md's, not repeated here
- [x] Own section numbering is contiguous (0, 0.5, 1, 2, 3, 4, 5, 6, 7); no gaps
- [x] AGENTS hard bans applied (no em-dashes)

**Marketing-tier amendment (CR: dsd-marketing-tier, 2026-08-02):**
- [x] Named tiers (§0), the Anti-References scope note (§0), and the Application Examples S1 row (§4) carried from the DSD; each tagged `CR: dsd-marketing-tier`
- [x] No verbal-identity content duplicated from DESIGN.md's marketing token/component sections; this file stays to the verbal/brand-stance layer per the §9 split contract
