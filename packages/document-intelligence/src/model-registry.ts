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

// The logical model id the EDTR worker analyzes against. Held here rather
// than in jobs/ so the id and the fields it is expected to return are stated
// in one place; the worker imports both.
//
// NOTE: this model has NOT been trained yet. Until a training run over
// labeled Almara sheets exists, Azure answers :analyze with a 404, which
// azure-adapter.ts surfaces as a hard DocumentAnalysisError -- never a silent
// empty result. Recorded in docs/cr-arkilaunch-pilot-honesty.md §4.
export const EDTR_MODEL_ID = 'arkilaunch-edtr-neural-v1';

export const KYC_MODEL_ID = 'arkilaunch-kyc-layout-query';

// The fields reconciliation cannot proceed without. A document missing any of
// them hard-fails to manual entry rather than being written with a
// substituted zero -- a field the model did not return is not a reading of
// zero hours, and the deduction gate has no way to tell the difference once
// it is persisted (RFC-2 §2).
//
// THESE NAMES ARE NOT YET CONFIRMED AGAINST A TRAINED MODEL. They are the
// names the schema is expected to use; the training run is what makes them
// fact. Re-derive them from the trained model's own output (the field keys in
// its analyze response) and correct this list before the pipeline is enabled
// anywhere real. Keeping the guess in one named constant is the point: there
// is exactly one line to change, not two call sites to find.
export const EDTR_REQUIRED_FIELDS = ['hours_active', 'hours_idle'] as const;

export type EdtrRequiredField = (typeof EDTR_REQUIRED_FIELDS)[number];

export function resolveModelRequest(modelId: string): ModelRequest {
  if (modelId === KYC_MODEL_ID) {
    return { kind: 'query-fields', modelId: 'prebuilt-layout', queryFields: KYC_QUERY_FIELDS };
  }
  // arkilaunch-edtr-neural-v1 and any other id: pass through as a real
  // custom model id. If it hasn't been trained yet, Azure DI's own 404
  // surfaces as a hard failure in azure-adapter.ts -- never a silent empty
  // result.
  return { kind: 'model', modelId };
}

// The inverse of the queryFields camelCase mapping above, so callers keep
// seeing the same snake_case keys the port contract already promised
// (packages/shared/src/document-intelligence-port.ts).
export const QUERY_FIELD_TO_PORT_KEY: Record<string, string> = {
  SecNumber: 'sec_number',
  Tin: 'tin',
};
