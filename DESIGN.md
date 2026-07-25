> Materialized from docs/dsd-arkilaunch.md by scripts/materialize.py on 2026-07-25. Do not hand-edit; edit the canonical doc and re-run.

# Design:

> Visual language, materialized from DSD §2-§8.

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

**Corner radius scale:** `--radius-sm: 4px` (chips, inputs, buttons), `--radius-md: 6px` (cards, panels), `--radius-lg: 8px` (modals). Deliberately tight; this is an instrument panel, not a pill-shaped consumer app. No fully-rounded ("rounded-everything") surfaces.

**Breakpoints** (tuned to the real fleet of devices, cheap Android first):
- Mobile: `360px` (common budget-Android width; the design baseline, not an afterthought)
- Tablet: `768px`
- Desktop: `1024px`
- Wide: `1440px` (control-room dashboards, wide fleet tables)

---
## 4. Core Component Specs

*Behavior and every visual state. Engineering builds from this. States tie to the PRD §5.1 screen inventory.*

### Buttons

| Variant | Background | Text | Border | Hover | Disabled |
|---------|-----------|------|--------|-------|----------|
| Primary | `--color-primary` (amber) | `#10151B` (dark, required) | none | `--color-primary-hover` | 40% opacity, `not-allowed` |
| Secondary | transparent | `--color-accent` | 1px `--color-accent` | `--color-surface-sunk` bg | 40% opacity |
| Ghost | transparent | `--color-text` | none | `--color-surface-sunk` bg | 40% opacity |
| Destructive | `--color-error` | white | none | darkened error `#A3241A` | 40% opacity |
| Approve (recon) | `--color-success` | white | none | darkened `#186031` | 40% opacity; disabled until logs match + fields resolved (S8) |

**Border radius:** `--radius-sm` (4px).
**Padding:** `12px 20px` desktop; `14px 20px` on the timekeeper console (larger for gloved/field taps).
**Font:** IBM Plex Sans 600, 15px.
**Min size:** 44x44px everywhere; 48x48px on the timekeeper console (S21) and any outdoor/field action (§6).
**Focus:** `--input-focus-ring` (see below); never removed.
**Loading:** label swaps to a static "Working..." with a small non-looping spinner; the button stays its own size (no layout shift). Amber primary must never go white-on-amber even while loading.

### Inputs & Forms

- Border: `1px solid --color-border`; `--color-border-strong` on hover.
- Border radius: `--radius-sm` (4px).
- Focus ring: `2px solid --color-accent`, `2px` offset. Always visible, keyboard and pointer alike.
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

### 4.1 Composition Patterns

*Source for DESIGN.md §3. Multi-component flows aligned to PRD §5.1/§5.2. Each names its screens and its four states (empty/loading/error/success).*

