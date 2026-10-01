# Change Record

**Title:** Full-screen KYC document capture
**Date:** 2026-10-01
**Status:** Applied on feature branch
**Traceability:** PRD-F6, customer company wizard; DSD section 4 capture behavior

## Decision

The Add company wizard fills the viewport on government ID, primary registration and optional DTI capture steps. The camera, detected outline and corner correction use the wider content area, with the wizard header and actions kept in the full-height dialog. Choice, extracted-field review and final details steps retain the smaller modal.

The capture dialog keeps its focus trap, Escape and close behavior, and scrollable body on small screens. OCR and KYC approval rules are unchanged.

## Verification

Cover full-screen capture sizing and return to the regular modal on review steps, focus and close behavior, and desktop/mobile document capture flows.
