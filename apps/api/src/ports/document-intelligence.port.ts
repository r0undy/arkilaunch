// The adapter factory lives here beside the env it reads; it never re-exports fixture adapters.
import {
  documentIntelligenceAvailability,
  ExtractionUnavailableError,
  UnavailableDocumentIntelligenceAdapter,
  type DocumentIntelligencePort,
} from '@arkilaunch/shared';
import { createDocumentIntelligenceAdapter as createAzureAdapter } from '@arkilaunch/document-intelligence';

export function isOcrPipelineEnabled(): boolean {
  return process.env.ENABLE_OCR_PIPELINE === 'true';
}

export function isOcrKycEnabled(): boolean {
  return process.env.ENABLE_OCR_KYC === 'true';
}

// RFC-2 fail closed: an OCR flag on with no usable adapter stops Nest booting.
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
