> Materialized from docs/dsd-arkilaunch.md by scripts/materialize.py on 2026-07-25 (marketing-tier amendment hand-materialized 2026-08-02, CR: dsd-marketing-tier; see docs/cr-arkilaunch-dsd-marketing-tier.md). Do not hand-edit; edit the canonical doc and re-run.

# Design: ArkiLaunch

> Visual language, materialized from DSD §2 to §8 (excludes §2.2 logo and §2.4 imagery, which are [BRAND.md](BRAND.md)'s; §8.4 Application Examples and §8.6 Section 0 Compliance Check are also BRAND's). Own Asset Governance carried as this document's final §9. See [docs/dsd-arkilaunch.md](docs/dsd-arkilaunch.md) §9 for the full materialization contract.

---

## 2. Brand Primitives

### 2.0 Token Architecture

Three tiers, enforced in the Tailwind config and documented below:

- **Primitive**; raw values, no meaning. e.g. `--steel-900: #10151B`, `--amber-500: #F2A100`, `--pagasa-red: #C42B1C`.
- **Semantic**; meaning, mapped from primitives. e.g. `--color-primary: var(--amber-500)`, `--weather-red: var(--pagasa-red)`, `--recon-discrepancy: var(--pagasa-red)`.
- **Component**; scoped, mapped from semantic. e.g. `--button-primary-bg: var(--color-primary)`, `--pill-danger-bg: var(--recon-discrepancy)`.

Tables below name **semantic** tokens. Light theme is default (built for outdoor daytime); a "night yard" dark override is in §2.1.

**Tier axis (CR: dsd-marketing-tier):** the semantic layer also carries a **tier**, orthogonal to light/dark theme. Console semantic tokens (as specified throughout this document) apply by default. Marketing-tier tokens are named with an `-mk` suffix (e.g. `--radius-mk-lg`, `--color-bg-mk`) and only resolve inside `[data-tier="marketing"]`. Both tiers draw from the same primitive layer; no new primitive family is introduced except where §2.1 notes one explicitly. Component tokens are unchanged by this axis: a component is built for one tier and does not need tier-aware component tokens.

**Named tiers:** every screen belongs to exactly one tier. **Console** (default) covers S2 to S21, S25 -- all authed, task-first surfaces -- and is the instrument-panel system specified throughout this document: tight radii, border-first depth, <=250ms motion, IBM Plex only. **Marketing** covers S1 Public Landing and S22 Catalog Browse -- the SprintForge-derived surface merged in by this amendment: large radii, layered/glass depth, Instrument Serif accent, rise-in/drift motion, all behind the §6 progressive-enhancement gate. A component never silently crosses tiers; the tier is set once, on a route wrapper (`data-tier="marketing"` on the root of S1/S22, unset elsewhere).

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

**Marketing surface tokens (CR: dsd-marketing-tier)**; scoped to `[data-tier="marketing"]`. This is the merged SprintForge shell, re-tinted warm so it reads as one brand with the console rather than a cool, separate skin. `--color-primary` (amber `#F2A100`) stays the single brand accent in this tier too; SprintForge's signature orange `#E34A32` is dropped entirely; it sat between `--weather-orange` (`#D9600A`) and `--color-error` (`#C42B1C`) and would have diluted both semantic scales.

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg-mk-frame` | `#ECE7DB` | Outer page frame ("shell in shell" outer layer). Reuses the existing `--color-surface-sunk` primitive; no new hue introduced. |
| `--color-bg-mk` | `#F5F2EB` | Inner rounded container. Same value as console `--color-bg`, so the temperature does not jump when a visitor moves from marketing into the app. |
| `--color-surface-mk` | `#FFFFFF` | Floating cards on marketing surfaces. Same value as console `--color-surface`. |
| `--color-ink-mk` | `#171719` | Near-black display headline color; darker than steel `#10151B`, used only for large marketing display type, never for body text or console surfaces. |
| `--color-primary-ink` | `#7A5200` | **New primitive.** Amber-family text color for small amber text on a light surface (e.g. a status-chip label), where amber `#F2A100` itself would fail AA on white. Verified 6.9:1 on `#FFFFFF`, 6.2:1 on `#F5F2EB` (both >= 4.5:1). Marketing tier only; console never sets amber text on light, it always pairs amber fills with dark text per the core table above. |
| `--border-glass` | `rgba(255,255,255,0.7)` | Floating nav edge, marketing tier only. Decorative border, not a text/UI contrast pairing. |

