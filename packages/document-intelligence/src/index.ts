import {
  documentIntelligenceAvailability,
  UnavailableDocumentIntelligenceAdapter,
  type DocumentIntelligencePort,
} from '@arkilaunch/shared';
import { AzureDocumentIntelligenceAdapter } from './azure-adapter.js';

export {
  AzureDocumentIntelligenceAdapter,
  DocumentAnalysisError,
  type AzureDocumentIntelligenceAdapterOptions,
} from './azure-adapter.js';
export {
  EDTR_MODEL_ID,
  KYC_MODEL_ID,
  NATIONAL_ID_MODEL_ID,
  resolveModelRequest,
  type ModelRequest,
} from './model-registry.js';

// Fail-closed factory: no AZURE_DI_* credentials means an adapter that throws on analyze.
// Feature flags are the caller's gate.
export function createDocumentIntelligenceAdapter(
  env: Record<string, string | undefined> = process.env,
): DocumentIntelligencePort {
  const availability = documentIntelligenceAvailability(env);
  if (!availability.available) return new UnavailableDocumentIntelligenceAdapter(availability.reason);
  return new AzureDocumentIntelligenceAdapter({
    endpoint: env.AZURE_DI_ENDPOINT!,
    apiKey: env.AZURE_DI_KEY!,
    ...(env.AZURE_DI_MAX_PAGES ? { maxPagesPerDocument: Number(env.AZURE_DI_MAX_PAGES) } : {}),
  });
}