| Pattern | Components | When to use (screens) | Do / Don't |
|---------|------------|-----------------------|------------|
| **Data-dense fleet table** | Sticky header + Status Pill + Gauge Readout cells + row actions + `overflow-x` scroll container + density toggle | S10 Fleet Inventory, S11 Equipment Detail, S15/S20 Reports, S16 Bookings | **Do:** freeze the header on scroll; right-align mono numerics with tabular figures; keep row height >= 44px; put actions as visible buttons, not hover-reveal; scroll wide tables inside their own container. Empty: "No equipment yet" + primary "Add equipment". Loading: static row placeholders (no shimmer). Error: inline banner + retry, keep last-good rows if cached. Success: rows with Status Pills. **Don't:** hairline dividers, hover-only actions, sub-13px text, horizontal page scroll. |
| **EDTR scan + reconciliation review (Evidence Split View)** | Original image panel (zoom/pan **with button controls**, not drag-only) + extracted-fields form + Confidence Chips + two-log delta bar (Log A vs Log B vs tolerance) + Hazard Divider on discrepancy + Approve/Reject | S7 EDTR Capture, S8 Reconciliation Review Queue | **Do:** show the handwritten image at full fidelity beside the fields, always; highlight below-gate fields loudly; show `delta_hours` vs tolerance in mono; disable Approve until all fields resolved and logs match; on hard-fail route to manual entry with the image still shown. Empty: "Queue clear". Loading (OCR async): "Queued / Processing" state, UI never blocks. Error: unreadable -> manual entry, never a fabricated value. Success: `--recon-approved` teal + evidence citation. **Don't:** hide the source image, auto-accept a below-gate field, let a discrepancy deduct. |
| **Quotation builder** | Rate-card selector + km input + live diesel Gauge Readout (with date + staleness label) + computed line items + sub-60s target + printable preview | S5 Quotation Builder, S6 Quote Preview & Print | **Do:** compute live as inputs change; label the diesel price with its date; on stale price show an amber staleness warning and still price (never silently against unknown); produce a clean print stylesheet for S6. Empty: prefilled defaults + "Pick equipment". Loading: price fetch skeleton on the diesel tile only. Error (stale): warning banner, last-known price used. Success: printable quote, `quote_generated` fired with latency. **Don't:** block the whole form on the price fetch; hide the price date. |
| **Weather advisory banner** | Weather Banner (PAGASA scale) + site name + condition + timestamp + stale marker + link to incident log | S4 Dashboard strip, S13 Weather Advisories, S14 Liability Incident Log | **Do:** color from the weather scale with a label and icon (never color-only); mark cached readings `--weather-stale`; link a red advisory to its auto-logged incident. Empty: "All sites clear". Loading: skeleton strip. Error (API down): serve cached, mark stale, do not drop the row. Success: live advisory. **Don't:** use red for a stale/unknown state; imply a live reading when it is cached. |
| **Booking flow** | Catalog card grid + cart + availability guard + PayMongo redirect + Transaction Tracker | S22 Catalog Browse, S23 Cart & Checkout, S24 Transaction Tracker | **Do:** compress catalog images for 3 to 5 Mbps; re-check availability at checkout; redirect to PayMongo hosted checkout (store only the returned reference/status); reconcile status via webhook, not the browser redirect alone. Empty: "This yard has no listed equipment yet". Loading: card placeholders. Error: unavailable -> offer alternatives, never overbook; payment fail -> booking stays pending with retry. Success: tracker shows order/payment/rental status. **Don't:** collect card data in-app, trust the redirect for final status. |
| **KYC review panel** | Original doc image + extracted SEC/TIN fields + Confidence Chips + portal-confirmation checklist (SEC + BIR) + Hazard Divider until verified + activate/reject | S3 Tenant Registration & OCR KYC, S17 KYC Verification Queue | **Do:** show extracted SEC/TIN beside the source doc; require the admin to confirm against SEC and BIR portals; keep tenant unverified until human confirmation; make plain the CAPTCHA-blocked step is manual by design. Empty: "No pending tenants". Loading: extraction queued. Error (low confidence / no portal match): stay unverified, no production access. Success: tenant activated, `tenant_onboarded` fired. **Don't:** auto-verify, grant access on extraction alone, show raw SEC/TIN in logs/analytics. |
| **Nav shell (role-aware)** | Top app bar (tenant mark + active-tenant badge + notifications + account) + left sidebar (admin/owner) / bottom nav (timekeeper) / top nav (customer) | All authed screens per PRD §5.2 | **Do:** lead with the tenant's mark; badge the active tenant; surface review-queue count, PM alerts, and weather advisories in notifications; strip the sidebar on the timekeeper console and during onboarding. **Don't:** show cross-tenant data, put ArkiLaunch's mark above the tenant's inside their workspace. |
| **Form + validation** | Labeled inputs + inline errors + specific messages + submit with loading | S2 Login, S18 Rate Cards, S19 Users & Roles | **Do:** label above field, specific error text with icon, preserve entered data on failure. **Don't:** placeholder-as-label, color-only errors, generic "Invalid input". |
| **Empty state** | Icon (two-color diagram) + one plain sentence + one primary action | Every list/queue screen | **Do:** name the real thing ("No EDTRs in the queue"), offer the next action. **Don't:** generic gray blob illustration, cute copy that wastes the moment. |
| **Loading state** | Layout-preserving placeholders + static "Loading..." | All async screens | **Do:** reserve layout to avoid shift; static or single opacity-pulse. **Don't:** looping shimmer (battery/bandwidth); never block the UI while OCR runs (async). |

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

