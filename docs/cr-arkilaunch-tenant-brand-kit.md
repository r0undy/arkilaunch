# Change Record

**Title:** Tenant brand kit (header color, square icon, Facebook page, font choice), per-tenant SEO written at the edge, and Almara branded from the Figma prototype
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `In Progress` (repo, branch `feat/tenant-brand-kit`); per-phase status in §3
**Trigger doc:** user request 2026-09-27 ("align the Almara tenant's branding to the branding in this Figma design ... the colors, the logo of Almara, and its branding ... Ensure to get its SEO, Favicon, and anything else set up. You can add more features in the tenant customization"). Figma `ENpes2ZBsS3baRPKLyx0d3`, Landing Page `144:1386`; the same brand on Login `144:1451`, Equipments `185:1599`, Dashboard `236:1941`.
**Docs touched by this record:** [dsd-arkilaunch.md](dsd-arkilaunch.md) §2.1, §2.2, §2.3 (+ `DESIGN.md`, `BRAND.md`), [index.md](index.md) §2. Phase 3 adds [build-arkilaunch.md](build-arkilaunch.md) §5.2 (+ `AGENTS.md`) and [sdd-arkilaunch.md](sdd-arkilaunch.md) §6. Narrows the "full-palette theming is out of scope" gap of [cr-arkilaunch-tenant-self-serve-branding.md](cr-arkilaunch-tenant-self-serve-branding.md) by exactly the fields below, and Phase 3 supersedes the "assets-only Worker, no Worker script" statement of [cr-arkilaunch-cloudflare-frontend.md](cr-arkilaunch-cloudflare-frontend.md).

---

## 1. Why

The prototype brands Almara with a rust top bar (`#A23E01`, white text) on every screen, teal actions (`#5EC2C2`), a teal circle mark, and Inter. A tenant could set one color, a logo and a hero, so none of that was expressible. There was no favicon. Every storefront page also shipped `noindex`: it is the shell's default, and the prerender script that would lift it was hard-coded to Almara and never ran on deploy.

## 2. What changes

Everything is per tenant. Almara's values live only in Almara's `tenants` row; nothing Almara-specific ships in code, CSS defaults or the build. A tenant that sets none of the new fields looks exactly as before.

| Area | Change |
|---|---|
| Branding fields | New nullable `tenants` columns (migration 0060): `header_color` (`#rrggbb`), `icon_key`, `facebook_url` (https on facebook.com / fb.com only; it lands in an `href`), `font` (`'inter'`, or NULL for IBM Plex). Written through a new 13-argument `tenants_update_branding` overload and `tenants_set_branding_image(…, 'icon', …)`; read through `catalog_get_tenant` / `tenants_get_branding`. Expand-only: the 10-argument overload stays for the API revision still serving during `terraform apply`. |
| Form | Storefront branding (`/app/branding`, and `/admin/companies` for a platform admin) edits the header color, the font, the Facebook page and a square icon. |
| Design system | DSD §2.1: a tenant's header color paints only its top bar (storefront nav, account and staff app bar) and the browser theme color; text on it is black or white by higher WCAG contrast. It is not a token and never recolors a semantic hue. §2.2: the tenant icon. §2.3: a tenant may pick Inter for prose and display on its own host; IBM Plex Mono keeps every number (Rule 2) and the platform host stays on Plex. |
| Tenant host (Phase 2) | The top bars take the header color. The app-bar mark is the icon, else the logo, else the initial. The storefront footer shows the logo and a "Follow us" Facebook link. The favicon and theme color follow the tenant. Inter is self-hosted and fetched only by a tenant that picks it. |
| Edge SEO (Phase 3) | The Cloudflare Worker gains a script. On a tenant host it writes that tenant's title, description, canonical URL, Open Graph/Twitter tags, favicon, theme color and Organization JSON-LD into the HTML, lifts `noindex` on the public pages only, and serves a per-tenant `robots.txt` and `sitemap.xml`. Branding comes from `/catalog/tenant` with a per-slug edge cache. The Almara-hard-coded prerender script is deleted. |
| Almara (Phases 2 and 4) | Primary `#5ec2c2`, header `#a23e01`, font Inter, the Figma circle mark as logo and icon (`docs/assets/tenants/almara/logo.png`), and the Figma hero copy as tagline. |

## 3. Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Fields, migration, API, form, DSD | In progress |
| 2 | Tenant host renders the brand kit; Almara seed and logo | Not started |
| 3 | Edge SEO Worker; prerender removed | Not started |
| 4 | Almara's values applied to the live site (with the user's go-ahead) | Not started |

## 4. Known gaps

- The 10-argument `tenants_update_branding` overload is dead once every API revision runs the 13-argument one; a later contract migration drops it.
- Almara's Facebook page URL is not in the Figma, so Almara's `facebook_url` stays empty until it is provided.
- The email header band keeps the primary color; it does not use the header color.
- Not taken from the Figma: the ISO 9001 badge and the crane hero photo; the neutral backgrounds (`#F8FAFC` footer, white hero), because neutrals are not tenant-overridable; the Inter Black headline weight (the family swaps, weights stay); the dark `#2C2C2C` landing "Rent" buttons (the Equipments frame uses teal, the primary).
- The platform host (`arkilaunch.app`) keeps its `noindex` shell and its static sitemap, and still has no favicon; the DSD's ArkiLaunch mark was never produced.
