# Runbook: collecting OCR fixtures and training the EDTR model

> **Status:** Draft. Operational procedure, not a Locked suite doc. Supports
> RFC-002 (Locked) §2/§5 and QAD-T39; changes nothing those docs decide.

The EDTR OCR path is fully built and fails closed, but has never analyzed a
real document. `arkilaunch-edtr-neural-v1` is a model id that does not exist
yet, and the field names reconciliation keys on (`hours_active`,
`hours_idle`) are an expectation, not a measured fact. This runbook is how
both become real.

Nothing here may be shortcut to make a gate green. If the corpus is thin or
the model is inaccurate, the honest outcome is a recorded number and the
pipeline left off — not a lowered threshold.

## 0. Before you start

- An Azure AI Document Intelligence resource. Note its tier: **F0 reads only
  the first 2 pages of a document.** Set `AZURE_DI_MAX_PAGES=2` for an F0
  resource so `azure-adapter.ts` hard-fails on a longer document instead of
  returning a result computed from a truncated one, which would be
  indistinguishable from a genuine short-document extraction.
- Real Almara EDTR sheets and KYC documents. QAD §2 asks for **≥ 200 EDTR
  pages** and **≥ 50 KYC documents**. Below that the measurement is about a
  handful of pages, not about the model.

## 1. Stage the documents

```
.ocr-fixtures/            # gitignored; real scans never enter the repo
  edtr/
    2026-03-01-crane-07.jpg
    2026-03-01-crane-07.labels.json
    ...
  kyc/
    almara-sec.pdf
    almara-sec.labels.json
```

Each `<name>.labels.json` holds **ground truth only** — what a human reads off
the page:

```json
{ "fields": { "hours_active": 8.0, "hours_idle": 1.5 } }
```

Field keys are the snake_case names the port contract promises. A document
with no sibling labels file aborts the whole run: an unlabeled page is not a
zero-field page, and silently training on a smaller corpus than you believe
you supplied is exactly the failure this refuses.

## 2. Emit the field schema

```sh
pnpm ocr:fixtures:pull --mode=training --staging=.ocr-fixtures
```

Writes `fields.json` and a `manifest.json` per kind, and prints the field keys
found across the corpus. **Read that list** — it is your first check that the
labelers used consistent names.

This deliberately does not emit trainable `.labels.json` files. Azure's
per-field `boundingBoxes` come from drawing on the page in Document
Intelligence Studio and cannot be derived from a value. Synthesizing them
would train a model on fabricated regions.

## 3. Label and train in DI Studio

Build a **custom neural** model from the staged documents, using the emitted
`fields.json` as the schema. Keep the model id `arkilaunch-edtr-neural-v1`.
If you retrain with a changed schema, bump to `-v2` rather than mutating a
deployed id — a silently changed model behind a stable id is untraceable
later.

## 4. Reconcile the field names with the code

Once trained, check the field keys in the model's own analyze response
against `EDTR_REQUIRED_FIELDS` in
`packages/document-intelligence/src/model-registry.ts`. **This is the step
that turns the guess into a fact.** If they differ, correct the constant —
it is the single place both the worker's validation and its line-item write
read from.

## 5. Extract, then build the golden set

```sh
AZURE_DI_ENDPOINT=... AZURE_DI_KEY=... \
  pnpm ocr:fixtures:pull --mode=extract --model=arkilaunch-edtr-neural-v1

pnpm ocr:fixtures:pull --mode=golden
```

`--mode=golden` regenerates `packages/db/src/seed/ocr-fixtures/golden-set.ts`,
pairing ground truth with what the model actually returned. It refuses to
write below the QAD §2 floor unless you pass `--partial`, and stamps the
sample count, the floor, and a `PARTIAL` marker into the file header so a thin
corpus can never be mistaken for one that measures QAD-T39.

SEC/TIN-class values are replaced by a hash-derived surrogate on **both** sides
of the comparison. Exact-match accuracy is bit-identical to the unredacted
corpus, and no real SEC or TIN number is ever committed (RA 10173). A spec in
`jobs/src/ocr-fixtures-pull.spec.ts` asserts that equivalence.

## 6. Read the measurement

```sh
pnpm --filter @arkilaunch/api test -- accuracy-harness
```

Above the floor, the 90.06% gate binds. Below it, the harness records an
**absent measurement** — which is not the same claim as a failing model, and
the two must not be reported interchangeably.

If the real number falls short: collect more fixtures, or retrain, or leave
the OCR path off for the pilot with manual entry as the route. All three are
acceptable. Lowering `OCR_ACCURACY_THRESHOLD` is not.

## 7. The confidence question — answer it explicitly

`azure-adapter.ts` floors a missing or malformed per-field confidence to **0**,
never 1, so an unscored field routes to human review rather than sailing
through the auto-accept gate.

It is **not established** that Azure returns a per-field confidence for these
documents — for the KYC `queryFields` path this is flagged as unverified in
`cr-arkilaunch-pilot-honesty.md` §4. On the first real run, check whether
confidences come back at all.

If they do not, every field routes to review and the 0.90 gate is inert. That
is a change to the pilot's operating assumption about how much human effort
the OCR path saves. **Record it; do not work around it.**

## 8. Enabling the pipeline

`ENABLE_OCR_PIPELINE` is off by default and should stay off in production
until steps 4, 6 and 7 are all answered. The worker checks the flag before the
availability probe precisely so that arriving credentials never silently start
a cron calling Azure on every run.

Before any merge on this path, run the `ai-ocr-abuse-runner` (AI-01..AI-06)
and `restraint-guardian` subagents, plus `migration-rls-guardian` on any schema
diff.
