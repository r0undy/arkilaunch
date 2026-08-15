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
import { AzureDocumentIntelligenceAdapter } from '@arkilaunch/document-intelligence';

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
//
// hasAdapter: true asserts that AzureDocumentIntelligenceAdapter really is
// constructed below -- this is the only caller allowed to make that
// assertion (docs/cr-arkilaunch-azure-di-provisioning.md).
export function createDocumentIntelligenceAdapter(): DocumentIntelligencePort {
  const availability = documentIntelligenceAvailability(process.env, true);
  const requested = isOcrPipelineEnabled() || isOcrKycEnabled();

  if (requested && !availability.available) {
    throw new ExtractionUnavailableError(availability.reason);
  }
  if (!availability.available) {
    return new UnavailableDocumentIntelligenceAdapter(availability.reason);
  }
  if (!requested) {
    // Credentials exist in every environment now (Terraform always creates
    // the DI resource), so availability alone no longer implies extraction
    // should happen -- the feature flags are the switch.
    return new UnavailableDocumentIntelligenceAdapter('flag_disabled');
  }

  return new AzureDocumentIntelligenceAdapter({
    endpoint: process.env.AZURE_DI_ENDPOINT!,
    apiKey: process.env.AZURE_DI_KEY!,
    ...(process.env.AZURE_DI_MAX_PAGES ? { maxPagesPerDocument: Number(process.env.AZURE_DI_MAX_PAGES) } : {}),
  });
}
