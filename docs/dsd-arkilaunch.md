# Design System Document (DSD)

**System Name:** Yardboard (the ArkiLaunch design system)
**Project:** ArkiLaunch (Web-Based Construction Equipment Rental Management System)
**Date:** 2026-07-25
**Version:** 0.1
**Owner:** ArkiLaunch Team (Almara Construction capstone)
**Status:** Locked
**Last reconciled:** 2026-08-02; marketing-tier amendment recorded via Change Record `docs/cr-arkilaunch-dsd-marketing-tier.md`, reconciled against the new `apps/web/src/index.css` token layer and console primitives
**PRD:** [prd-arkilaunch.md](prd-arkilaunch.md)
**IDEA:** [idea-arkilaunch.md](idea-arkilaunch.md)
**Mode:** Product Mode (task-first); the public catalog and landing borrow a thin Brand-Mode layer, noted where it applies.

---

> **Note:** This DSD is the source of truth for ArkiLaunch's visual and verbal identity. `BRAND.md` (verbal) and `DESIGN.md` (visual) at the project root are materialized from this document, not hand-edited. It aligns with the PRD screen inventory (§5.1, S1 to S25) and the IDEA visual direction (§5). Feature IDs `PRD-F1` to `PRD-F8` and screen IDs `S1` to `S25` are frozen upstream; this doc references them, it never renumbers them.

---

## 0. Brand Stance

> Filled before §1 to §9. Every downstream token, component, and motion rule is constrained by what is locked here.

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

**Named tiers (CR: dsd-marketing-tier):** the Brand-Mode exception above is formalized as a second token **tier**, not just a loose exception, because it now carries its own radius scale, elevation language, and motion budget (§2 to §5). Every screen belongs to exactly one tier:

| Tier | Screens | Governs |
|---|---|---|
| **Console** (default) | S2 to S21, S25; all authed, task-first surfaces | The instrument-panel system as specified throughout this DSD: tight radii, border-first depth, <=250ms motion, IBM Plex only. |
| **Marketing** | S1 Public Landing, S22 Catalog Browse | The SprintForge-derived surface merged in by this amendment: large radii, layered/glass depth, Instrument Serif accent, rise-in/drift motion, all behind the §6 progressive-enhancement gate. |

A component never silently crosses tiers. The tier is set once, on a route wrapper (`data-tier="marketing"` on the root of S1/S22, unset elsewhere), and every token below that reads "marketing" or carries an `-mk` suffix applies only inside that scope.

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

**Scope note (CR: dsd-marketing-tier):** "Default SaaS purple" and "Enterprise SaaS coldness" stay absolute anti-references, everywhere, no exception. Glassmorphism and floating-card depth theater, previously banned outright, are now banned in **Console tier only** (§0 Named tiers); the Marketing tier (S1, S22) is permitted the SprintForge-derived glass nav and layered shadows under the explicit perf gate in §6, because Rhea never works from that surface on her cheap Android in the field, a first-time visitor evaluating the product does.

---

## 0.5 Concept Visuals (from IDEA)

*Carried forward from [idea-arkilaunch.md](idea-arkilaunch.md) §5. Lo-fi frames are **not yet generated**: image-generation tooling is unavailable this session (the open gap tracked as [scrutiny G-9](scrutiny-arkilaunch.md)). The visual direction below is the approved brief for those frames when tooling lands. No image asset is claimed to exist.*

**IDEA link:** [idea-arkilaunch.md](idea-arkilaunch.md) §5

**Approved visual direction (one sentence, from IDEA §5):** Field-rugged, high-contrast, data-dense "control room for the yard": trustworthy and legible on a cheap Android over a 3 to 5 Mbps connection, not default SaaS purple; Filipino-MSME-relatable, not enterprise-cold.

| Screen / section | Asset path | Approved in IDEA? | DSD notes |
|------------------|------------|-------------------|-----------|
| Admin dashboard (fleet + weather) | `docs/assets/concept/` (to be generated) | Direction yes; frame no | Maps to S4. Brief: work-queue-first control room; weather banner strip up top (PAGASA scale), fleet utilization tiles as gauge readouts, review-queue count as a lamp. |
| EDTR scan + reconciliation review | `docs/assets/concept/` (to be generated) | Direction yes; frame no | Maps to S7 + S8. Brief: side-by-side original handwritten image (zoom/pan) vs extracted fields with per-field confidence chips and a two-log delta bar. The load-bearing screen; see §4.1 Evidence Split View. |
| Client booking + quote | `docs/assets/concept/` (to be generated) | Direction yes; frame no | Maps to S5/S6 (quote) and S22 to S24 (booking). Brief: quote builder with live diesel-price readout and staleness label; printable output; catalog cards that survive a slow connection. |

**Tooling status:** none run yet. Planned per IDEA: taste-skill `imagegen-frontend-web` / `imagegen-frontend-mobile` plus `/impeccable shape` on the hero and the EDTR reconciliation flow before §2 tokens harden into code.

**UX shape pass:** deferred. Run `/impeccable shape` on S4 (dashboard) and the S7 to S9 trusted-billing loop before implementation, when the harness supports it.

---

## 1. Design Philosophy & Vision

**Core aesthetic:** Instrument-panel utilitarianism with Filipino warmth. Flat structural surfaces bounded by honest 1px borders (not floating glass), amber-and-steel signal color that carries meaning, and every operational number set in a tabular mono "gauge" so a yard crew reads it like a machine display. Density is high but the touch targets and contrast are built for a thumb in outdoor light, not a mouse on a retina screen.

**Emotional intent:** Rhea should feel *in control and unafraid of the number*. Nothing deducts money or issues a bill without a visible, traceable source next to it. The tone is a competent dispatcher, not a cheerful onboarding wizard: calm, legible, protective of the user's billing integrity.

**Aesthetic references:** Caterpillar / Komatsu operator instrument clusters; Philippine port and jeepney dispatch boards; PAGASA weather-warning color language; fuel-price signage. The nearest software cousins are logistics and fleet-ops control boards, not consumer SaaS dashboards.

**What this system explicitly avoids:**
- Purple/indigo gradients and gradient text (the category slop default; carries no yard meaning). Applies everywhere, both tiers.
- Glassmorphism, heavy blur, and floating-card depth theater in the **Console tier** (fails on cheap Android GPUs and reads as decoration, not signal). Permitted in the **Marketing tier** only, behind the §6 progressive-enhancement gate; see §0 Named tiers.
- Hover-only affordances, hairline dividers, and sub-12px data rows (die on touch and in the sun). Applies everywhere, both tiers.
- Auto-playing or looping animation, and skeleton shimmer as the default loading gesture (burns battery and bandwidth for no information). Applies everywhere, both tiers; the Marketing tier's rise-in/drift motion (§5) is state-driven and gated by `prefers-reduced-motion`, not a shimmer loop.

---

## 2. Brand Primitives

### 2.0 Token Architecture

Three tiers, enforced in the Tailwind config and in materialized `DESIGN.md`:

- **Primitive**; raw values, no meaning. e.g. `--steel-900: #10151B`, `--amber-500: #F2A100`, `--pagasa-red: #C42B1C`.
- **Semantic**; meaning, mapped from primitives. e.g. `--color-primary: var(--amber-500)`, `--weather-red: var(--pagasa-red)`, `--recon-discrepancy: var(--pagasa-red)`.
- **Component**; scoped, mapped from semantic. e.g. `--button-primary-bg: var(--color-primary)`, `--pill-danger-bg: var(--recon-discrepancy)`.

