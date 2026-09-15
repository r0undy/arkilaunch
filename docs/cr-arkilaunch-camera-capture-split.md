# Change Record

**Title:** Camera capture split from file upload on both OCR intake screens, and the client-side compression RFC-2 §2 has always specified
**Project:** ArkiLaunch
**Date:** 2026-09-16
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §2 (capture step), [prd-arkilaunch.md](prd-arkilaunch.md) US-02 AC3 and §5.1 (S21), [index.md](index.md) §2 (Change Log)

---

## 1. Why this pass exists

**1.1 The single file input was camera-only, not camera-or-file.** Both OCR intake surfaces rendered one `<input type="file">` carrying `capture="environment"`:

- `apps/web/src/routes/edtr.tsx` (`accept="image/*"`), the paper EDTR sheet
- `apps/web/src/routes/kyc.tsx` (`accept="image/*,application/pdf"`), corporate documents

On most mobile browsers `capture` does not add the camera as one option among several. It replaces the file picker with the camera. So a timekeeper who had already photographed the sheet could not attach that photo, and a KYC operator could not attach a PDF or a scan sitting on the device, although `POST /kyc/extract` plainly accepts one (SDD §4). The user-visible request that started this pass was to make taking a photo and choosing a file two separate choices, which is what PRD §5.1 S7 describes ("Upload/scan a paper EDTR") and what the single input quietly prevented.

**1.2 Client-side compression was specified in four Locked places and never built.** RFC-2 §2 step 1: "accepts either a `paper_ocr` image (compressed client-side)". SDD §4 wire contract: "`file: binary // required for paper_ocr; compressed client-side`". SDD §1/§2, PRD-NFR8, and DSD §6 all repeat it. Nothing in `apps/web` compressed anything. The raw file from the picker went straight to `apiPostForm`.

That gap is survivable while the input is a deliberate file choice and expensive the moment it is camera-first. A modern phone camera produces a 3 to 12MB image, frequently HEIC, and `apps/api/src/storage/upload-validation.ts` allows only JPEG, PNG and PDF under 10MB. Both refusals (413 `file_too_large`, 422 `unsupported_or_forged_content_type`) arrive only after the entire file has crossed a 3 to 5 Mbps link. This is drift between Locked docs and code, so it is recorded here rather than coded around.

**1.3 Every selected image leaked an object URL.** `onScanFile` in both routes called `URL.createObjectURL` and never revoked it, so a capture session retained every photo it previewed.

**1.4 The timekeeper could not reach EDTR capture at all.** Found while testing 1.1 on a real phone, and worse than the defect that started this pass. `/app/ocr` is the only screen in the app that opens the capture modal, and `apps/web/src/routes/_app.tsx` guards it with `requireRole('admin', 'owner', 'platform_admin')`. A timekeeper signing in is routed to `/field`, whose nav offers Dashboard and Your sites and nothing else. So the persona PRD US-02 is written for ("enter EDTR hours directly on my phone ... or fall back to photographing the paper sheet") had no way to record anything, and S21, specified in PRD §5.1 as the mobile-first timekeeper console with "digital EDTR entry; paper upload", did not have either.

This was never a server-side restriction. `POST /edtr` requires `edtr:create` (`apps/api/src/edtr/edtr.controller.ts:70`), which `permission-catalog.ts` grants the timekeeper role, and the reference pick-list endpoints carry no `@RequirePermission` at all. The whole gap was a missing screen.

## 2. Scope as agreed with the user before implementation

Agreed: split the two intents on both screens; keep the native file input rather than building a `getUserMedia` viewfinder; implement client-side compression as part of the same pass.

The native input is the restraint ladder's rung 4 (`AGENTS.md` §5, "native platform feature") and it wins on merit here, not only on restraint: the OS camera app on a five-year-old Android is better at focus, exposure and the sideways afternoon light of DSD §5 than anything we would ship, and it costs no bundle bytes on a device budget that DSD §6 caps at 90KB of fonts alone.

Explicitly not in this pass, and still outstanding against PRD-NFR8 / SDD NFR-8 / DSD §6: the offline upload queue, chunked or resumable transfer, and a visible upload progress indicator. AC3 of US-02 is therefore **partially** satisfied, not closed. See §4.