Marketing muted body text reuses the existing verified `--color-text-muted` (`#45566A`, 6.7:1 on `#F5F2EB`) rather than importing a new gray; there is no marketing-specific muted token.

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
**Font loading:** self-hosted `/fonts/*.woff2`, Latin subset, `font-display: swap`, `<link rel="preload">` on the two most-used cuts (Plex Sans variable, Plex Mono 500). Total font payload budget: <= 90KB over the wire (Console tier; see marketing budget below).
**License / fallback:** IBM Plex is SIL Open Font License 1.1 (free to self-host and embed). Fallback stack: `"IBM Plex Sans", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif`; mono falls back to `"IBM Plex Mono", "Roboto Mono", ui-monospace, monospace`. Roboto is already resident on Android, so the fallback render is legible with zero download.

**Marketing typography (CR: dsd-marketing-tier)**; IBM Plex stays the type system on marketing surfaces too, not Inter; the single addition is an accent face for editorial emphasis.

| Role | Font | Weight | Size / Notes |
|---|---|---|---|
| `accent-serif` | Instrument Serif | 400, italic | `letter-spacing: -0.01em`. Used sparingly, for a headline's emotional accent word or phrase only, never for a full heading or for body copy. |
| Marketing display | IBM Plex Sans Condensed | 600 base | `text-5xl` mobile, `sm:text-7xl`, `lg:text-8xl`; `letter-spacing: -0.035em`. |

**Variable-weight interaction:** SprintForge's pointer-proximity weight effect is adopted on marketing display type, applied to **IBM Plex Sans, not Inter**. Verified against the actual self-hosted files: IBM Plex Sans ships a true variable font with a `wght` axis spanning **100 to 700**; IBM Plex Sans Condensed does not (static instances only, one file per weight). The effect therefore renders on Plex Sans Variable, and the ceiling is **700, not 900**; SprintForge's literal 600-to-900 range does not exist in this type family and is not faked with `font-synthesis`. Base weight 600, rising toward 700 within a 200px pointer radius, `font-variation-settings` transition `150ms linear`. Pointer-only; never bound to touch (§6).

