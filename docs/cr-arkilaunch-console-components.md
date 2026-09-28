# Change Record

**Title:** Console components follow Cloudscape; calmer pages; lists as cards on phones
**Project:** ArkiLaunch
**Date:** 2026-09-28
**Version:** 0.1
**Status:** `Applied` (branch `feat/console-cloudscape`)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 (owner request: make the tenant dashboard's modals, badges, toasts and alert dialogs follow the AWS design, reduce the pages that show too much, and make it responsive)
**Reference:** [assets/reference/aws.design.md](assets/reference/aws.design.md) "Console Components (Cloudscape)", added by this record
**Docs touched by this record:** [dsd-arkilaunch.md](dsd-arkilaunch.md) §4 Inputs & Forms, Surfaces, Domain components, §4.1 (materialized into `DESIGN.md`), [assets/reference/aws.design.md](assets/reference/aws.design.md), [index.md](index.md) §2

---

## 1. Why

The AWS reference captured only the marketing homepage, so the console's dialogs, feedback and status markers had no spec to follow. The DSD also disagreed with itself: dialogs were `--radius-lg` in one line and `--radius-md` in the radius scale, badges `--radius-sm` (8px) against a 4px scale entry, and inputs `--radius-sm` against the 0px input token. Several pages also led with every figure they had, and every list only scrolled sideways on a phone.

## 2. Components

- **Modal:** Cloudscape anatomy. Focus opens on the first field (or Cancel in a confirm), never the X. The X is a 44px target. Esc is Cancel everywhere; the scrim still never dismisses a money or destructive dialog. `--radius-md`.
- **Confirm:** `alertdialog`, link-style (ghost) Cancel, a 16px body.
- **Footer rule:** Cancel (ghost) then the one primary action, always in the footer.
- **Flashbar:** adds warning; info gets its own icon; the dismiss X is 44px; auto-dismiss pauses on hover or focus; sticks flush under the 56px bar.
- **Alert (new):** the one inline message. Replaces the hand-built banners and bare red sentences on the console pages and `LoadError`.
- **Status Badge:** now a Cloudscape status indicator (colored icon + text label, no chip). Hand-built score and count chips go.
- **Expandable Section (new):** where trimmed detail goes.

## 3. Pages

Detail is moved, not deleted: into an Expandable Section, the row's drawer, or the one place it already appears.
- **Dashboard:** four headline figures; fleet counts under "Fleet details"; one review-queue number.
- **Site hub:** coordinates under "Location details"; the sentence that repeated the counts is gone; day headers read "Mon 22".
- **Company review drawer:** score, warnings and actions stay in view; company, contact and ID fields sit in sections.
- **Bookings, billing, reports, invoices:** names in place of codes, dates without seconds or ISO strings, the deposit figure shown once on Reports, a short invoice reference with copy, and map coordinates out of the Sites table.

## 4. Phones

`Table` renders each row as a card below 768px (title, status, label/value pairs, actions), so every list page follows. The site daily-log grid becomes one card per machine; the incident filter uses the shared `Tabs` (44px targets).

## 5. Not done

- Flashbar stacking ("N notifications"). Add when toasts pile up in practice.
- Page-level decluttering of `/account` and `/admin` (they inherit the components and table cards).