**Avoid:** animations over 250ms in-app; any infinite loop without user intent; parallax; motion that decorates rather than reports a state change; skeleton shimmer as the default. All non-essential motion is wrapped in `@media (prefers-reduced-motion: reduce)` and reduced to an instant state swap.

---
## 6. Accessibility (a11y)

Target: **WCAG 2.2 Level AA**, built for gloved hands, outdoor light, low-end Android, and 3 to 5 Mbps.

- **Contrast:** AA minimum, 4.5:1 text / 3:1 UI. Verified pairings: body `#10151B` on `#F5F2EB` = 16.8:1; muted `#45566A` on bg = 6.7:1; amber primary uses dark text (8.8:1), never white; error/red and accent/blue use white text (5.6:1 / 6.8:1); every weather and reconciliation chip meets AA at the text pairing noted in §2.1.
- **Never color-only:** every status (weather scale, reconciliation scale, fleet status) carries a text label and an icon or shape. A red/orange PAGASA banner is still legible to a color-blind user and in harsh sun.
- **Touch targets (WCAG 2.2 SC 2.5.8):** 44x44px minimum app-wide; **48x48px** on the timekeeper console (S21) and any field/outdoor action, for gloved and one-handed use.
- **Dragging alternatives (SC 2.5.7):** the Evidence Split View image zoom/pan offers button controls (zoom +/-, fit, reset), not drag-only.
- **Focus visible + not obscured (SC 2.4.7, 2.4.11):** 2px accent focus ring, always present; sticky headers and the floating action bar must not cover the focused element.
- **Keyboard:** every interactive element reachable and operable; reconciliation Approve/Reject, table row actions, and modal controls fully keyboard-driven; logical tab order.
- **Screen reader:** semantic HTML first; ARIA only to fill gaps. Confidence and delta values are announced ("active hours 8.0, confidence 0.87, below threshold, needs review"). The handwritten image has a meaningful alt ("original EDTR, site Bagumbayan, 2026-07-20").
- **Offline-tolerant states:** queued uploads, cached weather (stale-marked), draft quotes, and in-progress EDTR entry survive a dropped connection and resume; a failed upload never loses entered data (PRD US-02).
- **Bandwidth:** works over 3 to 5 Mbps. Client-side image compression before EDTR/KYC upload, chunked/resumable transfer with a visible progress + retry, font payload budget <= 90KB, catalog images responsive and compressed, no autoplay media.
- **Reduced motion:** all non-essential animation collapses to an instant state change under `prefers-reduced-motion: reduce`.
- **Consistent help (SC 3.2.6):** the account menu and support/contact affordance sit in the same app-bar position on every authed screen.

---
## 7. Taste-Skill Settings

```
DESIGN_VARIANCE:    4   (restrained and coherent, but with a committed industrial identity; not neutral)
MOTION_INTENSITY:   2   (subtle only; low-power field devices)
VISUAL_DENSITY:     8   (control-room, data-dense; density earned by legibility and target size)
```

**Dial guide:** `DESIGN_VARIANCE` 1 = Swiss grid austerity, 10 = maximalist. `MOTION_INTENSITY` 1 = static, 10 = everything moves. `VISUAL_DENSITY` 1 = whitespace, 10 = dashboard-dense.

**Chosen variant:** `output-skill`
**Reason:** ArkiLaunch is information-first and utilitarian: dispatch boards, fleet tables, reconciliation queues, printable quotes. `output-skill` matches the data-output character better than `soft-skill` (too gentle for a control room) or `minimalist-skill` (would strip the amber/PAGASA signal color that carries meaning). It is not `brutalist-skill`: the Filipino-MSME warmth and the honesty of the user's own handwriting keep it from going raw or cold. Density stays high (8) but every dense surface is disciplined by AA contrast and 44/48px targets (§6).

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