Tables below name **semantic** tokens; primitive refs are documented in the DESIGN.md materialization. Light theme is default (built for outdoor daytime); a "night yard" dark override is in §2.1.

**Tier axis (CR: dsd-marketing-tier):** the semantic layer now also carries a **tier**, orthogonal to light/dark theme. Console semantic tokens (as specified throughout this document) apply by default. Marketing-tier tokens are named with an `-mk` suffix (e.g. `--radius-mk-lg`, `--color-bg-mk`) and only resolve inside `[data-tier="marketing"]` (§0 Named tiers). Both tiers draw from the same primitive layer; no new primitive family is introduced except where §2.1 notes one explicitly. Component tokens are unchanged by this axis: a component is built for one tier and does not need tier-aware component tokens.

### 2.1 Colors

Palette is high-contrast by construction, verified for WCAG 2.2 AA at the pairings noted, and legible on a low-end panel in outdoor light. Every hue carries a job; there is no decorative color.

**Core surfaces and text (light theme, default)**

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#F5F2EB` | Page background. Warm concrete/paper, not pure white, to cut glare on a bright phone in the sun. |
| `--color-surface` | `#FFFFFF` | Cards, panels, table bodies. |
| `--color-surface-sunk` | `#ECE7DB` | Insets, code/data wells, the original-image tray in the Evidence Split View. |
| `--color-border` | `#CFC7B6` | Dividers, input borders. 1px, deliberately visible (no hairlines). |
| `--color-border-strong` | `#9A917E` | Table grid, section separators, gauge bezels. |
| `--color-primary` | `#F2A100` | Primary action (signal amber). **Pairs with dark text `#10151B` only**; amber + white fails AA. |
| `--color-primary-hover` | `#D98C00` | Primary hover/active. |
| `--color-accent` | `#1E5F8C` | Dispatch blue: links, active nav, focus ring, secondary action. Pairs with white text or as text on `--color-bg`. |
| `--color-accent-hover` | `#164B6E` | Accent hover/active. |
| `--color-text` | `#10151B` | Body copy, primary numerals (steel black). 16.8:1 on `--color-bg`. |
| `--color-text-muted` | `#45566A` | Secondary text, labels, table meta. 6.7:1 on `--color-bg`. |
| `--color-text-inverse` | `#F5F2EB` | Text on dark and on `--color-accent`/`--color-error` fills. |
| `--input-focus-ring` | `var(--color-accent)` (`#1E5F8C`) | The single focus-ring color for every focusable element (inputs, buttons, links, tab stops); rendered `2px solid`, `2px` offset. Never removed, never color-only (also relies on the visible offset, not hue alone). |
| `--color-success` | `#1F7A3D` | Confirmations, "logs match", healthy fleet. White text 5.4:1. |
| `--color-warning` | `#C9A100` | Caution, low-confidence, stale data. **Dark text only.** |
| `--color-error` | `#C42B1C` | Errors, destructive actions, blocking states. White text 5.6:1. |

**Weather-risk scale (semantic; PRD-F5, screens S13/S14)**; grounded in PAGASA rainfall warnings so the color reads correctly to any Filipino user before they read the label. Never color-only; always paired with a label and an icon (§6).

| Token | Value | Text pairing | Meaning |
|-------|-------|--------------|---------|
| `--weather-clear` | `#1F7A3D` | white | No advisory; safe to operate. |
| `--weather-yellow` | `#C9A100` | dark `#10151B` | PAGASA yellow: monitor; flooding possible in low-lying sites. |
| `--weather-orange` | `#D9600A` | dark `#10151B` | PAGASA orange: prepare; flooding threatening, review deployments. |
| `--weather-red` | `#C42B1C` | white | PAGASA red: serious/widespread flooding; stop-work advisory, incident auto-logged. |
| `--weather-stale` | `#6B7C8E` | white | Reading is cached/last-known (Open-Meteo unavailable); advisory marked stale, not dropped. |

**Reconciliation + OCR-confidence scale (semantic; PRD-F3/PRD-F6, screens S7/S8/S17)**; the states from the PRD reconciliation gate, given one consistent color language across EDTR billing and KYC.

| Token | Value | Text pairing | Meaning |
|-------|-------|--------------|---------|
| `--recon-match` | `#1F7A3D` | white | Two independent logs agree within tolerance; high confidence. Auto-accept eligible. |
| `--recon-review` | `#C9A100` | dark `#10151B` | A field is below the confidence threshold; routed to human review queue. Never auto-accepted. |
| `--recon-discrepancy` | `#C42B1C` | white | Logs diverge beyond tolerance; deposit deduction **blocked** until a human resolves it. |
| `--recon-failed` | `#45566A` | white | Unreadable/corrupt upload; hard-failed to manual entry. No value fabricated. |
| `--recon-approved` | `#0F6E6E` | white | Human-approved and posted; deduction committed with cited evidence (distinct teal so "done" never reads as "auto-matched"). |

**Confidence chips** reuse the reconciliation scale: field confidence at or above the gate uses `--recon-match`; below the gate uses `--recon-review`; a field OCR could not read uses `--recon-failed`. The numeric confidence (e.g. `0.87`) is always shown next to the chip in the mono gauge face.

**Dark theme ("night yard") overrides**; for low-light offices and AMOLED battery saving. Same semantic names, remapped primitives:

| Token | Value |
|-------|-------|
| `--color-bg` | `#10151B` |
| `--color-surface` | `#1B2530` |
| `--color-surface-sunk` | `#141C24` |
| `--color-border` | `#33404D` |
| `--color-border-strong` | `#55677A` |
| `--color-text` | `#F2EEE4` |
| `--color-text-muted` | `#A9B4C0` |
| `--color-primary` | `#F2A100` (unchanged; still dark-text) |
| `--color-accent` | `#4FA3D9` (lightened for AA on dark) |

Signal hues (success/warning/error/weather/recon) hold their hue in dark theme; borders and text lift to keep AA. Theme is toggled by `data-theme` on the root; default is light.

**Marketing surface tokens (CR: dsd-marketing-tier)**; scoped to `[data-tier="marketing"]` (§0, §2.0). This is the merged SprintForge shell, re-tinted warm so it reads as one brand with the console rather than a cool, separate skin. `--color-primary` (amber `#F2A100`) stays the single brand accent in this tier too; SprintForge's signature orange `#E34A32` is dropped entirely; it sat between `--weather-orange` (`#D9600A`) and `--color-error` (`#C42B1C`) and would have diluted both semantic scales.

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg-mk-frame` | `#ECE7DB` | Outer page frame ("shell in shell" outer layer). Reuses the existing `--color-surface-sunk` primitive; no new hue introduced. |
| `--color-bg-mk` | `#F5F2EB` | Inner rounded container. Same value as console `--color-bg`, so the temperature does not jump when a visitor moves from marketing into the app. |
| `--color-surface-mk` | `#FFFFFF` | Floating cards on marketing surfaces. Same value as console `--color-surface`. |
| `--color-ink-mk` | `#171719` | Near-black display headline color; darker than steel `#10151B`, used only for large marketing display type, never for body text or console surfaces. |
| `--color-primary-ink` | `#7A5200` | **New primitive.** Amber-family text color for small amber text on a light surface (e.g. a status-chip label), where amber `#F2A100` itself would fail AA on white. Verified 6.9:1 on `#FFFFFF`, 6.2:1 on `#F5F2EB` (both >= 4.5:1). Marketing tier only; console never sets amber text on light, it always pairs amber fills with dark text per §2.1 core table. |
| `--border-glass` | `rgba(255,255,255,0.7)` | Floating nav edge, marketing tier only. Decorative border, not a text/UI contrast pairing. |

