> Materialized from docs/dsd-arkilaunch.md by scripts/materialize.py on 2026-07-25. Do not hand-edit; edit the canonical doc and re-run.

# Brand:

> Verbal identity, materialized from the DSD (sections 0, 0.5, 1, 2, 8, 9). Subsections 2.2-2.4 and 8.4 ride along when present in those sections.

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

---
## 0.5 Concept Visuals (from IDEA)

*Carried forward from [idea-arkilaunch.md](idea-arkilaunch.md) §5. Lo-fi frames are **not yet generated**: image-generation tooling is unavailable this session. The visual direction below is the approved brief for those frames when tooling lands. No image asset is claimed to exist.*

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
- Purple/indigo gradients and gradient text (the category slop default; carries no yard meaning).
- Glassmorphism, heavy blur, and floating-card depth theater (fails on cheap Android GPUs and reads as decoration, not signal).
- Hover-only affordances, hairline dividers, and sub-12px data rows (die on touch and in the sun).
- Auto-playing or looping animation, and skeleton shimmer as the default loading gesture (burns battery and bandwidth for no information).

---
## 2. Brand Primitives

### 2.0 Token Architecture

Three tiers, enforced in the Tailwind config and in materialized `DESIGN.md`:

- **Primitive**; raw values, no meaning. e.g. `--steel-900: #10151B`, `--amber-500: #F2A100`, `--pagasa-red: #C42B1C`.
- **Semantic**; meaning, mapped from primitives. e.g. `--color-primary: var(--amber-500)`, `--weather-red: var(--pagasa-red)`, `--recon-discrepancy: var(--pagasa-red)`.
- **Component**; scoped, mapped from semantic. e.g. `--button-primary-bg: var(--color-primary)`, `--pill-danger-bg: var(--recon-discrepancy)`.

Tables below name **semantic** tokens; primitive refs are documented in the DESIGN.md materialization. Light theme is default (built for outdoor daytime); a "night yard" dark override is in §2.1.

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

### 2.2 Logo System

*Source for BRAND.md §3. Rules, not just files. Assets are not yet produced this session; the direction below is the brief.*

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
**Font loading:** self-hosted `/fonts/*.woff2`, Latin subset, `font-display: swap`, `<link rel="preload">` on the two most-used cuts (Plex Sans 400, Plex Mono 500). Total font payload budget: <= 90KB over the wire.
**License / fallback:** IBM Plex is SIL Open Font License 1.1 (free to self-host and embed). Fallback stack: `"IBM Plex Sans", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif`; mono falls back to `"IBM Plex Mono", "Roboto Mono", ui-monospace, monospace`. Roboto is already resident on Android, so the fallback render is legible with zero download.

### 2.4 Imagery & Illustration

*Source for BRAND.md §6.*

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

---
## 8. Impeccable Quality Gate

*Design-time note: this DSD precedes the build (PRD M2 Design precedes M3 Development). No `src/` exists yet, so the audit and detector below are set as **launch gates and targets**, not as results claimed to have run. They are executed against `src/` in M3/M4 before anchor go-live.*

### Phase: Start; Init

```bash
npx impeccable install
```
```
/impeccable init
```

- [ ] `/impeccable init` run; PRODUCT.md committed; DSD §0 updated; BRAND.md / DESIGN.md materialized. **Status: pending** (DSD §0 authored here is the input to it).

### Phase: Polish; Audit Score

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

### Phase: Polish; Detected Anti-Patterns

`npx impeccable detect src/` (runs at M3/M4). Anticipated category-slop watch-list, pre-empted by design:

| Pattern | Status | Location | Fix Applied |
|---|---|---|---|
| Purple-to-indigo gradient / gradient text | Prevented by design | palette §2.1 | Amber + steel + PAGASA scale; no purple primitive exists. |
| Inter as the only font | Prevented by design | typography §2.3 | IBM Plex Sans/Condensed/Mono with rationale. |
| Glassmorphism / heavy blur | Prevented by design | elevation §2.5 | Border-first depth; flat scrim, no `backdrop-filter`. |
| Skeleton shimmer loops | Prevented by design | motion §5 | Layout-preserving placeholders, single pulse. |
| Generic gray empty-state blob | Prevented by design | §4.1 Empty state | Named empty copy + two-color diagram + primary action. |
| Color-only status | Prevented by design | §6 | Every status = color + label + icon. |

