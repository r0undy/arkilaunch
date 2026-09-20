# Change Record

**Title:** A live viewfinder for DTR capture, a review overlay that points at what the model read, and a deployment-first scanning entry — plus the OCR-pipeline flag the client could not see
**Project:** ArkiLaunch
**Date:** 2026-09-20
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [cr-arkilaunch-camera-capture-split.md](cr-arkilaunch-camera-capture-split.md) §2 (superseded in part), [index.md](index.md) §2 (Change Log), §5 (doc count)

---

## 1. Why this pass exists

The ArkiLaunch Prototype Figma (`ENpes2ZBsS3baRPKLyx0d3`) specifies a document-scanning experience for the DTR/EDTR path that the app did not implement:

| Frame | Node | What it specifies |
|---|---|---|
| `Deployment-OCR Tool Selector [Admin]` / `[Operator]` | 587:2324 / 593:1157 | "DTR SCANNING — select which deployment to manage": a searchable deployment list, each row carrying **SCAN DTR** and **CHECK BILLINGS** |
| `OCR Tool` / `OCR TOOLh` (mobile) | 276:7877 / 784:2278 | "DTR Form Capture": a live viewfinder with corner alignment markers, a shutter, a torch toggle, a folder button, a Scanning Tips panel and a Session Data panel |
| `OCR Tool Review` / `OCR Tool Rev` (mobile) | 731:1323 / 796:1762 | The captured page with confidence-coloured bounding boxes over each reading, and a "Manual entries (low confidence)" section |

What existed instead: two buttons over two hidden `<input type="file">`, reached from a generic `/app/ocr` queue, with the extracted fields shown only as a row of confidence chips detached from the page they came from.

Two defects were found while tracing that path, and both are worse than the cosmetic gap:

**1.1 With `ENABLE_OCR_PIPELINE=true`, every paper capture failed.** `isOcrPipelineEnabled()` (`apps/api/src/ports/document-intelligence.port.ts:32`) is a server-side environment read, and the web app had no equivalent and no way to ask. `capture-modal.tsx` therefore always sent transcribed hours when both hour fields were non-empty — and they defaulted to `8` and `0`, so they always were. `edtr.service.ts:141` rejects exactly that with 422 `line_items_not_accepted` whenever the flag is on. The screen was unusable in the one configuration the whole OCR path exists for, and nothing in the test suite covered it because both sides were individually correct.

**1.2 `bounding_region` was a schema field nothing ever wrote.** `OcrFieldSchema` has carried `bounding_region` since RFC-2 §3, `EdtrFieldResponseSchema` exposes it, and `edtr.service.ts:311` maps it into every detail response. But `ExtractedField` and `ExtractedTableCell` had no such member, the Azure adapter never read `boundingRegions` off the response, and the worker never set one. The field was always `null` in production. Building the review overlay against it would have drawn nothing, silently.

## 2. Scope as agreed with the user before implementation

Asked and answered explicitly, because the first item reverses a Locked decision:

1. **Build a real `getUserMedia` viewfinder**, not a restyled file input. This supersedes §2 of `cr-arkilaunch-camera-capture-split.md`, which chose the native input as restraint-ladder rung 4 and said so in the component's own header comment.
2. **Ship the review overlay and the deployment SCAN DTR selector** as well as the capture screen.
3. **Fix 1.1 in this pass**, rather than recording it and moving on.

The earlier record's reasoning is not repudiated wholesale and its conclusion is kept: the OS file picker is still a first-class, separately-labelled action on every capture surface, for the timekeeper who already photographed the sheet and the KYC operator attaching a PDF. What changed is that it is no longer the *only* way in.

## 3. What shipped

**3.1 `apps/web/src/components/capture-field.tsx` — the viewfinder.** `getUserMedia({ facingMode: { ideal: 'environment' }, width: { ideal: 1920 } })` into an `autoPlay playsInline muted` `<video>`, with a CSS corner-marker alignment frame, a 64px shutter, a torch toggle and a folder button. The shutter draws the frame to a canvas at the sensor's own resolution and hands the resulting `File` to the existing `prepareUpload()` — the EXIF, downscale and 10MB rules from the previous record are reused unchanged, not reimplemented.

The stream is held only while nothing is captured, and released on capture, on unmount and on the component going disabled. A stream left running keeps the phone's camera indicator lit and drains the battery through an entire review.

**The fallback is load-bearing, not decorative.** `navigator.mediaDevices` is undefined on an insecure origin — which is exactly what `http://<lan-ip>:5173` is, the way `apps/web/vite.config.ts` is set up for phone testing — and `getUserMedia` rejects on `NotAllowedError` and `NotFoundError`. Each of those renders the previous record's two-button file input with a plain sentence saying why. jsdom has no `mediaDevices` either, so every pre-existing test in `capture-field.test.tsx` now exercises that fallback path by construction, which is the right thing for the path that must never regress.

**3.2 Bounding regions plumbed end to end** (closing 1.2). `ExtractedTableCell` gains an optional `boundingRegion`; the Azure adapter reads `cells[].boundingRegions[0].polygon` and **normalises it to 0..1 against its own page's width and height**. This normalisation is the substantive decision: Azure reports polygons in the page's `unit`, inches for a PDF and pixels for an image, so a consumer drawing raw coordinates would be correct for one input type and badly wrong for the other, with no symptom except a box over the wrong cell. A malformed polygon, or a page that reports no dimensions, yields no region at all rather than a guess — a misplaced highlight tells a reviewer the model read a cell it did not, which is worse than no highlight. The `edtr-sheet` parser carries the TOTAL HOURS cell's region onto each `EdtrSheetDay`, and the worker writes it as `bounding_region` on the `hours_active` field. Merged cells carry the merged cell's own box to every position they cover, consistent with how `cr-arkilaunch-edtr-real-form.md` expands their content.