Marketing muted body text reuses the existing verified `--color-text-muted` (`#45566A`, 6.7:1 on `#F5F2EB`) rather than importing a new gray; there is no marketing-specific muted token.

### 2.2 Logo System

*Source for BRAND.md §2. Rules, not just files. Assets are not yet produced this session; the direction below is the brief.*

**Direction:** an "A" set as a **gauge needle / dispatch chevron** inside a bezelled square lamp, in signal amber on steel black. It should read as an instrument indicator, not a startup swoosh. Wordmark "ArkiLaunch" set in the condensed display face (see §2.3), all-caps, tight tracking, dispatch-board cadence.

| Variant | Asset path | Use when |
|---------|------------|----------|
| Primary | `docs/assets/brand/logo-primary.svg` (to produce) | Default lockup: mark + wordmark, horizontal. App bar, landing, quote/invoice header. |
| Secondary | `docs/assets/brand/logo-stacked.svg` (to produce) | Tight/narrow space: mark over wordmark. Mobile app bar, timekeeper console. |
| Icon / mark | `docs/assets/brand/logo-mark.svg` (to produce) | Favicon, PWA icon, notification badge. The bezelled amber "A" lamp alone. |

**Tenant lockup rule (Rule 3):** in the authed app bar and on a tenant's public catalog, the **tenant's** name/mark leads; "Powered by ArkiLaunch" is the secondary line. ArkiLaunch never overrides the tenant identity inside a tenant's own workspace.

**Clear space:** 1x the mark's bezel height on all sides.
**Minimum size:** mark 24px (favicon 16px permitted); full lockup wordmark cap-height >= 14px.
**Approved backgrounds:** `--color-bg`, `--color-surface`, steel black `#10151B`. On a photo, place on a solid steel scrim; never directly on a busy yard photo.

**Don'ts:** do not recolor the mark outside amber/steel, do not add a drop shadow or bevel-gloss, do not stretch or rotate the needle, do not place the ArkiLaunch mark above a tenant's mark inside that tenant's workspace, do not use a deprecated file after a version bump (§9).

### 2.3 Typography

Chosen for small-size legibility on a low-end Android and for provenance: **IBM Plex** has an engineering/machine heritage that fits the gauge-cluster reference, ships a true condensed sibling for the dispatch-board display voice, and a mono for the instrument readouts. Not Inter (the category slop default). Payload is controlled by self-hosted, Latin-subset WOFF2 with a Roboto/system fallback, so first paint is instant on 3 to 5 Mbps.

| Role | Font | Weight | Size | Line Height |
|------|------|--------|------|-------------|
| Display / H1 | IBM Plex Sans Condensed | 600 | 28px (mobile) / 34px (desktop) | 1.15 |
| Heading 2 | IBM Plex Sans Condensed | 600 | 22px / 26px | 1.2 |
| Heading 3 | IBM Plex Sans | 600 | 18px / 20px | 1.25 |
| Body | IBM Plex Sans | 400 | 16px | 1.5 |
| Small / Caption | IBM Plex Sans | 500 | 13px | 1.4 |
| Label / Overline | IBM Plex Sans Condensed | 600 | 12px (uppercase, +0.04em) | 1.3 |
| Numeric / Data ("gauge") | IBM Plex Mono | 500 | 15px, `tabular-nums` | 1.4 |

**The gauge rule (Rule 2, the craft mark):** every operational number, hours (active/idle), km, peso amounts (`₱`), diesel price, confidence values, deposit balance, delta-vs-tolerance, renders in IBM Plex Mono with `font-variant-numeric: tabular-nums` so columns align like an instrument face. Prose never uses mono; data never uses the prose face. This is the deliberate idiosyncrasy an AI default would not choose (§8 compliance).

**Minimum body size:** 16px on all screens (never below; guards outdoor legibility and prevents mobile-Safari zoom). Data captions never below 13px.
**Font loading:** self-hosted `/fonts/*.woff2`, Latin subset, `font-display: swap`, `<link rel="preload">` on the two most-used cuts (Plex Sans 400, Plex Mono 500). Total font payload budget: <= 90KB over the wire (Console tier; see marketing budget below).
**License / fallback:** IBM Plex is SIL Open Font License 1.1 (free to self-host and embed). Fallback stack: `"IBM Plex Sans", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif`; mono falls back to `"IBM Plex Mono", "Roboto Mono", ui-monospace, monospace`. Roboto is already resident on Android, so the fallback render is legible with zero download.

**Marketing typography (CR: dsd-marketing-tier)**; IBM Plex stays the type system on marketing surfaces too, not Inter; the single addition is an accent face for editorial emphasis, matching BRAND.md's rejection of "Inter everywhere" as the category slop default.

| Role | Font | Weight | Size / Notes |
|---|---|---|---|
| `accent-serif` | Instrument Serif | 400, italic | `letter-spacing: -0.01em`. Used sparingly, for a headline's emotional accent word or phrase only, never for a full heading or for body copy. |
| Marketing display | IBM Plex Sans Condensed | 600 base | `text-5xl` mobile, `sm:text-7xl`, `lg:text-8xl`; `letter-spacing: -0.035em`. |

**Variable-weight interaction:** SprintForge's pointer-proximity weight effect is adopted on marketing display type, applied to **IBM Plex Sans, not Inter**. Verified against the actual self-hosted files (§9 Materialization): IBM Plex Sans ships a true variable font with a `wght` axis spanning **100 to 700**; IBM Plex Sans Condensed does not (static instances only, one file per weight). The effect therefore renders on Plex Sans Variable, and the ceiling is **700, not 900**; SprintForge's literal 600-to-900 range does not exist in this type family and is not faked with `font-synthesis`. Base weight 600, rising toward 700 within a 200px pointer radius, `font-variation-settings` transition `150ms linear`. Pointer-only; never bound to touch (§6).

