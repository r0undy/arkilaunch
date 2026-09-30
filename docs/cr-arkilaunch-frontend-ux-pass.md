# Change Record: Frontend usability pass

**ID:** cr-arkilaunch-frontend-ux-pass
**Date:** 2026-09-30
**Status:** Applied
**Trigger:** Owner feedback and screenshots of field logs, People and Equipment.

## Decision

Apply the current AWS-inspired Yardboard language across existing frontend controls and the crowded operations screens. Shared `Input` date and date-time fields use a modal calendar with month/year navigation, keyboard day selection, explicit time selectors and the existing wire values. Staff list rows favor a short status and next action; secondary facts move into open details. People and Equipment use one prominent action plus a menu. Weather and incident summaries lead with an icon and a short label.

The field-log review state uses the quieter Status Badge in the list, while the detailed reconciliation view keeps its Status Pill. The app-bar review queue becomes an icon, label and plain count. The existing warning and weather scales, approvals, server validations and route permissions retain their meaning.

## Implementation

- Shared date picker and action menu; existing forms receive the date picker through `Input`, retaining their values and min/max limits.
- Field-log grouping and table/card layout adjusted for narrow content columns. Customer name and secondary figures remain visible when a rental group is open, without dominating its header.
- People and Equipment actions grouped; image failure in Equipment falls back to the existing schematic.
- Forecasts, machine weather levels and incident kinds use icon and label summaries.
- DSD section 4 updated and `DESIGN.md` rematerialized from those canonical changes. No API, database or schema change.

## Verification

- Web typecheck and Vitest suite.
- Playwright field-log flow and responsive operations sweep at 360, 768, 1024 and 1440 pixels, including screenshots at phone and desktop widths.
- Keyboard and focus tests for the calendar and action menu.