**3.3 `apps/web/src/components/scan-review.tsx`** (new). Fetches a signed URL for the scan, draws the page, and overlays a box per field from the normalised polygon's axis-aligned bounds — teal above the 0.90 gate, amber below, with a text legend so the colour is never the only signal. Below-gate fields are listed again with their confidence stated as a percentage and what that percentage means. A field with no polygon still appears as a chip; it is simply not pointed at. A scan image that fails to load degrades to the field list rather than failing the review.

**Nothing on this screen deducts.** Reviewing or correcting a reading leaves it to the same RFC-2 §3 reconciliation gate; the Figma's "Save & Check Billing" is a navigation, not an approval.

**3.4 `GET /api/v1/edtr/:id/image`** (new, `apps/api/src/edtr/edtr.controller.ts`). Returns a 300-second signed Supabase Storage URL, never a public one (RFC-2 §6). The storage key is re-derived from the owning row inside `withTenantTx`, so RLS decides visibility and the caller never supplies a key; another tenant's id is simply not there and reads as 404, not 403. Guarded by `edtr:create`, the same permission as capture and the review queue.

**3.5 `GET /api/v1/reference/capabilities`** (new) returns `{ ocrPipeline, ocrKyc }`, and `capture-modal.tsx` reads it (closing 1.1). With the pipeline on, the paper path hides the hours inputs entirely and sends no `lineItems`; with it off, the manual-transcription path is unchanged. Deliberately **not** a second `VITE_ENABLE_OCR_PIPELINE` env var: two copies of one flag drift, and the drift is silent until a capture 422s in production. The server answers for itself.

**3.6 The deployment-first scanning screen.** `apps/web/src/components/deployment-scan-list.tsx` plus `routes/app.ocr.deployments.tsx`, registered at `/app/ocr/deployments` (admin) and `/field/scan` (timekeeper) from the same component. Picking a deployment opens the capture modal already scoped to that rental and already on the scanner. Search filters the in-memory pick list; no endpoint was added for it.

**3.7 `apps/web/src/lib/use-scan-deployments.ts`** (new). `routes/edtr.tsx` and `routes/field.index.tsx` had each written the same four-way `Promise.all` over the reference endpoints and the same customer-plus-site rental label, in two slightly different spellings. Both now use the hook, and the new screen is the third caller rather than a third copy.

**3.8 Tests.** Two new `azure-adapter.spec.ts` cases pinning the polygon normalisation (inches scaled against an 8.5×11 page, and the no-page-dimensions case yielding no region), and two new `capture-field.test.tsx` cases: the fallback rendering when the viewfinder cannot open, and a stubbed shutter proving the frame goes through `prepareUpload` and the track is stopped. Full suites: web 144, API 140, shared 78, document-intelligence 15 — all green.

## 4. Recorded, not fixed

1. **No edge detection and no auto-capture.** The Figma shows `DETECTING EDGES … 84%` and says the AI auto-captures once focus locks. The alignment frame shipped here is a static CSS guide with a written instruction. Marked in the source with a `ponytail:` comment naming OpenCV.js, or a Sobel pass over a downscaled canvas, as the upgrade path. Worth building only if operators are actually mis-framing sheets often enough to show up in the hard-fail rate.
2. **The deployment row is a rental, not the deployment the prototype draws.** The mock's operator, driver, contract length and contract value have no backing table: `rentals` carries customer, site and dates, `edtr` keys on `(rentalId, equipmentId)`, and nothing in the schema assigns a machine, an operator or a driver to a rental. Those columns are omitted rather than filled with something that reads as data. The machine is still chosen inside the capture sheet for the same reason. Closing this is a schema change, not a screen change.
3. **The Figma's Session Data panel is not reproduced literally.** "Asset ID: FL-982-DX", "Location: Zone 4 (Logistics)" and "Resolution: 4K Industrial" have no counterpart in this system. The panel shows the machine, the rental and the day worked — what the scan is actually about to be attached to, which is the thing worth catching before the shutter rather than at review.
4. **Real-device behaviour is unverified in CI.** jsdom can assert the fallback and a stubbed shutter; it cannot tell us what a five-year-old Android browser does with `facingMode`, `playsInline` or `torch`. The torch toggle in particular is Chrome-on-Android only and is hidden wherever `getCapabilities().torch` is not reported. `getUserMedia` needs a secure context, so verifying the viewfinder over LAN requires https on the dev server; plain http silently exercises the fallback instead, which is easy to mistake for the feature working.
5. **The overlay is only as good as what the model returns.** The EDTR path extracts through `prebuilt-layout` tables, so the only field currently carrying a polygon is `hours_active`, from the written TOTAL HOURS cell. KYC's `queryFields` path returns document-level scalars and is not plumbed here at all, so KYC review shows no boxes.
6. **No accuracy claim.** Nothing in this pass changes what is extracted or how it is graded. AIA-R5 stays as it was.
