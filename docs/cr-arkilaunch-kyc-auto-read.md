# Change Record

**Title:** Automatic KYC scan acceptance and reading
**Date:** 2026-10-01
**Status:** Applied on feature branch
**Traceability:** PRD-F6, customer company wizard; DSD section 4 capture behavior

## Decision

A clear document captured after the steady hold is straightened, prepared and sent to OCR automatically. A selected image follows the same path when edge and quality detection succeed. Selected PDFs proceed to reading immediately. The customer no longer has to press Use scan or Use file in these cases.

If detection or correction cannot produce a clear scan, the customer can inspect the image, adjust its corners, use the original or retake it. Manual shutter and file upload remain available. The applicant still checks extracted identity and company fields before submitting, and staff verification remains mandatory.

## Verification

Cover automatic acceptance of a clear image and PDF, correction failure and manual review fallback, document stage transitions, and the existing OCR rejection path. Run web tests, lint, typecheck, build and the available Playwright KYC flows.