**Marketing font budget:** <= 110KB over the wire (raises the console's 90KB ceiling by the Instrument Serif italic cut only; every other face is shared with console and already counted there). Instrument Serif is **not** preloaded, since nothing on a console route uses `.font-serif-accent`, so it is fetched only when a marketing route actually renders it.

### 2.4 Imagery & Illustration

*Source for BRAND.md §3.*

**Style:** documentary, not stock. Real equipment in real Luzon yards and sites, shot in available light; the grit stays. Where photography is unavailable, use flat two-color diagrams (steel + amber) in the instrument-panel idiom, not soft rounded 3D blobs. The single most important "image" in the product is not decorative at all: it is the **user's own handwritten EDTR**, shown at full fidelity beside the extracted data.

**AI positive prompts:** "documentary photo, Philippine construction equipment yard, backhoe/excavator, overcast Luzon daylight, working crew, unstyled, mud and wear visible, high dynamic range, no logos"; for diagrams: "flat two-color technical schematic, steel-blue and safety-amber, instrument panel style, high contrast, thick strokes".
**AI negative prompts:** "no purple, no indigo gradient, no glassmorphism, no glossy 3D render, no smiling stock team in clean hardhats, no lens flare, no neon, no floating UI cards, no Western corporate office".
**Reference assets:** `docs/assets/concept/` (to be generated; see §0.5). The handwritten-EDTR sample fixtures live with the OCR test corpus, not in brand assets.

### 2.5 Elevation & Depth

Depth is restrained and mostly done with borders, not shadow theater. Low blur radii keep it cheap to composite on a low-end GPU. Structure comes from the honest border first, shadow second.

| Level | CSS Value | Usage |
|-------|-----------|-------|
| `--shadow-sm` | `0 1px 2px rgba(16,21,27,0.10)` | Inline cards, table cards, tiles. Border does most of the work. |
| `--shadow-md` | `0 2px 6px rgba(16,21,27,0.14)` | Sticky table header, dropdowns, the floating action bar. |
| `--shadow-lg` | `0 6px 20px rgba(16,21,27,0.22)` | Modals, the KYC review panel, image-zoom overlay. |

No `backdrop-filter: blur()` on content surfaces (perf on cheap Android); the modal scrim is a flat `rgba(16,21,27,0.55)` with no blur.

**Marketing elevation (CR: dsd-marketing-tier)**; the SprintForge "shell in shell" depth language, scoped to `[data-tier="marketing"]` (S1, S22 only) and gated by §6's progressive-enhancement rules. This block does not apply to Console.

| Token | CSS Value | Usage |
|---|---|---|
| `--shadow-mk-inset` | `0 1px 0 rgba(255,255,255,0.9) inset` | Inner highlight on the rounded shell container; simulates a physical top edge. |
| `--shadow-mk-card` | `0 14px 30px -18px rgba(35,36,39,0.25)` | Floating feature/package cards. |
| `--shadow-mk-nav` | `0 10px 30px -14px rgba(35,36,39,0.25)` | Floating nav, shown only once `scrollY > 24`. |
| `--blur-mk-nav` | `24px` (`backdrop-filter: blur(24px)`) | Glass nav only. The one permitted `backdrop-filter` in the system; every other surface, both tiers, stays flat. |

---

## 3. Layout & Spatial System

**Base unit:** `4px`; all spacing is a multiple. Spacing tokens follow the same primitive to semantic tiering as §2.0.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | `4px` | Tight internal gaps, chip padding. |
| `--space-2` | `8px` | Component internal padding, table cell vertical. |
| `--space-3` | `12px` | Medium gaps, form field spacing. |
| `--space-4` | `16px` | Default element spacing, card padding (mobile). |
| `--space-6` | `24px` | Section gaps, card padding (desktop). |
| `--space-8` | `32px` | Large section gaps. |
| `--space-12` | `48px` | Page-level spacing, landing rhythm. |

**Grid:** 12-column fluid, max-width `1440px` for app content (control-room surfaces earn the width), 24px gutters on desktop. Data tables and the Evidence Split View may go full-bleed to the content edge. Mobile-first single column for the timekeeper console (S21) and customer portal (S22 to S24). Content never scrolls horizontally at the page level; wide tables scroll inside their own `overflow-x: auto` container (§4.1).

**Corner radius scale (Console tier):** `--radius-sm: 4px` (chips, inputs, buttons), `--radius-md: 6px` (cards, panels), `--radius-lg: 8px` (modals). Deliberately tight; this is an instrument panel, not a pill-shaped consumer app. No fully-rounded ("rounded-everything") surfaces on Console.

**Breakpoints** (tuned to the real fleet of devices, cheap Android first):
- Mobile: `360px` (common budget-Android width; the design baseline, not an afterthought)
- Tablet: `768px`
- Desktop: `1024px`
- Wide: `1440px` (control-room dashboards, wide fleet tables)

**Marketing spatial system (CR: dsd-marketing-tier)**; scoped to `[data-tier="marketing"]`. This is the sharpest visual break from Console by design: a first-time visitor is not reading an instrument panel, so the radius and rhythm can afford to be generous. Console's 4/6/8px scale is unchanged and still governs every authed screen.

**Marketing radius scale:** `--radius-mk-sm: 8px`, `--radius-mk-md: 16px`, `--radius-mk-lg: 24px`, `--radius-mk-xl: 28px`, `--radius-mk-container: 40px` (the outer shell), `--radius-pill: 999px` (interactive pills only, e.g. proof-section numerals, nav CTA).

**Marketing section rhythm:** `--space-mk-section-v: 128px` vertical gap between major sections (hero, services, proof, capabilities, work, packages, studio, footer CTA), reusing the same `--space-*` primitives elsewhere on the page.

**Shell-in-shell structure:** the page root is `max-width: 1440px` (matches the existing Console app-content max-width, so this is consistent, not a new number) with `--color-bg-mk-frame` as the outer frame; the main content area sits in a `--radius-mk-container` (28px mobile, 40px desktop via `sm:`) rounded container on `--color-bg-mk`, carrying `--shadow-mk-inset` (§2.5) as its top-edge highlight; cards inside it sit on `--color-surface-mk`.

---

## 4. Core Component Specs

*Behavior and every visual state. Engineering builds from this. States tie to the PRD §5.1 screen inventory.*

### Buttons

| Variant | Background | Text | Border | Hover | Focus | Disabled |
|---------|-----------|------|--------|-------|-------|----------|
| Primary | `--color-primary` (amber) | `#10151B` (dark, required) | none | `--color-primary-hover` | `--input-focus-ring`, 2px, 2px offset | 40% opacity, `not-allowed` |
| Secondary | transparent | `--color-accent` | 1px `--color-accent` | `--color-surface-sunk` bg | `--input-focus-ring`, 2px, 2px offset | 40% opacity |
| Ghost | transparent | `--color-text` | none | `--color-surface-sunk` bg | `--input-focus-ring`, 2px, 2px offset | 40% opacity |
| Destructive | `--color-error` | white | none | darkened error `#A3241A` | `--input-focus-ring`, 2px, 2px offset | 40% opacity |
| Approve (recon) | `--color-success` | white | none | darkened `#186031` | `--input-focus-ring`, 2px, 2px offset | 40% opacity; disabled until logs match + fields resolved (S8) |

**Border radius:** `--radius-sm` (4px).
**Padding:** `12px 20px` desktop; `14px 20px` on the timekeeper console (larger for gloved/field taps).
**Font:** IBM Plex Sans 600, 15px.
**Min size:** 44x44px everywhere; 48x48px on the timekeeper console (S21) and any outdoor/field action (§6).
**Focus:** `--input-focus-ring` (§2.1); never removed.
**Loading:** label swaps to a static "Working..." with a small non-looping spinner; the button stays its own size (no layout shift). Amber primary must never go white-on-amber even while loading.

### Inputs & Forms

- Border: `1px solid --color-border`; `--color-border-strong` on hover.
- Border radius: `--radius-sm` (4px).
- Focus ring: `2px solid --input-focus-ring` (§2.1), `2px` offset. Always visible, keyboard and pointer alike.
- Error state: `--color-error` border plus error text below in `--color-error`, plus an icon (never color-only; §6). Message is specific ("Diesel price is 3 days old", not "Invalid").
- Padding: `12px 14px`; label above the field (never placeholder-as-label).
- Numeric inputs (hours, km, rates): IBM Plex Mono, right-aligned, `inputmode="decimal"`, tabular.
- Min touch height: 44px; 48px on the field console.

### Surfaces (Cards, Modals, Panels)

- Background: `--color-surface`.
- Border: `1px solid --color-border` (the primary structure).
- Border radius: `--radius-md` card, `--radius-lg` modal.
- Shadow: `--shadow-sm` inline, `--shadow-md` floating, `--shadow-lg` modal.
- Modal backdrop: `rgba(16,21,27,0.55)`, no blur. Focus trapped; `Esc` closes non-destructive modals; a destructive modal (e.g. reject reconciliation) requires an explicit button, not backdrop-click.

### Domain components (Yardboard-specific)

**Status Pill**; compact state marker used across tables and queues. Filled chip, `--radius-sm`, icon + label, mono value where numeric. Draws its color from the weather or reconciliation scale (§2.1). Never color-only; the label carries the meaning. States: `match`, `review`, `discrepancy`, `failed`, `approved` (recon); `available`, `deployed`, `maintenance-due`, `retired` (fleet); weather `clear/yellow/orange/red/stale`.

**Confidence Chip**; the OCR per-field marker at reconciliation and KYC. Shows the scale color (`match`/`review`/`failed`) plus the raw confidence in mono (`0.87`). Below-gate chips are visually louder (they demand a human), not quieter.

**Gauge Readout**; the framed mono numeric tile for a single key figure (diesel price, deposit balance, utilization %, recovered billable hours). Bezelled with `--color-border-strong`, big tabular mono, a small overline label, an optional trend/stale marker. This is the interface's signature moment.

**Weather Banner**; full-width strip (§4.1) driven by the weather scale; carries site name, condition, timestamp, and a stale marker when cached.

**Evidence Split View**; the reconciliation review surface (§4.1); the original handwritten image beside the extracted, editable fields.

**Hazard Divider**; a diagonal amber/black stripe rule used only to fence a blocking/danger region (reconciliation discrepancy, stop-work weather, unverified KYC). Never decorative; its presence means "do not proceed until resolved".

### Marketing components (CR: dsd-marketing-tier)

*Specified now; **not built this pass** (deferred, per the accompanying Change Record's scope note). These exist so the landing page (S1) has a documented component contract to build against when it is scheduled, rather than being designed ad hoc off the SprintForge reference at build time.*

**FloatingNav**; centered, sticky, translucent nav (`--blur-mk-nav`, `--border-glass`, `--shadow-mk-nav` only once `scrollY > 24`). Tenant/ArkiLaunch lockup rule (§2.2) still applies if a tenant surface ever reuses this component.

**FeatureTile**; white `--color-surface-mk` card, `--radius-mk-lg`, 48px square icon (Lucide, 1.5 stroke, matching Console's icon discipline), a short caption, and a status-style label. Hover: `-translate-y-1`, 300ms `cubic-bezier(0.34, 1.56, 0.64, 1)` (marketing hover-lift, §5).

**ProofPill**; oversized `--radius-pill` pill, numeral in `--color-ink-mk`, unit label in `--color-primary-ink` (never raw amber-on-white; §2.1). Three pills overlap with `-space-x-6` at desktop width, each at a distinct slight rotation (`-1deg` / `0` / `1deg`).

**PackageCard**; vertical pricing card. Featured variant scales `1.04`, sits `z-10`, uses `--color-ink-mk` background with inverse text and `--shadow-mk-card` at higher opacity; outer variants sit on `--color-surface-mk` with a `±1deg` rotation.

**RiseIn**; the reveal wrapper for `data-rise`/`data-reveal` elements: `opacity-0 translate-y-4` to `opacity-100 translate-y-0`, IntersectionObserver-driven, 700ms ease-out (§5). Collapses to instant under `prefers-reduced-motion` (§6), same as every other motion primitive in this document.

### 4.1 Composition Patterns

*Source for DESIGN.md §4.1 (same number; DESIGN keeps DSD's own §2-§8 top-level numbering). Multi-component flows aligned to PRD §5.1/§5.2. Each names its screens and its four states (empty/loading/error/success); the Empty state and Loading state rows are the cross-cutting patterns those four-state columns reference, so they define the template rather than repeating it.*

| Pattern | Components | When to use (screens) | Do / Don't |
|---------|------------|-----------------------|------------|
| **Data-dense fleet table** | Sticky header + Status Pill + Gauge Readout cells + row actions + `overflow-x` scroll container + density toggle | S10 Fleet Inventory, S11 Equipment Detail, S15/S20 Reports, S16 Bookings | **Do:** freeze the header on scroll; right-align mono numerics with tabular figures; keep row height >= 44px; put actions as visible buttons, not hover-reveal; scroll wide tables inside their own container. Empty: "No equipment yet" + primary "Add equipment". Loading: static row placeholders (no shimmer). Error: inline banner + retry, keep last-good rows if cached. Success: rows with Status Pills. **Don't:** hairline dividers, hover-only actions, sub-13px text, horizontal page scroll. |
| **Project sites & deployment** | Site list/map pins + lat/long fields + deploy/return equipment picker + conflict banner | S12 Project Sites & Deployment (PRD-F4) | **Do:** show a clear conflict message when deploying an already-assigned unit; keep site lat/long editable inline for the weather poll (S13/S14). Empty: "No sites yet" + primary "Add a site". Loading: static placeholder rows. Error: deploy conflict shows the unit's current site/assignment, not a generic error. Success: unit shows `deployed` Status Pill at the new site. **Don't:** allow a silent double-deploy; hide which site a unit is already at. |
| **EDTR scan + reconciliation review (Evidence Split View)** | Original image panel (zoom/pan **with button controls**, not drag-only) + extracted-fields form + Confidence Chips + two-log delta bar (Log A vs Log B vs tolerance) + Hazard Divider on discrepancy + Approve/Reject | S7 EDTR Capture, S8 Reconciliation Review Queue | **Do:** show the handwritten image at full fidelity beside the fields, always; highlight below-gate fields loudly; show `delta_hours` vs tolerance in mono; disable Approve until all fields resolved and logs match; on hard-fail route to manual entry with the image still shown. Empty: "Queue clear". Loading (OCR async): "Queued / Processing" state, UI never blocks. Error: unreadable -> manual entry, never a fabricated value. Success: `--recon-approved` teal + evidence citation. **Don't:** hide the source image, auto-accept a below-gate field, let a discrepancy deduct. |
| **Quotation builder** | Rate-card selector + km input + live diesel Gauge Readout (with date + staleness label) + computed line items + sub-60s target + printable preview | S5 Quotation Builder, S6 Quote Preview & Print | **Do:** compute live as inputs change; label the diesel price with its date; on stale price show an amber staleness warning and still price (never silently against unknown); produce a clean print stylesheet for S6. Empty: prefilled defaults + "Pick equipment". Loading: price fetch skeleton on the diesel tile only. Error (stale): warning banner, last-known price used. Success: printable quote, `quote_generated` fired with latency. **Don't:** block the whole form on the price fetch; hide the price date. |
| **Weather advisory banner** | Weather Banner (PAGASA scale) + site name + condition + timestamp + stale marker + link to incident log | S4 Dashboard strip, S13 Weather Advisories, S14 Liability Incident Log | **Do:** color from the weather scale with a label and icon (never color-only); mark cached readings `--weather-stale`; link a red advisory to its auto-logged incident. Empty: "All sites clear". Loading: skeleton strip. Error (API down): serve cached, mark stale, do not drop the row. Success: live advisory. **Don't:** use red for a stale/unknown state; imply a live reading when it is cached. |
| **Booking flow** | Catalog card grid + cart + availability guard + PayMongo redirect + Transaction Tracker | S22 Catalog Browse, S23 Cart & Checkout, S24 Transaction Tracker | **Do:** compress catalog images for 3 to 5 Mbps; re-check availability at checkout; redirect to PayMongo hosted checkout (store only the returned reference/status); reconcile status via webhook, not the browser redirect alone. Empty: "This yard has no listed equipment yet". Loading: card placeholders. Error: unavailable -> offer alternatives, never overbook; payment fail -> booking stays pending with retry. Success: tracker shows order/payment/rental status. **Don't:** collect card data in-app, trust the redirect for final status. |
| **KYC review panel** | Original doc image + extracted SEC/TIN fields + Confidence Chips + portal-confirmation checklist (SEC + BIR) + Hazard Divider until verified + activate/reject | S3 Tenant Registration & OCR KYC, S17 KYC Verification Queue | **Do:** show extracted SEC/TIN beside the source doc; require the admin to confirm against SEC and BIR portals; keep tenant unverified until human confirmation; make plain the CAPTCHA-blocked step is manual by design. Empty: "No pending tenants". Loading: extraction queued. Error (low confidence / no portal match): stay unverified, no production access. Success: tenant activated, `tenant_onboarded` fired. **Don't:** auto-verify, grant access on extraction alone, show raw SEC/TIN in logs/analytics. |
| **Nav shell (role-aware)** | Top app bar (tenant mark + active-tenant badge + notifications + account) + left sidebar (admin/owner) / bottom nav (timekeeper) / top nav (customer) | All authed screens per PRD §5.2 | **Do:** lead with the tenant's mark; badge the active tenant; surface review-queue count, PM alerts, and weather advisories in notifications; strip the sidebar on the timekeeper console and during onboarding. Empty: no badge count shown when a queue is clear (not a zero). Loading: nav shell renders immediately from cached session state; badge counts populate async without blocking the shell. Error: a failed badge-count fetch shows no badge rather than a stale or wrong number. Success: badges and notifications reflect live counts. **Don't:** show cross-tenant data, put ArkiLaunch's mark above the tenant's inside their workspace. |
| **Form + validation** | Labeled inputs + inline errors + specific messages + submit with loading | S2 Login, S18 Rate Cards, S19 Users & Roles | **Do:** label above field, specific error text with icon, preserve entered data on failure. Empty: fields show their defaults, not placeholder-as-label. Loading: submit button shows the "Working..." state (§4 Buttons); fields stay editable-locked, not hidden. Error: inline per-field message, entered data preserved. Success: confirmation state, form clears or navigates per screen. **Don't:** placeholder-as-label, color-only errors, generic "Invalid input". |
| **Empty state** | Icon (two-color diagram) + one plain sentence + one primary action | Every list/queue screen | **Do:** name the real thing ("No EDTRs in the queue"), offer the next action; this pattern IS the empty state for every other pattern's Empty column, so it defines the visual template rather than needing its own separate empty/loading/error/success set. **Don't:** generic gray blob illustration, cute copy that wastes the moment. |
| **Loading state** | Layout-preserving placeholders + static "Loading..." | All async screens | **Do:** reserve layout to avoid shift; static or single opacity-pulse; this pattern IS the loading state referenced by every other pattern's Loading column. **Don't:** looping shimmer (battery/bandwidth); never block the UI while OCR runs (async). |

---

## 5. Motion & Micro-interactions

Restrained by policy: the primary device is low-power, often on battery, in the field. Motion communicates a state change or it does not ship.

**Transition default:** `all 140ms ease-out`.

| Interaction | Duration | Easing | Notes |
|-------------|----------|--------|-------|
| Button hover/active | 120ms | ease-out | Background/opacity only. No transform on touch. |
| Modal open | 180ms | ease-out | Fade + 8px translate-up. |
| Modal close | 120ms | ease-in | Fade only. |
| Pill / chip state change | 120ms | ease-out | Color crossfade when a field resolves at reconciliation. |
| Page / route transition | 0ms (opacity 100ms optional) | linear | Prefer instant on cheap Android; a subtle 100ms fade at most. |
| Loading placeholder | single 900ms opacity pulse, then hold | ease-in-out | No infinite shimmer loop. |
| Weather advisory arrival | 160ms | ease-out | Slide the banner strip; no attention-grabbing flash. |

**Avoid (Console tier):** animations over 250ms in-app; any infinite loop without user intent; parallax; motion that decorates rather than reports a state change; skeleton shimmer as the default. All non-essential motion is wrapped in `@media (prefers-reduced-motion: reduce)` and reduced to an instant state swap.

**Marketing motion (CR: dsd-marketing-tier)**; scoped to `[data-tier="marketing"]`, gated by the §6 progressive-enhancement rules. The Console rule above still governs every authed screen without exception; a first-time visitor's landing page is allowed a motion budget Rhea's daily console is not.

| Interaction | Duration | Easing | Notes |
|---|---|---|---|
| Rise-in (scroll reveal) | 700ms | ease-out | `translate-y-4 opacity-0` -> `translate-y-0 opacity-100`, IntersectionObserver-driven. |
| Drift (floating decorative tiles) | 6s | linear, infinite | `sin(t + i*2) * 6px` translateY amplitude; decorative tiles only, never a data-bearing element. |
| Hover-lift | 300ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | FeatureTile / PackageCard hover only. |
| Atmosphere parallax | continuous, pointer-driven | linear | Background bloom follows pointer, max 24px dampened offset. Pointer-only; never bound to touch or scroll-linked on mobile. |

Every row above still collapses to an instant state swap under `prefers-reduced-motion: reduce` (§6); "infinite" motion (drift, parallax) simply does not run, it does not need a reduced variant.

---

## 6. Accessibility (a11y)

Target: **WCAG 2.2 Level AA**, built for gloved hands, outdoor light, low-end Android, and 3 to 5 Mbps.

- **Contrast:** AA minimum, 4.5:1 text / 3:1 UI. Verified pairings: body `#10151B` on `#F5F2EB` = 16.8:1; muted `#45566A` on bg = 6.7:1; amber primary uses dark text (8.8:1), never white; error/red and accent/blue use white text (5.6:1 / 6.8:1); every weather and reconciliation chip meets AA at the text pairing noted in §2.1.
- **Never color-only:** every status (weather scale, reconciliation scale, fleet status) carries a text label and an icon or shape. A red/orange PAGASA banner is still legible to a color-blind user and in harsh sun.
- **Touch targets (WCAG 2.2 SC 2.5.8):** 44x44px minimum app-wide; **48x48px** on the timekeeper console (S21) and any field/outdoor action, for gloved and one-handed use.
- **Dragging alternatives (SC 2.5.7):** the Evidence Split View image zoom/pan offers button controls (zoom +/-, fit, reset), not drag-only.
- **Focus visible + not obscured (SC 2.4.7, 2.4.11):** `--input-focus-ring`, 2px, always present (§2.1); sticky headers and the floating action bar must not cover the focused element.
- **Keyboard:** every interactive element reachable and operable; reconciliation Approve/Reject, table row actions, and modal controls fully keyboard-driven; logical tab order.
- **Screen reader:** semantic HTML first; ARIA only to fill gaps. Confidence and delta values are announced ("active hours 8.0, confidence 0.87, below threshold, needs review"). The handwritten image has a meaningful alt ("original EDTR, site Bagumbayan, 2026-07-20").
- **Offline-tolerant states:** queued uploads, cached weather (stale-marked), draft quotes, and in-progress EDTR entry survive a dropped connection and resume; a failed upload never loses entered data (PRD US-02).
- **Bandwidth:** works over 3 to 5 Mbps. Client-side image compression before EDTR/KYC upload, chunked/resumable transfer with a visible progress + retry, font payload budget <= 90KB, catalog images responsive and compressed, no autoplay media.
- **Reduced motion:** all non-essential animation collapses to an instant state change under `prefers-reduced-motion: reduce`.
- **Consistent help (SC 3.2.6):** the account menu and support/contact affordance sit in the same app-bar position on every authed screen.

**Marketing progressive-enhancement gate (CR: dsd-marketing-tier)**; the condition that makes the §2.5/§5 marketing depth and motion additions compatible with the 3 to 5 Mbps / low-end-Android performance floor this document sets everywhere else:

- **WebGL mesh** (the marketing hero's faceted mesh, wherever it is eventually implemented) loads only above the `lg` (1024px) breakpoint, only when `prefers-reduced-motion` is not set, and only after a `navigator.connection`/`deviceMemory` capability check passes; a static gradient renders otherwise. The canvas is `pointer-events: none` so it never intercepts input.
- **Pointer-only effects:** mouse-proximity variable-weight type (§2.3) and atmosphere parallax (§5) are pointer-driven and simply do not bind on touch; they degrade to the static 600-weight / non-parallaxed state, not an error.
- **Touch targets:** marketing buttons and interactive pills keep the same 44x44px minimum as Console (SC 2.5.8); SprintForge's own spec independently requires this, so there is no conflict to resolve.
- **Reduced motion:** every marketing-only motion row in §5 (rise-in, drift, hover-lift, parallax) collapses under `prefers-reduced-motion: reduce`, same rule as Console.
- **Contrast:** the new `--color-primary-ink` and marketing neutral pairings are verified in §2.1; do not introduce a marketing color pairing without a stated ratio.

---

## 7. Taste-Skill Settings

```
Console (default, unchanged):
DESIGN_VARIANCE:    4   (restrained and coherent, but with a committed industrial identity; not neutral)
MOTION_INTENSITY:   2   (subtle only; low-power field devices)
VISUAL_DENSITY:     8   (control-room, data-dense; density earned by legibility and target size)
```

**Dial guide:** `DESIGN_VARIANCE` 1 = Swiss grid austerity, 10 = maximalist. `MOTION_INTENSITY` 1 = static, 10 = everything moves. `VISUAL_DENSITY` 1 = whitespace, 10 = dashboard-dense.

**Chosen variant (Console):** `output-skill`
**Reason:** ArkiLaunch is information-first and utilitarian: dispatch boards, fleet tables, reconciliation queues, printable quotes. `output-skill` matches the data-output character better than `soft-skill` (too gentle for a control room) or `minimalist-skill` (would strip the amber/PAGASA signal color that carries meaning). It is not `brutalist-skill`: the Filipino-MSME warmth and the honesty of the user's own handwriting keep it from going raw or cold. Density stays high (8) but every dense surface is disciplined by AA contrast and 44/48px targets (§6).

**Marketing dials (CR: dsd-marketing-tier)**; S1/S22 only. A first-impression surface earns a different, more expressive setting than the daily console; this is a deliberate second dial set, not a drift from the Console numbers above.

```
Marketing (S1, S22 only):
DESIGN_VARIANCE:    7   (SprintForge-derived: layered depth, large radii, editorial serif accent)
MOTION_INTENSITY:   6   (rise-in, drift, parallax; gated by §6, still capped well short of "everything moves")
VISUAL_DENSITY:     3   (image-led, generous negative space; the opposite of the console's data density)
```

**Chosen variant (Marketing):** blended `output-skill` restraint with a `soft-skill` surface treatment; not a full `soft-skill` adoption, because the amber/PAGASA signal vocabulary and IBM Plex typography still carry through from Console (§2.1, §2.3), keeping the two tiers legible as one brand.

---

## 8. Impeccable Quality Gate

*Design-time note: this DSD precedes the build (PRD M2 Design precedes M3 Development). No `src/` exists yet, so the audit and detector below are set as **launch gates and targets**, not as results claimed to have run. They are executed against `src/` in M3/M4 before anchor go-live.*

### 8.1 Phase: Start; Init

```bash
npx impeccable install
```
```
/impeccable init
```

- [ ] `/impeccable init` run; PRODUCT.md committed; DSD §0 updated; BRAND.md / DESIGN.md materialized. **Status: pending** (DSD §0 authored here is the input to it).

### 8.2 Phase: Polish; Audit Score

Run before handoff/launch:
```
/impeccable audit src/
```

| Dimension | Target (0-4) | Gate |
|---|---|---|
| Accessibility | >= 3 | AA verified pairings (§6); 44/48px targets; not color-only; keyboard + SR. |
| Performance | >= 3 | Font budget <= 90KB; no blur/shimmer; compressed uploads; works at 3 to 5 Mbps. |
| Theming | >= 3 | Three-tier tokens (§2.0); light + night-yard dark; no hard-coded hex in components. |
| Responsive | >= 3 | 360px baseline; wide tables scroll in-container; no page-level horizontal scroll. |
| Anti-patterns | >= 3 | No purple gradient, no Inter-only, no glassmorphism, no hover-only actions. |

**FMD launch gate:** no open P0 or P1, every dimension >= 3. **Status: not yet run** (no build). Blockers, if any, are recorded here at M4.

### 8.3 Phase: Polish; Detected Anti-Patterns

`npx impeccable detect src/` (runs at M3/M4). Anticipated category-slop watch-list, pre-empted by design:

| Pattern | Status | Location | Fix Applied |
|---|---|---|---|
| Purple-to-indigo gradient / gradient text | Prevented by design | palette §2.1 | Amber + steel + PAGASA scale; no purple primitive exists. Applies to both tiers. |
| Inter as the only font | Prevented by design | typography §2.3 | IBM Plex Sans/Condensed/Mono with rationale; Instrument Serif is a marketing-only italic accent, not a body/UI face. Applies to both tiers. |
| Glassmorphism / heavy blur | Prevented by design in Console; scoped-permitted in Marketing (CR: dsd-marketing-tier) | elevation §2.5 | Console: border-first depth, flat scrim, no `backdrop-filter`. Marketing: one glass nav only, behind the §6 progressive-enhancement gate; no other surface uses blur. |
| Skeleton shimmer loops | Prevented by design | motion §5 | Layout-preserving placeholders, single pulse. Applies to both tiers; marketing's rise-in/drift is state-driven, not a shimmer loop. |
| Generic gray empty-state blob | Prevented by design | §4.1 Empty state | Named empty copy + two-color diagram + primary action. |
| Color-only status | Prevented by design | §6 | Every status = color + label + icon. |
| Marketing motion/asset budget exceeding the 3-5 Mbps floor (new risk, CR: dsd-marketing-tier) | Mitigated by design | §6 progressive-enhancement gate | WebGL mesh gated by breakpoint + reduced-motion + connection check with a static fallback; font budget capped at <= 110KB; no `three` dependency shipped until the landing page that consumes it is actually built. |

### 8.4 Application Examples

*Source for BRAND.md §4.*

| Surface | Do | Don't |
|---------|----|-------|
| Admin dashboard (S4) | Lead with the work queue and a weather strip; Gauge Readouts for utilization and recovered hours; tenant mark in the app bar. | Float a glassy KPI card over a hero gradient; bury the review-queue count. |
| EDTR reconciliation review (S8) | Handwritten image beside extracted fields; loud below-gate Confidence Chips; Hazard Divider on discrepancy; Approve disabled until resolved. | Hide the source image; auto-accept a low-confidence field; let a discrepancy deduct. |
| Weather advisory (S13) | PAGASA-scale banner with label + icon + timestamp; stale marker when cached; link red to its auto-logged incident. | Red for an unknown/stale reading; color-only banner. |
| Printable quote (S6) | Clean print stylesheet, diesel price + date on the document, tenant lockup at the header. | Screen-only chrome bleeding into print; undated price. |
| Customer portal / catalog (S22) | Tenant's brand leads; compressed responsive images; honest availability; light Brand-Mode hero only here. | ArkiLaunch overriding the tenant identity; heavy hero that stalls at 3 to 5 Mbps. |
| Public landing (S1, CR: dsd-marketing-tier) | Marketing-tier shell (§0, §2 to §5); amber/steel/IBM Plex identity carried through with an Instrument Serif accent and SprintForge-derived depth, gated by §6 progressive enhancement; hero message per GTM §66. | Inter, SprintForge's `#E34A32` orange, ungated WebGL/parallax that ignores `prefers-reduced-motion` or the connection check, any surface that reads as a different brand than the app the visitor logs into next. |

**Mockup paths:** `docs/assets/concept/` (to be generated; §0.5).

### 8.5 Phase: Maintain; Document

```
/impeccable document
```
Regenerates DESIGN.md from shipped tokens/components after each significant ship.

**Last documented:** N/A until first run.

### 8.6 Section 0 Compliance Check

*Source for BRAND.md §5.*

- [x] **Relatable**; every color, typeface, and layout choice traces to the gauge-cluster + dispatch-board + PAGASA + Filipino-MSME provenance (§0 Aesthetic Provenance), not to a generic default. Amber/steel signal, PAGASA weather scale, mono gauge readouts, 360px cheap-Android baseline.
- [x] **Human**; deliberate idiosyncrasy documented: **the gauge rule** (every operational number in tabular mono, aligned like an instrument face) plus the **Hazard Divider** used only where money or safety is at stake. An AI default would have reached for one uniform sans and decorative dividers.
- [x] **Part of the branding**; the humanization from §0 (the field worker's own handwritten EDTR shown as a first-class artifact and cited on the invoice, plus tenant identity leading the app bar and catalog) is specified into real components (Evidence Split View §4.1, Nav shell §4.1, KYC panel §4.1), not deferred.

---

## 9. Materialization

| Target | File | Template | Contents (from DSD) |
|--------|------|----------|---------------------|
| Canonical | `docs/dsd-arkilaunch.md` | DSD_Template.md (external FMD engine template; not vendored in this repo) | Edit here (this document). |
| Brand (verbal) | `BRAND.md` (project root) | BRAND_Template.md (external FMD engine template) | §0 to §1, §2.2 logo, §2.4 imagery, §8.4 examples, §8.6 Section 0 Compliance Check, voice link, §9 governance. |
| Design (visual) | `DESIGN.md` (project root) | DESIGN_Template.md (external FMD engine template) | §2 to §5 tokens/components/motion (excludes §2.2 logo, §2.4 imagery, which are BRAND's), §4.1 patterns, §6 to §7, §8.1 to §8.3 and §8.5 audit summary (excludes §8.4 and §8.6, which are BRAND's; renumbered contiguously in DESIGN as its own §8.1 to §8.4), Asset Governance as DESIGN's own final §9. |
| Impeccable context | `PRODUCT.md` (project root) | (optional) | Audience + anti-references from `/impeccable init`; merge into §0. |

`BRAND.md` and `DESIGN.md` are **materialized from this DSD**, never hand-edited as source of truth (same pattern as BUILD -> `AGENTS.md`, SAD -> `.claude/agents/*`). Edit the DSD, then re-materialize both. This document does **not** touch `docs/index.md` (the orchestrator owns the manifest).

### Asset Governance

*Source for BRAND.md §7 and DESIGN.md §9 (each materializes its own copy; DESIGN's own §7 is Taste-Skill Settings, unrelated).*

**Brand asset version:** `1.0.0` (major = rebrand, minor = new variant, patch = file fix). This is version `0.1` of the DSD; asset production begins at DSD lock.
**Naming:** kebab-case; `logo-primary.svg`, `logo-mark.svg`, `logo-stacked.svg`, `concept-s4-dashboard.png`.
**Location:** brand assets in `docs/assets/brand/`; concept frames in `docs/assets/concept/`; deploy copies in `public/brand/`. Fonts self-hosted under `public/fonts/` (Latin-subset WOFF2).
**Approval / retirement:** the DSD DRI (ArkiLaunch design owner) approves asset changes; superseded files retire on a version bump and are removed from `public/` once no build references them.

---

## Self-Check

- [x] §0 is fully filled; no `{{PLACEHOLDER}}` values remain in Brand Stance
- [x] §0 Mode is selected (Product Mode, with the S1/S22 Brand-Mode exception documented)
- [x] Section 2 has exact HEX values (not "a muted blue"); weather-risk and reconciliation semantic scales defined
- [x] Section 3 spacing scale is consistent (all multiples of the 4px base unit)
- [x] Section 4 defines component states including Disabled and Focus (Buttons table has an explicit Focus column); domain components and §4.1 patterns tie to PRD S1 to S25, including S12 (Project sites & deployment pattern)
- [x] Section 7 taste-skill dials set (4 / 2 / 8) and variant chosen (output-skill)
- [x] WCAG 2.2 AA contrast verified for primary text/background and every signal pairing (§2.1, §6)
- [ ] Impeccable audit run; set as launch gate/target because no `src/` exists yet (design precedes build; executed at M3/M4)
- [x] §0 Compliance Check (in §8) completed; all three rules verified against the final design
- [ ] This document exists in code as CSS variables / Tailwind config; pending build (M2 to M3 deliverable)
- [x] BRAND.md and DESIGN.md materialized at project root per the §9 contract (contiguous own-numbering, no duplicated §2 token blocks, BRAND carries the voice link); not hand-edited as source
- [x] §2.2 logo system and §2.4 imagery filled (direction/brief; assets to produce at lock)
- [x] §4.1 includes composition patterns for every real surface (fleet table, project sites/S12, EDTR reconciliation, quotation, weather banner, booking, KYC, nav shell, form, empty/loading templates)
- [x] §8.4 application examples filled for primary surfaces
- [x] §0.5 concept visuals linked from IDEA §5; lo-fi frames recorded as not-yet-generated (no images claimed to exist)
- [x] AGENTS hard bans applied (no em-dashes; no "modern/clean/seamless/elevate" filler); VOICE polish before lock

**Marketing-tier amendment (CR: dsd-marketing-tier, 2026-08-02):**
- [x] Marketing tier named and scoped in §0 (Named tiers); every addition below is tagged `CR: dsd-marketing-tier` and gated by `[data-tier="marketing"]`, never silently overwriting a Console token
- [x] New primitive `--color-primary-ink` (`#7A5200`) contrast-verified: 6.9:1 on `#FFFFFF`, 6.2:1 on `#F5F2EB`, both >= 4.5:1 AA (§2.1)
- [x] SprintForge's `#E34A32` accent dropped entirely; amber `#F2A100` remains the single brand accent in both tiers (§2.1)
- [x] Console radius (4/6/8px), elevation (no `backdrop-filter`), and motion (<=250ms, no parallax) rules are unchanged and still apply to every authed screen (§2.5, §3, §5)
- [x] Marketing depth/motion additions carry an explicit progressive-enhancement gate (§6): breakpoint + reduced-motion + connection check before any WebGL, pointer-only for parallax/variable-weight type, no dependency (`three`) added until a consumer exists
- [ ] Marketing components (§4: FloatingNav, FeatureTile, ProofPill, PackageCard, RiseIn) are specified but **not built**; S1 Public Landing itself remains unbuilt. Deferred per the accompanying Change Record's scope note, not a silent gap.
