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

export function resolveModelRequest(modelId: string): ModelRequest {
  if (modelId === 'arkilaunch-kyc-layout-query') {
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
