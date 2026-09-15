# Change Record

**Title:** Real Azure DI extraction turned on for KYC, and the evidence that the EDTR pipeline cannot be turned on yet
**Project:** ArkiLaunch
**Date:** 2026-09-16
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [aia-arkilaunch.md](aia-arkilaunch.md) §2/§4 (AIA-R1/R3/R5/R7 status), [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §5/§7, [index.md](index.md) §2 (Change Log)

---

## 1. Why this pass exists

The request was to turn extraction on. Extraction is two independent flows behind two independent flags (RFC-2 §7), and they are in very different states. This record exists because that difference was not written down anywhere as a verified fact, only as a prediction in `model-registry.ts` and `cr-arkilaunch-pilot-honesty.md` §4.

Both flags had been `false` since they were introduced, and `AZURE_DI_ENDPOINT` / `AZURE_DI_KEY` were empty locally, so the factory in `apps/api/src/ports/document-intelligence.port.ts` returned an `UnavailableDocumentIntelligenceAdapter` and nothing was ever extracted.

## 2. What was verified against the live resource

The Terraform-provisioned resource `di-arkilaunch-dev` (`rg-arkilaunch-dev`, `FormRecognizer`, F0, `southeastasia`) exists and answers. Checked on 2026-09-16:

**2.1 The custom EDTR model does not exist.** `GET /documentintelligence/documentModels` returns prebuilt models only, no custom entry of any kind, and `GET .../documentModels/arkilaunch-edtr-neural-v1` returns **404**. This confirms, as fact rather than prediction, the note `packages/document-intelligence/src/model-registry.ts` has carried since it was written, and `cr-arkilaunch-pilot-honesty.md` §4.

**2.2 KYC extraction works.** `prebuilt-layout` with `features=queryFields&queryFields=SecNumber,Tin` was run against a synthetic SEC/TIN document and returned:

| Field | Value | Confidence |
|---|---|---|
| `SecNumber` | `CS201812345` | 0.995 |
| `Tin` | `123-456-789-000` | 0.995 |

This settles an open question the docs had never answered: **`queryFields` is available on the F0 tier.** It is a premium add-on and the free tier was a plausible reason it would not be, which would have forced the KYC design back to the drawing board.

The response shape matched the adapter's existing mapping exactly (`documents[0].fields.<QueryName>.valueString` plus `confidence`), so `QUERY_FIELD_TO_PORT_KEY` maps correctly to `sec_number` / `tin` with no code change.

## 3. What shipped

**3.1 KYC extraction enabled locally.** `AZURE_DI_ENDPOINT` and `AZURE_DI_KEY` set from the Terraform-managed resource, and `ENABLE_OCR_KYC=true`, in the developer's local `.env` only. **No Terraform variable, no GitHub environment, and no deployed environment was changed by this pass.** Both flags remain `false` in `infra/terraform/environments/dev` and `prod`.

No application code was needed. The KYC path has been fully wired since `cr-arkilaunch-azure-di-provisioning.md`; it was waiting on configuration.

**3.2 `ENABLE_OCR_PIPELINE` deliberately left `false`.** Turning it on would make the product strictly worse, not better. With it off, a `paper_ocr` capture requires transcribed hours and lands at `extracted` (the `manual_transcription` path from `cr-arkilaunch-pilot-honesty.md`, which is the only way a deduction is currently approvable). With it on, the API *rejects* transcribed hours (`line_items_not_accepted`), queues the row, and the worker's `analyze()` hits the 404 in 2.1 and drives every capture to `hard_failed`. That is not extraction; it is an outage with extra steps.

**3.3 A request-shape regression test** (`packages/document-intelligence/src/azure-adapter.spec.ts`). The adapter's tests asserted response mapping against hand-written payloads and had never run against a real endpoint. The new test pins the outgoing request to the shape the live resource accepted: `prebuilt-layout:analyze` with `features=queryFields` and `queryFields=SecNumber,Tin`, bytes as `base64Source` in a JSON body, and asserts a custom model id carries neither parameter. Azure rejects `queryFields` without the accompanying `features` flag, so that pairing is load-bearing and was previously unguarded.

## 4. What is required before EDTR extraction can be enabled

Not a code task. In order:

1. **A labeled training corpus** of real Almara EDTR sheets. `docs/runbook-ocr-fixtures.md` and `pnpm ocr:fixtures:pull` are the registered path for assembling it; QAD §2 sets the corpus floor and requires clean, smudged, low-light and forged samples. A neural custom model needs at least five labeled documents and realistically far more to survive the handwriting variance RFC-2 §8 names.
2. **A training run** producing `arkilaunch-edtr-neural-v1` on the resource.
3. **Re-derive `EDTR_REQUIRED_FIELDS`** from the trained model's actual output keys. `model-registry.ts` says plainly that `hours_active` / `hours_idle` are a guess that the training run turns into fact, and that they must be corrected before the pipeline is enabled anywhere real. A mismatch here means every extraction hard-fails on a missing required field.
4. **Then** `ENABLE_OCR_PIPELINE=true`, and only against the golden-set accuracy gate (OPS SLO-13, >= 90.06%), which `ocr-accuracy-gate` currently cannot assert (`cr-arkilaunch-m4-money-path-gates.md`).

## 5. Compliance position, unchanged and still open

This pass does not resolve and does not claim to resolve any AIA or CLR item.

- **AIA-R7 (cross-border transfer to Azure DI) remains Open and escalated.** §4 of the AIA pauses the KYC launch and any production launch until counsel confirms the RA 10173 basis and the CLR gate clears. Enabling the flag in one developer's local `.env` for a verification run is not a launch, and nothing here changes a deployed environment. The resource is in `southeastasia` (Singapore), so a PH-origin document still leaves the country: this is exactly the transfer AIA-R7 is about, and running it locally does not make it lawful. **The synthetic test document contained no real personal data.**
- **AIA-R1/R3/R5** were recorded as "not exercised" because extraction had never run. For KYC that is no longer true, and the AIA status note is corrected accordingly. R5 (handwriting accuracy variance) still concerns the EDTR path, which remains unexercised.
- **CLR E1 (cross-border basis), E2 (DPO), E4 (KYC/ID image retention and disposal), E11 (PIA/DPIA)** are all still open and all still block a real KYC launch.

## 6. Recorded, not fixed

1. **The adapter has still never been exercised end to end through the API.** The live verification in §2 was a direct call to Azure plus a unit test pinning the request shape. Restarting the local API to drive a real `POST /kyc/extract` was blocked by a tool permission in this session, so the full path (Storage signed URL -> download -> analyze -> `needs_review` row -> `ocr_field_confidence` event) is **not** claimed as verified. It is the first thing to run next.
2. **F0 is rate limited** (roughly 20 calls/minute, 500/month) and exists as a spend ceiling. It is fine for verification and will not support a pilot.
3. **The KYC confidence gate is untested against real documents.** 0.995 on a synthetic, machine-generated PDF says nothing about a photographed SEC certificate under a tin roof.
4. **No golden-set accuracy number is claimed** for either flow.

## 7. Pre-merge gate runs

| Gate | Verdict |
|---|---|
| `ai-ocr-abuse-runner` | *pending* |
| `restraint-guardian` | *pending* |

`tenant-isolation-checker`, `migration-rls-guardian` and `edtr-ocr-worker` are not triggered: this pass changes one test file and local configuration, with no schema, query, worker or request-path code touched.
