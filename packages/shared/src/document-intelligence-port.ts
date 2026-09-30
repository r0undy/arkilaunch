// Test doubles live in @arkilaunch/shared/testing, which production code may not import (eslint.config.js).
export interface ExtractedField {
  value: string;
  confidence: number;
}

// Normalised to 0..1 of the page at the adapter: Azure reports inches for PDFs, pixels for images.
export interface BoundingRegion {
  page: number;
  polygon: number[];
}

// Merged cells are expanded into every covered position (safe: Azure gives explicit indices);
// the Almara header's spanning AM/DATE cells depend on it.
export interface ExtractedTableCell {
  rowIndex: number;
  columnIndex: number;
  content: string;
  // Lowest word confidence in the cell; unlocatable words floor to 0 so the 0.90 gate routes to a human.
  confidence: number;
  boundingRegion?: BoundingRegion;
}

export interface ExtractedTable {
  rowCount: number;
  columnCount: number;
  cells: ExtractedTableCell[];
}

export interface DocumentTextWord {
  offset: number;
  length: number;
  // Floored to 0 when absent or out of range, never defaulted to 1.
  confidence: number;
}

export interface DocumentTextLine {
  offset: number;
  length: number;
  page: number;
  // [x1,y1,...,x4,y4] in 0..1 of the page, like BoundingRegion.
  polygon: number[];
}

// In-memory only, never persisted: a whole certificate or ID is more than any field we keep.
export interface DocumentText {
  content: string;
  words: DocumentTextWord[];
  lines: DocumentTextLine[];
}

// Lowest confidence among the words overlapping [start, end) of content.
export function spanConfidence(words: DocumentTextWord[], start: number, end: number): number {
  let min = Number.POSITIVE_INFINITY;
  for (const w of words) {
    if (w.offset < end && w.offset + w.length > start) min = Math.min(min, w.confidence);
  }
  return Number.isFinite(min) ? min : 0;
}

export interface DocumentExtractionResult {
  fields: Record<string, ExtractedField>;
  tables?: ExtractedTable[];
  text?: DocumentText;
}

// Extraction only: never decides, activates a tenant, or moves money (RFC-2).
export interface DocumentIntelligencePort {
  analyze(modelId: string, imageStream: Buffer): Promise<DocumentExtractionResult>;
}

export type ExtractionUnavailableReason =
  | 'no_credentials'
  | 'no_adapter'
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

// Env as an argument so packages/shared stays browser-importable.
export function documentIntelligenceAvailability(
  env: Record<string, string | undefined>,
): DocumentIntelligenceAvailability {
  if (!env.AZURE_DI_ENDPOINT || !env.AZURE_DI_KEY) {
    return { available: false, reason: 'no_credentials' };
  }
  return { available: true };
}

// Throws rather than returning empty fields, which reconciliation could not tell from a blank sheet.
export class UnavailableDocumentIntelligenceAdapter implements DocumentIntelligencePort {
  constructor(private readonly reason: ExtractionUnavailableReason = 'no_adapter') {}

  async analyze(_modelId: string, _imageStream: Buffer): Promise<DocumentExtractionResult> {
    throw new ExtractionUnavailableError(this.reason);
  }
}