## 3. What shipped

**3.1 `apps/web/src/components/capture-field.tsx`** (new). One component, used by both screens, so the two surfaces cannot drift apart again. It renders two visually hidden file inputs sharing one change handler, one carrying `capture="environment"` and one carrying no `capture` attribute at all, behind two `Button` components labelled "Take photo" and "Choose a file", plus "Remove" once something is held. Using real buttons keeps the `--input-focus-ring` treatment and the 44px target from `button.tsx` for free; `size="field"` gives the timekeeper console its 48px (DESIGN.md §4). The wrapper is a `<fieldset>`/`<legend>`, matching the existing "how was it recorded?" radio group in `edtr.tsx`. No Tabs primitive was added; the repo has none and this did not warrant introducing one.

Failures render inline under `role="alert"` and the field is left empty: it is either holding a file we will send, or it is empty and saying why, never both. The preview object URL is now tied to the current value and revoked on replace and on unmount, closing 1.3.

**3.2 `apps/web/src/lib/image-compression.ts`** (new). `prepareUpload()` decodes with `createImageBitmap(file, { imageOrientation: 'from-image' })`, which applies the EXIF rotation during decode so a sideways phone photo is stored upright rather than travelling with an orientation tag the extractor ignores. It caps the long edge at 2200px (legible handwriting for Azure DI at roughly a tenth of the bytes), re-encodes to JPEG at quality 0.82, and takes one more rung down (1600px, 0.7) before refusing rather than bouncing a photo we could still have made fit. HEIC is normalised as a side effect of decode-and-re-encode: a browser that can render it produces a JPEG here, and one that cannot produces a local, readable refusal that costs no bandwidth.

A PDF is passed through untouched. Canvas re-encoding one would destroy it, and the KYC path legitimately accepts scanned corporate documents.

**3.3 The one mirrored constant is labelled as such.** `MAX_UPLOAD_BYTES` now exists on both sides, and `apps/api/src/storage/upload-validation.ts` carries a comment saying so, as does the client copy. The type allowlist is deliberately **not** mirrored: everything the client emits is a JPEG or an untouched PDF, so there is nothing for a second list to decide. The server remains authoritative and unchanged in behaviour: it still sniffs magic bytes, still ignores the client `Content-Type`, still enforces its own caps on every request. Nothing added in this pass is a security control, and the API trusts none of it.

**3.4 Both routes rewired.** `edtr.tsx` and `kyc.tsx` drop their `onScanFile` handlers and their `scanPreview` state and render `<CaptureField>`. The submit path is untouched: the same `File` still goes to `apiPostForm`.

**3.5 The timekeeper console has a capture entry point** (closing 1.4). `CaptureModal` moves out of `routes/edtr.tsx` into `apps/web/src/components/capture-modal.tsx` unchanged, and `routes/field.index.tsx` gains a full-width "Record a field log" action at 48px that opens it, loading the same pick lists. When nothing is out on rental at the operator's sites the button is disabled with a sentence saying why, rather than opening a form with an empty machine list. `apps/web/src/test/render-route.tsx` now wraps the tree in `ToastProvider`, matching `main.tsx`; without it any toast-using screen throws under test, which is why no route test had reached this modal before.

**3.6 Tests.** `capture-field.test.tsx` (8), `image-compression.test.ts` (12) and `field.index.test.tsx` (3, covering the 1.4 entry point end to end through the real route tree and its guards). The load-bearing assertion is that the file-picker input must not carry `capture`, which is the exact defect 1.1 describes and the one a future refactor is most likely to reintroduce.

## 4. Recorded, not fixed

