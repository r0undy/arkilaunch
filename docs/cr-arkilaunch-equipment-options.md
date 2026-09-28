# Change Record

**Title:** Rental options per unit, photo credit, and the Almara equipment catalog
**Project:** ArkiLaunch
**Date:** 2026-09-28
**Version:** 0.1
**Status:** `Applied` (branch `feat/equipment-catalog-options`)
**Trigger doc:** Owner catalog request 2026-09-28 (backhoes/excavators with bucket and arm choices, bulldozers, self-loading trucks, dump trucks, reference photos)
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §3 (`equipment_types`, `equipment`, `equipment_assignments`) and the `POST /api/v1/bookings` contract, [index.md](index.md) §2

---

## 1. Rental options per unit

**Before:** a unit had no choices. A customer who needed a 3/4 bucket or a long arm had to say so in the negotiation thread.

**After (migration `0065_equipment_options_photo_credit.sql`):**
- **Stored on the unit:** `equipment.option_groups` is a jsonb list of `{ name, values[] }`, for example "Bucket size" with Standard, 3/4 and 1/2, or "Arm" with Short and Long. There are at most 6 groups of 12 choices each, and names and choices must be unique (`EquipmentOptionGroupsSchema`).
- **Editing:** the equipment form has a "Rental options" section. `POST/PATCH /equipment` take `optionGroups`, and `optionGroups: []` clears them.
- **Picking in the cart:** the cart shows one select per group, starting on the first choice. The groups are read live from the catalog, not from the cart's saved copy, so a changed or swapped unit cannot carry a pick it no longer offers.
- **Checking on the server:** `POST /bookings` checks each item's `selectedOptions` against the unit's groups (`selectedOptionsError`). Every group needs one of its own choices, and nothing else is allowed. Otherwise the request fails with 422 `invalid_options`. The pick is stored on `equipment_assignments.selected_options`, and `GET /bookings/:id` returns it per item.
- **The storefront:** the unit page lists the choices.

**Not changed:**
- Options are labels, never measurements, and they never change a price. `rate_cards` stays the one source of truth on the money path.
- The quote engine does not read options.

## 2. Photo credit

- `equipment.photo_credit` and `equipment.photo_source_url` (https only, CHECK) record whose photo it is and where it came from. Both are editable in the form, and `''` clears them.
- The public catalog functions (`catalog_list_equipment`, `catalog_get_equipment`) now return both fields. The unit page shows "Reference photo: <credit>" linked to the source, so a reference photo is never passed off as the unit itself.
- 0026 made equipment UPDATE column-granted, so 0065 grants UPDATE on the three new columns.

## 3. The Almara catalog

- **New category:** `Self-Loading Truck` is added as a global category. These are trucks that carry other heavy equipment between sites, not concrete mixers.
- **Owner's decisions:**
  - Mitsubishi, Sumitomo and Komatsu go under Excavator, and the Caterpillar under Backhoe Loader.
  - "Pison" is the local name for a bulldozer, so it appears in the unit name.
  - Sizes are labels.
- **Seeded units (`seed/anchor.ts`), all tenant Almara Construction:**

| Category | Units | Options |
|---|---|---|
| Excavator | Mitsubishi MS90, Mitsubishi MS70, Sumitomo Excavator, Komatsu PC40 | Bucket size (Standard, 3/4, 1/2), Arm (Short, Long) |
| Backhoe Loader | Caterpillar Backhoe Loader | same |
| Bulldozer | Bulldozer (Pison), Standard; Bulldozer (Pison), 10 tons | none |
| Self-Loading Truck | Standard #1, Standard #2, Small | none |
| Dump Truck | Dump Truck, Mini; Dump Truck, Standard | none |

- **Seed rules:**
  - No model numbers, capacities or specs are invented. "10 tons" is a label, not `weight_capacity_tons`.
  - Serials are seed placeholders (`almara-exc-ms90`, and so on).
  - No rate cards are added, so the owner prices these units later. The Cat backhoe loader still picks up Almara's existing type-wide Backhoe Loader card, which was seeded before this change.
  - Re-seeding never overwrites a unit the owner has since edited.
  - The sample rental now finds its backhoe by serial, not by "the tenant's first unit".
- **Photos:** the owner authorized the reference photos with credit. They sit in the web fallback map (`equipment-images.ts`), and each unit's credit is on its row.
  - Photos: MS90 (Truck2Hand), MS70 (Plant and Equipment, MS070-8), Sumitomo (Sumitomo Vietnam, SH80-6B), bulldozer 10 tons (Komatsu, D39EX-24), standard dump truck (PinoyDeal, Sinotruk Howo A7).
  - No photo, so the schematic glyph shows:
    - Komatsu PC40: its page has only a line drawing.
    - Caterpillar: cat.com refused the fetch.
    - Mini dump truck: the listing's image link returns 404.
    - Standard bulldozer and self-loading trucks: no reference was given.
  - The owner can upload real fleet photos through the existing flow at any time.

**Migration:** columns only, on tables that already carry `tenant_id` and RLS, with defaults of `'[]'` / `'{}'` / null. There is no new tenant table, no backfill, and nothing destructive.
