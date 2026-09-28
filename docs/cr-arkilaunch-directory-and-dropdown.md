# Change Record

**Title:** AWS-style dropdown everywhere; a live platform directory
**Project:** ArkiLaunch
**Date:** 2026-09-28
**Version:** 0.1
**Status:** `Applied` (branch `feat/directory-and-dropdown`)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (owner request: improve "Find a rental company" on the platform landing, make it engaging and interactive, and use the AWS dropdown design)
**Reference:** [assets/reference/aws.design.md](assets/reference/aws.design.md)
**Docs touched by this record:** [dsd-arkilaunch.md](dsd-arkilaunch.md) §4 Inputs & Forms, §5 (materialized into `DESIGN.md`), [index.md](index.md) §2

---

## 1. Summary

### The dropdown

Every dropdown is now a select-only combobox (WAI-ARIA APG):
- **Trigger:** square, with a caret that turns when open.
- **Menu:** floating, with the menu lift (`--shadow-lg`).
- **Options:** the highlighted row is tinted. The chosen row is in accent with a check and a 2px accent edge.
- **Keyboard:** arrows, Home/End, PageUp/PageDown, type-ahead, Enter/Space, Escape, Tab.

A hidden native `<select>` stays the source of truth, so FormData, `required` and every caller's `onChange` are unchanged. The shared `Select` gained `labelHidden`, and all 12 hand-rolled `<select>`s now use it. Escape in an open dropdown closes the menu, not the modal around it. The e2e tests pick options through `e2e/select.ts` `choose()`.

### The directory

The platform landing's "Find a rental company":
- **Filters:** searches live as you type (300ms debounce), with equipment toggle chips, a City dropdown, applied-filter chips you can clear, and a result count.
- **Cards:** each card has a brand-color strip and initial tile, up to three equipment tags, and a "Visit storefront" row. That row slides in on hover with a pointer and is always visible on touch.
- **Paging:** pages of 9, kept in the URL as `?page=`.
- **Motion:** cards rise in (400ms, 50ms stagger) when a new result set arrives.

## 2. Data

Migration 0062 is functions only and expand-only; migration-rls-guardian: PASS.
- `catalog_list_tenants` gains `primary_color`, `categories text[]` and `total_count`. It keeps the same active, non-platform, non-fixture scope, and exposes no new private column.
- `catalog_list_locations()` lists the cities those tenants are in.
- The response gains `total` and `locations`.

## 3. Not done

- Multi-select dropdowns, grouped option headers, and filtering inside the menu. No caller needs them yet.
