# Change Record

**Title:** Automatic KYC document capture and alignment
**Date:** 2026-10-01
**Status:** Applied on feature branch
**Traceability:** PRD-F6, customer company wizard; DSD section 4 capture behavior

## Decision

The live camera detects a complete ID or company document, guides alignment and lighting, then captures after a two-second steady hold. A pinned, locally served OpenCV.js build detects its corners and corrects perspective. The customer reviews the corrected image and can adjust corners, use the original, or retake before OCR. Selected images follow the same correction and review; PDFs remain unchanged. Manual shutter and file upload stay available.

The scanner is limited to KYC capture and loads only on those screens. Preview frames stay in the browser. An accepted file follows the existing OCR, upload, and staff-review paths; no API, schema, KYC approval rule, or retention policy changes.

## Verification

Cover the steady-hold gate, browser edge detection and perspective output, review-before-OCR, document stage transitions, and camera/file fallbacks. Run the web unit suite, TypeScript, production build, and Playwright KYC flows where the local API and storage are available.
