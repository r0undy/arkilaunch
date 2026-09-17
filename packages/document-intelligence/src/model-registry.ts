// The DocumentIntelligencePort signature (analyze(modelId, buffer)) cannot
// express "prebuilt-layout plus queryFields plus which field names" -- that
// shape lives here instead of widening the Locked port contract. Logical
// model ids are exactly the strings already hardcoded at the call sites
// (jobs/src/edtr-ocr-worker.ts's EDTR_MODEL_ID, apps/api/src/kyc/kyc.service.ts's
// KYC_MODEL_ID); this registry is the only place that knows what each one
// really is.
export type ModelRequest =
  | { kind: 'model'; modelId: string }
  | { kind: 'query-fields'; modelId: string; queryFields: string[] };

// PH SEC/TIN corporate documents are not covered by prebuilt-idDocument
// (docs/build-arkilaunch.md:104), so KYC extraction is prebuilt-layout plus
// the premium queryFields add-on rather than a trained custom model.
// queryFields recommends camelCase/PascalCase names (max 20 per request);
// the mapping back to this repo's snake_case field keys happens in
// azure-adapter.ts, not here.
const KYC_QUERY_FIELDS = ['SecNumber', 'Tin'];

// EDTR extraction takes the same prebuilt-layout + queryFields route as KYC
// above, rather than the custom neural model the earlier design assumed.
// Training arkilaunch-edtr-neural-v1 needs >= 200 labeled Almara pages with
// bounding boxes drawn in DI Studio and an S0 resource (F0 cannot train
// custom neural models); none of those exist. queryFields needs none of it
// and works against the resource that is already provisioned.
//
// The trade is accuracy, and it is NOT yet measured against the RFC-2
// 90.06% gate -- see docs/cr-arkilaunch-edtr-query-fields.md. What makes
// this safe to ship unmeasured is that every downstream guard is unchanged:
// a field queryFields does not return is a missing field, which hard-fails
// to manual entry rather than becoming a zero; a null confidence floors to
// 0 in azure-adapter.ts, which is below CONFIDENCE_GATE and so routes to
// human review; and the double-entry reconciliation against the second
// independent log is what actually gates the deduction. A weaker extractor
// produces more review, never a wrong deduction.
const EDTR_QUERY_FIELDS = ['HoursActive', 'HoursIdle'];

// The logical model id the EDTR worker analyzes against, and what lands in
// ocr_payload.model_id as provenance. Named for what it actually is: the
// old 'arkilaunch-edtr-neural-v1' would now be a lie in a provenance field,
// claiming a trained neural model read the sheet when prebuilt-layout did.
export const EDTR_MODEL_ID = 'arkilaunch-edtr-layout-query';

export const KYC_MODEL_ID = 'arkilaunch-kyc-layout-query';

// The fields reconciliation cannot proceed without. A document missing any of
// them hard-fails to manual entry rather than being written with a
// substituted zero -- a field the model did not return is not a reading of
// zero hours, and the deduction gate has no way to tell the difference once
// it is persisted (RFC-2 §2).
//
// These are no longer a guess about a model that does not exist: with
// queryFields WE choose the field names, and QUERY_FIELD_TO_PORT_KEY below
// maps Azure's PascalCase answers back onto exactly these keys. What is
// still unconfirmed is whether a real Almara sheet's layout lets
// prebuilt-layout find them at all -- that is an accuracy question the
// golden-set harness answers, not a naming one.
export const EDTR_REQUIRED_FIELDS = ['hours_active', 'hours_idle'] as const;

export type EdtrRequiredField = (typeof EDTR_REQUIRED_FIELDS)[number];

export function resolveModelRequest(modelId: string): ModelRequest {
  if (modelId === KYC_MODEL_ID) {
    return { kind: 'query-fields', modelId: 'prebuilt-layout', queryFields: KYC_QUERY_FIELDS };
  }
  if (modelId === EDTR_MODEL_ID) {
    return { kind: 'query-fields', modelId: 'prebuilt-layout', queryFields: EDTR_QUERY_FIELDS };
  }
  // Any other id: pass through as a real custom model id. If it hasn't been
  // trained yet, Azure DI's own 404 surfaces as a hard failure in
  // azure-adapter.ts -- never a silent empty result. This is the branch a
  // future trained arkilaunch-edtr-neural-v1 takes; swapping EDTR_MODEL_ID
  // to that string is the whole migration.
  return { kind: 'model', modelId };
}

// The inverse of the queryFields camelCase mapping above, so callers keep
// seeing the same snake_case keys the port contract already promised
// (packages/shared/src/document-intelligence-port.ts).
// One map across both models: the key spaces do not overlap, and a second
// per-model map would be two places to forget a field in.
export const QUERY_FIELD_TO_PORT_KEY: Record<string, string> = {
  SecNumber: 'sec_number',
  Tin: 'tin',
  HoursActive: 'hours_active',
  HoursIdle: 'hours_idle',
};
