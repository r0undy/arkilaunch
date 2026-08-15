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

export interface DocumentExtractionResult {
  fields: Record<string, ExtractedField>;
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
// This can never return { available: true } today, and that is the point:
// no real Azure DI adapter exists, so there is no configuration -- however
// many keys are set -- that can make the system believe it can extract.
// A wrong answer here would be a fabricated value reaching a KYC reviewer.
export function documentIntelligenceAvailability(
  env: Record<string, string | undefined>,
): DocumentIntelligenceAvailability {
  if (!env.AZURE_DI_ENDPOINT || !env.AZURE_DI_KEY) {
    return { available: false, reason: 'no_credentials' };
  }
  // Credentials are configured, but the real network client is deliberately
  // not built yet (cr-arkilaunch-pilot-honesty.md §8): writing the async
  // 202 + Operation-Location polling loop blind, against an API version
  // that will move before a key arrives, is speculative code. When it
  // lands, it must first satisfy document-intelligence-port.spec.ts.
  return { available: false, reason: 'no_adapter' };
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
