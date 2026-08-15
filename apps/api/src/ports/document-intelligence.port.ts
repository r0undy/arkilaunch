// Canonical port contract lives in
// packages/shared/src/document-intelligence-port.ts so the ACA Jobs package
// (RFC2-02 edtr-ocr-worker) can share it without reaching into apps/api's
// internals. The adapter FACTORY lives here, beside the environment it
// reads -- the same split payments.port.ts already uses for PayMongo.
//
// Note this file no longer re-exports the fixture adapters. Re-exporting a
// test double from a production module is what made it easy for
// kyc.module.ts to bind one in every environment.
import {
  documentIntelligenceAvailability,
  ExtractionUnavailableError,
  UnavailableDocumentIntelligenceAdapter,
  type DocumentIntelligencePort,
} from '@arkilaunch/shared';

export {
  type DocumentExtractionResult,
  type DocumentIntelligencePort,
  type ExtractedField,
  type DocumentIntelligenceAvailability,
  type ExtractionUnavailableReason,
  ExtractionUnavailableError,
  UnavailableDocumentIntelligenceAdapter,
  documentIntelligenceAvailability,
} from '@arkilaunch/shared';

// True only when an operator has asked for the OCR pipeline AND a real
// adapter can actually serve it.
export function isOcrPipelineEnabled(): boolean {
  return process.env.ENABLE_OCR_PIPELINE === 'true';
}

export function isOcrKycEnabled(): boolean {
  return process.env.ENABLE_OCR_KYC === 'true';
}

// Fail closed at construction. If an operator turns the OCR pipeline on
// while no real adapter can serve it, Nest fails to boot and the container
// never accepts traffic -- rather than accepting paper uploads it has
// nothing to extract with, or silently degrading to a value that looks
// real. RFC-2 §7 specifies these flags; this is where they become true.
export function createDocumentIntelligenceAdapter(): DocumentIntelligencePort {
  const availability = documentIntelligenceAvailability(process.env);
  const requested = isOcrPipelineEnabled() || isOcrKycEnabled();

  if (requested && !availability.available) {
    throw new ExtractionUnavailableError(availability.reason);
  }
  if (!availability.available) {
    return new UnavailableDocumentIntelligenceAdapter(availability.reason);
  }
  // Unreachable today: documentIntelligenceAvailability() cannot return
  // available:true until a real Azure DI adapter is implemented. Kept as
  // the explicit seam so landing that adapter is a one-line change here.
  return new UnavailableDocumentIntelligenceAdapter('no_adapter');
}
