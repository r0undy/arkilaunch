# Change Record

**Title:** Full-viewport automatic KYC camera
**Date:** 2026-10-01
**Status:** Applied on feature branch
**Traceability:** PRD-F6, customer company wizard; DSD section 4 capture behavior

## Decision

While the KYC camera is live, its video and alignment guide cover the viewport. The customer can leave the camera or choose an existing file from the overlay. There is no manual shutter on KYC scans: the camera captures only after a complete document is clear and steady for two seconds. If automatic alignment cannot start, the camera closes and offers a retry or file selection.

The field-log camera keeps its existing manual shutter. An unclear selected KYC image still goes to corner review. OCR, applicant field review and staff verification remain unchanged.

## Verification

Cover the scanner's full-viewport camera, absence of the shutter, Back and file fallback, steady-hold capture gate, and automatic or manual-review transitions for selected documents. Run web unit and browser KYC flows on desktop and mobile.