1. **US-02 AC3 is still not fully met.** "SHALL compress" now holds. "SHALL show progress with a retry" and the offline queue (PRD-NFR8, SDD NFR-8, DSD §6) are not built. The capture field shows a "Preparing the photo for upload" status during the canvas step, which is not upload progress.
2. **Chunked / resumable transfer** is specified in SDD §2 and does not exist. A dropped connection mid-upload still loses the attempt, though it no longer loses the entered form data any more than it did before.
3. **A browser that cannot decode HEIC now refuses locally** instead of refusing at the server. That is a better failure, not an eliminated one. Users on such a browser still cannot attach a HEIC photo.
4. **The client constants are a duplicated pair.** Nothing mechanically enforces that they stay in step with `upload-validation.ts`; the comments on both sides are the whole mechanism.
5. **Quality settings are unvalidated against the golden set.** 2200px at q0.82 is a judgement call, not a measured one. `AIA-R5` (handwriting accuracy across writers and conditions) stays Open, and compression changes the input distribution the model sees, so the OPS SLO-13 golden-set re-run should be read with that in mind once the model is trained. No accuracy claim is made here.

## 5. Pre-merge gate runs

Per `AGENTS.md` §5.2 and SAD §4.

| Gate | Verdict |
|---|---|
| `restraint-guardian` | **PASS**, with one non-blocking simplify note, acted on. It confirmed the native file input was taken over a `getUserMedia` viewfinder and that compression was hand-rolled rather than pulling in an npm image library, and it asserted no validation, authz, RLS, a11y or test control was cut. The note: `prepareUpload` carried optional `maxEdge`/`quality` overrides no caller passed and no test exercised. Those are gone (the scale rungs stay as module constants), and so is an exported content-type allowlist that had no reader at all |
| `ai-ocr-abuse-runner` | **PASS** on AI-01..AI-06, and explicitly that the client-side pre-checks weaken no server-side boundary control: the multer size limit, the magic-byte sniff and both decompression-bomb guards still run in the same order, before `uploadObject()` and before any extraction |
| `tenant-isolation-checker` | **PASS**. No `service_role` on a request path, no raw SQL, no DB access outside an RLS transaction, no client influence over `tenant_id` or over the Storage object key, no new tenant-owned table. The compression and capture work is local file handling in the browser and touches no data path |

`migration-rls-guardian` and `edtr-ocr-worker` are not triggered: no schema, migration, query, or worker code is touched by this pass.

These three verdicts come from reading the diff against the specs, not from executing `apps/api/test/ai-abuse.spec.ts`. That suite is DB-backed and cannot run here (no Docker, no local Postgres, and `.env` points at live pilot data), so it is verified by CI on the PR, as in `cr-arkilaunch-m4-money-path-gates.md` §5. All six evals do have dedicated tests, contrary to the QAD §4 addendum of 2026-09-07, which recorded AI-05 and AI-06 as untested; that note is stale and is flagged here rather than edited, since QAD is Locked and correcting it is not in this pass's scope.

## 6. Money path

Untouched. No reconciliation, confidence, deduction, gate or `model_id` behaviour changes, and a compressed image still lands as `status=queued` for the same worker under the same `ENABLE_OCR_PIPELINE` flag. `report_date` stays user-entered and is deliberately **not** read from EXIF, which would have turned image metadata into a price-selection input (see `cr-arkilaunch-deduction-rate-card-effectiveness.md` §4 on `report_date` as a client-controlled money input).

## 7. Verification

**Runnable here, and run:**

- `pnpm --filter @arkilaunch/web exec vitest run`: 18 files, 102 tests, all passing (94 before this pass).
- `pnpm --filter @arkilaunch/web typecheck`: clean.
- `pnpm lint`: clean.

**Not runnable here, therefore not claimed:**

- The real mobile behaviour. jsdom cannot tell us what a given Android browser does with `capture`; the tests assert the attribute is on one input and absent from the other, which is the condition the behaviour depends on, not the behaviour itself.
- Actual compressed output. jsdom has no image decoder and no canvas raster, so `createImageBitmap` and `toBlob` are stubbed and the tests cover the decision logic around them, not the pixels.

**Manual checks still owed (QAD-T13, QAD-T14, and the QAD §2 "real cheap Android over a metered link" pass):**

1. On a real Android: "Take photo" opens the camera, "Choose a file" opens the gallery or file browser, and a 12MP photo uploads without a 413.
2. A photo taken sideways is not stored rotated.
3. A `.txt` renamed to `.jpg` and a file over the cap are both refused locally with a readable message and no network request, and are still refused by the server when the client check is bypassed.
