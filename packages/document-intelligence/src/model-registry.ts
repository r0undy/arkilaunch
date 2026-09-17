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

// EDTR extraction is prebuilt-layout's TABLE output, not queryFields and
// not a custom neural model.
//
// Measured against the live resource with a replica of the real Almara form
// (docs/cr-arkilaunch-edtr-real-form.md): layout returned the 22x9 timesheet
// grid exactly, while queryFields asked for the same sheet's Operator
// answered "ALMARA CONSTRUCTION CORPORATION" at 0.883 -- confidently wrong,
// having read the letterhead. queryFields answers per-document scalars; this
// sheet's payload is a table of dated rows, so layout is the right tool and
// queryFields is an actively misleading one here.
//
// Training a custom neural model would need >= 200 labeled Almara pages with
// bounding boxes drawn in DI Studio and an S0 resource (F0 cannot train
// custom neural models); none of those exist, and layout needs none of them.
export const EDTR_MODEL_ID = 'arkilaunch-edtr-layout-table';

export const KYC_MODEL_ID = 'arkilaunch-kyc-layout-query';

// EDTR_REQUIRED_FIELDS is gone. It named hours_active and hours_idle as the
// document-level fields reconciliation keys on, and the real form has
// neither: it records AM/PM/OVERTIME in-out pairs and a written TOTAL HOURS
// per dated row, and no idle column at all. What a readable sheet must
// contain now lives in parseEdtrSheet()
// (packages/shared/src/edtr-sheet.ts), which refuses the whole capture
// naming the day it could not read.

export function resolveModelRequest(modelId: string): ModelRequest {
  if (modelId === KYC_MODEL_ID) {
    return { kind: 'query-fields', modelId: 'prebuilt-layout', queryFields: KYC_QUERY_FIELDS };
  }
  if (modelId === EDTR_MODEL_ID) {
    // No queryFields: the timesheet grid comes back in analyzeResult.tables
    // for a plain layout call, and asking for query fields on top would add
    // a premium feature that answers the wrong question.
    return { kind: 'model', modelId: 'prebuilt-layout' };
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
export const QUERY_FIELD_TO_PORT_KEY: Record<string, string> = {
  SecNumber: 'sec_number',
  Tin: 'tin',
};
