# Change Record

**Title:** Guided customer company setup
**Date:** 2026-10-01
**Status:** Applied on feature branch
**Traceability:** PRD-F8 customer booking prerequisite; DSD section 4 modal and onboarding patterns

## Problem and decision

The Add company modal asked for a document type and its photo on the same screen, then combined the primary registration and optional DTI captures. A first-time customer needed a slower sequence with one decision or task at a time.

The customer now chooses an ID type, captures it, checks extracted ID details, chooses BIR or SEC registration, captures it, optionally adds a DTI certificate, then reviews and submits the company. A saved ID skips its three screens. Each choice requires Continue; capture keeps the camera, file fallback, crop, and unreadable-document handling. Back and browser history keep the in-memory work while the modal is open. Direct links to later steps fall back to the first missing input. Changing a document type invalidates its captured document. Closing warns and discards the draft.

The modal remains over Applications and hides the account sidebar. The existing company API, OCR endpoint, upload flow, KYC approval, and document requirements do not change.

## Documentation and verification

DSD section 4 specifies the sequence and is re-materialized in `DESIGN.md`; `index.md` records this change. Unit coverage checks step choice, ID-on-file skipping, optional DTI, type-change invalidation, guarded direct links, and close behavior. Browser company-document and OCR-crop scenarios are updated for the new sequence.