**Marketing font budget:** <= 110KB over the wire (raises the console's 90KB ceiling by the Instrument Serif italic cut only; every other face is shared with console and already counted there). Instrument Serif is **not** preloaded, since nothing on a console route uses `.font-serif-accent`, so it is fetched only when a marketing route actually renders it.

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

**Status Pill**; compact state marker used across tables and queues. Filled chip, `--radius-sm`, icon + label, mono value where numeric. Draws its color from the weather or reconciliation scale (§2.1). Never color-only; the label carries the meaning. States: `match`, `review`, `discrepancy`, `failed`, `approved` (recon); `available`, `deployed`, `maintenance-due`, `retired` (fleet); weather `clear/yellow/orange/red/stale`. **Built:** `apps/web/src/components/status-pill.tsx`.

**Confidence Chip**; the OCR per-field marker at reconciliation and KYC. Shows the scale color (`match`/`review`/`failed`) plus the raw confidence in mono (`0.87`). Below-gate chips are visually louder (they demand a human), not quieter. **Built:** `apps/web/src/components/confidence-chip.tsx`.

**Gauge Readout**; the framed mono numeric tile for a single key figure (diesel price, deposit balance, utilization %, recovered billable hours). Bezelled with `--color-border-strong`, big tabular mono, a small overline label, an optional trend/stale marker. This is the interface's signature moment. **Built:** `apps/web/src/components/gauge-readout.tsx`.

**Weather Banner**; full-width strip (§4.1) driven by the weather scale; carries site name, condition, timestamp, and a stale marker when cached. A cached reading renders as the dedicated `weather-stale` tone rather than keeping its last-known severity color. **Built:** `apps/web/src/components/weather-banner.tsx`.

**Evidence Split View**; the reconciliation review surface (§4.1); the original handwritten image beside the extracted, editable fields. **Not yet built** (no consumer screen exists; S7/S8 unbuilt).

**Hazard Divider**; a diagonal amber/black stripe rule used only to fence a blocking/danger region (reconciliation discrepancy, stop-work weather, unverified KYC). Never decorative; its presence means "do not proceed until resolved". **Built:** `apps/web/src/components/hazard-divider.tsx`.

### Marketing components (CR: dsd-marketing-tier)

*Specified now; **not built this pass** (deferred, per the accompanying Change Record's scope note). These exist so the landing page (S1) has a documented component contract to build against when it is scheduled, rather than being designed ad hoc off the SprintForge reference at build time.*

**FloatingNav**; centered, sticky, translucent nav (`--blur-mk-nav`, `--border-glass`, `--shadow-mk-nav` only once `scrollY > 24`). Tenant/ArkiLaunch lockup rule (BRAND.md §2) still applies if a tenant surface ever reuses this component.

**FeatureTile**; white `--color-surface-mk` card, `--radius-mk-lg`, 48px square icon (Lucide, 1.5 stroke, matching Console's icon discipline), a short caption, and a status-style label. Hover: `-translate-y-1`, 300ms `cubic-bezier(0.34, 1.56, 0.64, 1)` (marketing hover-lift, §5).

**ProofPill**; oversized `--radius-pill` pill, numeral in `--color-ink-mk`, unit label in `--color-primary-ink` (never raw amber-on-white; §2.1). Three pills overlap with `-space-x-6` at desktop width, each at a distinct slight rotation (`-1deg` / `0` / `1deg`).

**PackageCard**; vertical pricing card. Featured variant scales `1.04`, sits `z-10`, uses `--color-ink-mk` background with inverse text and `--shadow-mk-card` at higher opacity; outer variants sit on `--color-surface-mk` with a `±1deg` rotation.

**RiseIn**; the reveal wrapper for `data-rise`/`data-reveal` elements: `opacity-0 translate-y-4` to `opacity-100 translate-y-0`, IntersectionObserver-driven, 700ms ease-out (§5). Collapses to instant under `prefers-reduced-motion` (§6), same as every other motion primitive in this document.

### 4.1 Composition Patterns

*Multi-component flows aligned to PRD §5.1/§5.2. Each names its screens and its four states (empty/loading/error/success); the Empty state and Loading state rows are the cross-cutting patterns those four-state columns reference, so they define the template rather than repeating it.*

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

*Design-time note: this precedes the build (PRD M2 Design precedes M3 Development). Console tokens now exist in code (`apps/web/src/index.css`, M2-to-M3 deliverable landed); the marketing tier is specified but unbuilt. The audit and detector below remain launch gates and targets, executed against `src/` at M3/M4 before anchor go-live.*

### 8.1 Phase: Start; Init

```bash
npx impeccable install
```
```
/impeccable init
```

- [ ] `/impeccable init` run; PRODUCT.md committed; DSD §0 updated; BRAND.md / DESIGN.md materialized. **Status: pending** (DSD §0 authored is the input to it).

### 8.2 Phase: Polish; Audit Score

Run before handoff/launch:
```
/impeccable audit src/
```

| Dimension | Target (0-4) | Gate |
|---|---|---|
| Accessibility | >= 3 | AA verified pairings (§6); 44/48px targets; not color-only; keyboard + SR. |
| Performance | >= 3 | Font budget <= 90KB (Console) / <= 110KB (Marketing); no blur/shimmer outside the one gated glass nav; compressed uploads; works at 3 to 5 Mbps. |
| Theming | >= 3 | Three-tier tokens (§2.0) plus the tier axis; light + night-yard dark; no hard-coded hex in components. |
| Responsive | >= 3 | 360px baseline; wide tables scroll in-container; no page-level horizontal scroll. |
| Anti-patterns | >= 3 | No purple gradient, no Inter-only, no unscoped glassmorphism, no hover-only actions. |

**FMD launch gate:** no open P0 or P1, every dimension >= 3. **Status: not yet run** (no full `src/` build; Console token layer + primitives landed, marketing tier and landing page pending). Blockers, if any, are recorded here at M4.

### 8.3 Phase: Polish; Detected Anti-Patterns

`npx impeccable detect src/` (runs at M3/M4). Category-slop watch-list, pre-empted by design:

| Pattern | Status | Location | Fix Applied |
|---|---|---|---|
| Purple-to-indigo gradient / gradient text | Prevented by design | palette §2.1 | Amber + steel + PAGASA scale; no purple primitive exists. Applies to both tiers. |
| Inter as the only font | Prevented by design | typography §2.3 | IBM Plex Sans/Condensed/Mono with rationale; Instrument Serif is a marketing-only italic accent, not a body/UI face. Applies to both tiers. |
| Glassmorphism / heavy blur | Prevented by design in Console; scoped-permitted in Marketing (CR: dsd-marketing-tier) | elevation §2.5 | Console: border-first depth, flat scrim, no `backdrop-filter`. Marketing: one glass nav only, behind the §6 progressive-enhancement gate; no other surface uses blur. |
| Skeleton shimmer loops | Prevented by design | motion §5 | Layout-preserving placeholders, single pulse. Applies to both tiers; marketing's rise-in/drift is state-driven, not a shimmer loop. |
| Generic gray empty-state blob | Prevented by design | §4.1 Empty state | Named empty copy + two-color diagram + primary action. |
| Color-only status | Prevented by design | §6 | Every status = color + label + icon. |
| Marketing motion/asset budget exceeding the 3-5 Mbps floor (new risk, CR: dsd-marketing-tier) | Mitigated by design | §6 progressive-enhancement gate | WebGL mesh gated by breakpoint + reduced-motion + connection check with a static fallback; font budget capped at <= 110KB; no `three` dependency shipped until the landing page that consumes it is actually built. |

### 8.5 Phase: Maintain; Document

```
/impeccable document
```
Regenerates this document from shipped tokens/components after each significant ship.

**Last documented:** N/A until first run. Token layer and console primitives shipped 2026-08-02 (CR: dsd-marketing-tier); this document was hand-updated in the same pass, not regenerated by tooling.

---

## 9. Asset Governance

**Brand asset version:** `1.0.0` (major = rebrand, minor = new variant, patch = file fix). This is version `0.1` of the DSD; asset production begins at DSD lock.
**Naming:** kebab-case; `logo-primary.svg`, `logo-mark.svg`, `logo-stacked.svg`, `concept-s4-dashboard.png`.
**Location:** brand assets in `docs/assets/brand/`; concept frames in `docs/assets/concept/`; deploy copies in `public/brand/`. Fonts self-hosted under `public/fonts/` (Latin-subset WOFF2); landed at `apps/web/public/fonts/` (IBM Plex Sans variable, Plex Sans Condensed 600, Plex Mono 500, Instrument Serif italic 400).
**Approval / retirement:** the DSD DRI (ArkiLaunch design owner) approves asset changes; superseded files retire on a version bump and are removed from `public/` once no build references them.

---

## Self-Check

- [x] §2 to §7 carried verbatim from the DSD (excludes §2.2 logo and §2.4 imagery, which are BRAND.md's); no duplicated content across the two files
- [x] §8 renumbered contiguously as this document's own 8.1 to 8.4 (Start/Init, Audit Score, Detected Anti-Patterns, Maintain/Document); excludes DSD's 8.4 Application Examples and 8.6 Section 0 Compliance Check, which are BRAND.md's
- [x] §9 Asset Governance is this document's own copy, distinct from §7 Taste-Skill Settings
- [x] No dangling references to §0/§0.5 (correctly omitted; those live in BRAND.md, not here)
- [x] Cross-references within this document (§2.1, §2.3, §2.5, §4.1, §6, §8) all resolve to real sections in this same file
- [x] AGENTS hard bans applied (no em-dashes)

**Marketing-tier amendment (CR: dsd-marketing-tier, 2026-08-02):**
- [x] Marketing tier tokens/components carried from DSD, each tagged `CR: dsd-marketing-tier` and scoped by `[data-tier="marketing"]`; no marketing token overwrites a Console token of the same name
- [x] Token layer implemented in code: `apps/web/src/index.css` (Tailwind v4 `@theme`, console + marketing + night-yard dark), fonts self-hosted under `apps/web/public/fonts/`
- [x] Console primitives implemented: Button, Input, Select, Surface (`apps/web/src/components/`); existing POC routes (index, login, quotes, edtr, kyc) restyled off these primitives, off stock `slate-*`/`blue-*`
- [x] Signature domain components implemented with colocated Vitest tests: GaugeReadout, ConfidenceChip, HazardDivider, WeatherBanner (13 tests passing); no consumer screen wires them in yet (S4/S8/S13 unbuilt)
- [ ] Marketing components (FloatingNav, FeatureTile, ProofPill, PackageCard, RiseIn) and S1 Public Landing itself remain unbuilt; deferred per the Change Record's scope note
