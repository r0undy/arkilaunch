# Change Record

**Title:** Platform landing motion: feature reveal and a step carousel
**Project:** ArkiLaunch
**Date:** 2026-09-28
**Version:** 0.1
**Status:** `Applied` (branch `feat/platform-landing-motion`)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (owner request: make "What you get" and "Open in three steps" on the platform landing more engaging and interactive, and end the page with a CTA and contact)
**Docs touched by this record:** [dsd-arkilaunch.md](dsd-arkilaunch.md) §5 (materialized into `DESIGN.md`), [index.md](index.md) §2

---

## 1. Summary

The platform landing (`routes/platform.index.tsx`, platform host only) gets the following:
- **"What you get":** feature cards with icons that rise in on scroll.
- **"Open in three steps":** a horizontal scroll-snap carousel with arrows and dots.
- **Closing band:** a steel CTA and contact band. It shows `mailto:`/`tel:` links from `VITE_PLATFORM_CONTACT_EMAIL`/`_PHONE`, and the email falls back to `hello@<platform domain>`.

The AWS design-language CR retired the Marketing tier's motion rows. This record adds back two rows, scoped to the public landing only.

## 2. Motion added (public landing only)

| Interaction | Duration | Easing | Notes |
|---|---|---|---|
| Feature reveal | 400ms, 80ms stagger | ease-out | `translate-y-4 opacity-0` to rest, once, when the grid enters view (IntersectionObserver). Starts shown without IntersectionObserver. |
| Step carousel | native smooth scroll | browser | CSS scroll-snap. Arrows and dots scroll the track only, never the page. No autoplay. |

Both rows collapse to instant under `prefers-reduced-motion: reduce`. This comes from the global rule in `index.css`, plus a `matchMedia` check for the carousel's JS scroll. Console screens keep the ≤250ms rule unchanged.

## 3. Not done

- A contact form or endpoint. Links are enough until inbound volume says otherwise.
