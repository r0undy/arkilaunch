// Moved here (from apps/api/src/ports) so both the API and the ACA Jobs
// package (RFC-2 RFC2-02 edtr-ocr-worker) can share one port contract,
// instead of the jobs package reaching into apps/api's internals across a
// workspace boundary.
//
// Test doubles deliberately do NOT live in this file. They are in
// `@arkilaunch/shared/testing`, which production code is forbidden from
// importing (see eslint.config.js). Before
// cr-arkilaunch-pilot-honesty.md a fixture returning a literal
// `sec_number: 'CS202312345'` at 0.95 confidence was bound unconditionally
// in apps/api/src/kyc/kyc.module.ts -- in every environment, including a
// production one.
export interface ExtractedField {
  value: string;
  confidence: number;
}

// Where on the page this reading came from, as a four-point polygon
// [x1,y1,...,x4,y4] with every coordinate normalised to 0..1 of the page's
// own width and height.
//
// Normalised at the adapter on purpose: Azure reports polygons in the
// page's `unit`, which is inches for a PDF and pixels for an image. A
// consumer that drew raw coordinates would silently be right for one input
// type and wrong for the other, and the reviewer would never know which.
export interface BoundingRegion {
  page: number;
  polygon: number[];
}

// A cell of a table prebuilt-layout found on the page, as a plain grid:
// a merged cell is expanded into every position it covers, so consumers
// index by (rowIndex, columnIndex) without reasoning about spans.
//
// Expanding is safe because Azure reports an explicit rowIndex and
// columnIndex for every cell -- nothing is positional, so duplicating a
// span's content across its own covered cells cannot shift a neighbour.
// The real Almara header depends on this: "AM" spans two columns above its
// IN/OUT pair and "DATE" spans both header rows, so dropping spanning cells
// deleted the header outright and the sheet parsed as no table at all.
export interface ExtractedTableCell {
  rowIndex: number;
  columnIndex: number;
  content: string;
  // prebuilt-layout reports no confidence on a table cell, but it does
  // report one per recognised word. This is the lowest confidence among
  // the words that make up this cell, so the 0.90 gate keeps grading real
  // OCR certainty rather than a number we picked. A non-empty cell whose
  // words cannot be located floors to 0 -- below the gate, so it routes to
  // a human -- exactly as a missing field confidence does.
  confidence: number;
  // Absent when the response carried no polygon, or when the page it
  // belongs to reported no dimensions to normalise against. The review
  // overlay simply draws no box; it never guesses a position.
  boundingRegion?: BoundingRegion;
}

export interface ExtractedTable {
  rowCount: number;
  columnCount: number;
  cells: ExtractedTableCell[];
}

export interface DocumentExtractionResult {
  fields: Record<string, ExtractedField>;
  // Optional so every existing caller (KYC, and the fixture adapters) is
  // unaffected: they ask a document for scalar fields and get exactly what
  // they got before. The EDTR path needs the grid instead, because the real
  // Almara sheet is a 22-row timesheet and not a set of document-level
  // fields -- see docs/cr-arkilaunch-edtr-real-form.md.
  tables?: ExtractedTable[];
}

// Azure AI Document Intelligence is extraction only -- it never decides,
// activates a tenant, or moves money (RFC-2 §5, AGENTS.md golden path).
export interface DocumentIntelligencePort {
  analyze(modelId: string, imageStream: Buffer): Promise<DocumentExtractionResult>;
}

export type ExtractionUnavailableReason =
  // Credentials are absent from the environment.
  | 'no_credentials'
  // Credentials are present but no real adapter is implemented yet.
  | 'no_adapter'
  // An operator turned the pipeline off.
  | 'flag_disabled';

export class ExtractionUnavailableError extends Error {
  readonly reason: ExtractionUnavailableReason;

  constructor(reason: ExtractionUnavailableReason) {
    super(`document extraction is unavailable (${reason})`);
    this.name = 'ExtractionUnavailableError';
    this.reason = reason;
  }
}

export type DocumentIntelligenceAvailability =
  | { available: true }
  | { available: false; reason: ExtractionUnavailableReason };

// Takes the environment as an argument rather than reading process.env, so
// packages/shared stays importable from the browser bundle. Callers in
// apps/api and jobs pass process.env.
//
// `hasAdapter` defaults to false so any caller that forgets to pass it gets
// the old fail-closed answer, not a silent upgrade to available:true. The
// real Azure DI network client lives in @arkilaunch/document-intelligence
// (not here -- this package stays browser-safe, dependency-light); its
// factory is the only caller allowed to pass hasAdapter: true, and only
// once it has actually constructed a real adapter
// (docs/cr-arkilaunch-azure-di-provisioning.md). Before that CR, this could
// never return { available: true } for any environment -- see
// document-intelligence-port.spec.ts for the conformance suite the real
// adapter must satisfy.
export function documentIntelligenceAvailability(
  env: Record<string, string | undefined>,
  hasAdapter = false,
): DocumentIntelligenceAvailability {
  if (!env.AZURE_DI_ENDPOINT || !env.AZURE_DI_KEY) {
    return { available: false, reason: 'no_credentials' };
  }
  if (!hasAdapter) {
    return { available: false, reason: 'no_adapter' };
  }
  return { available: true };
}

// The honest failure mode. This replaces the former
// StubDocumentIntelligenceAdapter, which returned `{ fields: {} }` -- an
// empty result is indistinguishable from "the sheet really was blank",
// which is a lie the reconciliation engine cannot detect. Throwing forces
// every caller to make a deliberate decision about the unavailable case.
export class UnavailableDocumentIntelligenceAdapter implements DocumentIntelligencePort {
  constructor(private readonly reason: ExtractionUnavailableReason = 'no_adapter') {}

  async analyze(_modelId: string, _imageStream: Buffer): Promise<DocumentExtractionResult> {
    throw new ExtractionUnavailableError(this.reason);
  }
}