### 8.4 Application Examples

*Source for BRAND.md §8.*

| Surface | Do | Don't |
|---------|----|-------|
| Admin dashboard (S4) | Lead with the work queue and a weather strip; Gauge Readouts for utilization and recovered hours; tenant mark in the app bar. | Float a glassy KPI card over a hero gradient; bury the review-queue count. |
| EDTR reconciliation review (S8) | Handwritten image beside extracted fields; loud below-gate Confidence Chips; Hazard Divider on discrepancy; Approve disabled until resolved. | Hide the source image; auto-accept a low-confidence field; let a discrepancy deduct. |
| Weather advisory (S13) | PAGASA-scale banner with label + icon + timestamp; stale marker when cached; link red to its auto-logged incident. | Red for an unknown/stale reading; color-only banner. |
| Printable quote (S6) | Clean print stylesheet, diesel price + date on the document, tenant lockup at the header. | Screen-only chrome bleeding into print; undated price. |
| Customer portal / catalog (S22) | Tenant's brand leads; compressed responsive images; honest availability; light Brand-Mode hero only here. | ArkiLaunch overriding the tenant identity; heavy hero that stalls at 3 to 5 Mbps. |

**Mockup paths:** `docs/assets/concept/` (to be generated; §0.5).

### Phase: Maintain; Document

```
/impeccable document
```
Regenerates DESIGN.md from shipped tokens/components after each significant ship.

**Last documented:** N/A until first run.

### Section 0 Compliance Check

- [x] **Relatable**; every color, typeface, and layout choice traces to the gauge-cluster + dispatch-board + PAGASA + Filipino-MSME provenance (§0 Aesthetic Provenance), not to a generic default. Amber/steel signal, PAGASA weather scale, mono gauge readouts, 360px cheap-Android baseline.
- [x] **Human**; deliberate idiosyncrasy documented: **the gauge rule** (every operational number in tabular mono, aligned like an instrument face) plus the **Hazard Divider** used only where money or safety is at stake. An AI default would have reached for one uniform sans and decorative dividers.
- [x] **Part of the branding**; the humanization from §0 (the field worker's own handwritten EDTR shown as a first-class artifact and cited on the invoice, plus tenant identity leading the app bar and catalog) is specified into real components (Evidence Split View §4.1, Nav shell §4.1, KYC panel §4.1), not deferred.

---
## 9. Materialization

| Target | File | Template | Contents (from DSD) |
|--------|------|----------|---------------------|
| Canonical | `docs/dsd-arkilaunch.md` | [DSD_Template.md](../fmd/templates/DSD_Template.md) | Edit here (this document). |
| Brand (verbal) | `BRAND.md` (project root) | [BRAND_Template.md](../fmd/templates/BRAND_Template.md) | §0 to §1, §2.2 logo, §2.4 imagery, §8.4 examples, voice link, §9 governance. |
| Design (visual) | `DESIGN.md` (project root) | [DESIGN_Template.md](../fmd/templates/DESIGN_Template.md) | §2 to §5 tokens/components/motion, §4.1 patterns, §6 to §7, §8 audit summary. |
| Impeccable context | `PRODUCT.md` (project root) | (optional) | Audience + anti-references from `/impeccable init`; merge into §0. |

`BRAND.md` and `DESIGN.md` are **materialized from this DSD**, never hand-edited as source of truth (same pattern as BUILD -> `AGENTS.md`, SAD -> `.claude/agents/*`). Edit the DSD, then re-materialize both. This document does **not** touch `docs/index.md` (the orchestrator owns the manifest).

### Asset Governance

*Source for BRAND.md §9 and DESIGN.md §7.*

**Brand asset version:** `1.0.0` (major = rebrand, minor = new variant, patch = file fix). This is version `0.1` of the DSD; asset production begins at DSD lock.
**Naming:** kebab-case; `logo-primary.svg`, `logo-mark.svg`, `logo-stacked.svg`, `concept-s4-dashboard.png`.
**Location:** brand assets in `docs/assets/brand/`; concept frames in `docs/assets/concept/`; deploy copies in `public/brand/`. Fonts self-hosted under `public/fonts/` (Latin-subset WOFF2).
**Approval / retirement:** the DSD DRI (ArkiLaunch design owner) approves asset changes; superseded files retire on a version bump and are removed from `public/` once no build references them.

---
