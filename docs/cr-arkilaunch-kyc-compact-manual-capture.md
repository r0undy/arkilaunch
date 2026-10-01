# Change Record: Compact manual KYC capture

**Date:** 2026-10-01  
**Status:** Applied  
**Traceability:** PRD-F6; DSD §4

## Request

Manual ID testing could not reliably complete capture because the KYC camera filled the viewport and only auto-captured after document-edge detection and a steady hold.

## Change

KYC document and ID capture now stays inside a bounded, centered large wizard dialog. The camera keeps the complete document visible in a 4:3 viewfinder, while automatic steady-hold capture remains available alongside a visible manual shutter. File selection, camera retry, corner adjustment, retake, and OCR/human-review gates are unchanged.

## Scope and safety

This is a web presentation and capture interaction change only. No API, OCR, storage, schema, confidence threshold, tenant-isolation, or KYC approval rule changed. Camera tracks are still stopped when leaving or completing capture, and the file-input fallback remains available when camera access is unavailable.

## Verification

Focused CaptureField tests cover the compact viewfinder, manual shutter, automatic path, fallback, retake, and stream cleanup. The existing KYC browser flow remains covered by the Playwright specification.
