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
import { createDocumentIntelligenceAdapter as createAzureAdapter } from '@arkilaunch/document-intelligence';

// True only when an operator has asked for the OCR pipeline AND a real
// adapter can actually serve it.
export function isOcrPipelineEnabled(): boolean {
  return process.env.ENABLE_OCR_PIPELINE === 'true';
}

export function isOcrKycEnabled(): boolean {
  return process.env.ENABLE_OCR_KYC === 'true';
}

// Fail closed at construction: an OCR flag on with no usable adapter stops
// Nest booting rather than accepting uploads it cannot extract (RFC-2 §7).
export function createDocumentIntelligenceAdapter(): DocumentIntelligencePort {
  const availability = documentIntelligenceAvailability(process.env);
  const requested = isOcrPipelineEnabled() || isOcrKycEnabled();

  if (requested && !availability.available) {
    throw new ExtractionUnavailableError(availability.reason);
  }
  if (!availability.available) {
    return new UnavailableDocumentIntelligenceAdapter(availability.reason);
  }
  if (!requested) {
    return new UnavailableDocumentIntelligenceAdapter('flag_disabled');
  }
  return createAzureAdapter(process.env);
}
