import {
  ExtractionUnavailableError,
  type DocumentExtractionResult,
  type DocumentIntelligencePort,
  type ExtractedField,
} from '@arkilaunch/shared';
import { QUERY_FIELD_TO_PORT_KEY, resolveModelRequest, type ModelRequest } from './model-registry.js';

// Native fetch, not an Azure SDK -- same "native fetch over a client SDK"
// precedent as apps/api/src/storage/storage.service.ts and
// apps/api/src/ports/payments.port.ts (AGENTS.md §5 restraint ladder). The
// wire contract is small (one POST, one poll loop) and owning it directly
// avoids a second copy of @opentelemetry/instrumentation-class dependencies
// and a node10-vs-exports-map resolution fight in apps/api's tsconfig.
const API_VERSION = '2024-11-30';
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

// Thrown instead of ExtractionUnavailableError: this is not "the service is
// unreachable", it is "the service answered but the answer cannot be
// trusted" -- a distinct failure the caller must not treat the same way
// (RFC-2 §2, AGENTS.md "never fabricate a value").
export class DocumentAnalysisError extends Error {}

interface AzureAnalyzeField {
  valueString?: string;
  valueNumber?: number;
  valueInteger?: number;
  valueDate?: string;
  valueTime?: string;
  valueBoolean?: boolean;
  valueSelectionMark?: string;
  content?: string;
  confidence?: number;
}

interface AzureAnalyzeOperation {
  status: 'notStarted' | 'running' | 'succeeded' | 'failed';
  error?: { code?: string; message?: string };
  analyzeResult?: {
    pages?: unknown[];
    documents?: Array<{ fields?: Record<string, AzureAnalyzeField> }>;
  };
}

export interface AzureDocumentIntelligenceAdapterOptions {
  endpoint: string;
  apiKey: string;
  // F0 analyzes only the first 2 pages per document and silently returns a
  // complete-looking result computed from the truncated remainder -- the
  // exact class of silent lie cr-arkilaunch-pilot-honesty.md removed
  // elsewhere. Set this to 2 for an F0 resource (dev); leave unset for S0.
  maxPagesPerDocument?: number;
}

export class AzureDocumentIntelligenceAdapter implements DocumentIntelligencePort {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxPagesPerDocument: number | undefined;

  constructor(options: AzureDocumentIntelligenceAdapterOptions) {
    this.baseUrl = options.endpoint.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.maxPagesPerDocument = options.maxPagesPerDocument;
  }

  async analyze(modelId: string, imageStream: Buffer): Promise<DocumentExtractionResult> {
    if (imageStream.length === 0) {
      // Both current callers (jobs/src/edtr-ocr-worker.ts,
      // apps/api/src/kyc/kyc.service.ts) pass Buffer.alloc(0) until their
      // storage-read wiring lands. Failing loudly here beats sending an
      // empty base64Source and getting back a result that reads as "the
      // sheet really was blank".
      throw new DocumentAnalysisError('empty input buffer');
    }

    const request = resolveModelRequest(modelId);
    const operationLocation = await this.startAnalyze(request, imageStream);
    const body = await this.pollUntilDone(operationLocation);

    if (body.status !== 'succeeded' || !body.analyzeResult) {
      throw new DocumentAnalysisError(
        `Azure DI analysis ended in status "${body.status}"${body.error?.code ? ` (${body.error.code})` : ''}`,
      );
    }

    const { analyzeResult } = body;

    if (
      this.maxPagesPerDocument !== undefined &&
      (analyzeResult.pages?.length ?? 0) >= this.maxPagesPerDocument
    ) {
      // The document may have more pages than this tier reads. Hard-fail
      // rather than hand back a result computed from a truncated document --
      // it would look identical to a genuine short-document extraction.
      throw new DocumentAnalysisError(
        `document has >= ${this.maxPagesPerDocument} pages; this Document Intelligence tier only reads the first ${this.maxPagesPerDocument}`,
      );
    }

    return { fields: this.mapFields(request, analyzeResult) };
  }

  private async startAnalyze(request: ModelRequest, imageStream: Buffer): Promise<string> {
    const query = new URLSearchParams({ 'api-version': API_VERSION });
    if (request.kind === 'query-fields') {
      query.set('features', 'queryFields');
      query.set('queryFields', request.queryFields.join(','));
    }

    const res = await fetch(
      `${this.baseUrl}/documentintelligence/documentModels/${request.modelId}:analyze?${query.toString()}`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ base64Source: imageStream.toString('base64') }),
      },
    );

    if (res.status === 401 || res.status === 403) {
      throw new ExtractionUnavailableError('no_credentials');
    }
    if (res.status === 404) {
      // The model does not exist yet (e.g. arkilaunch-edtr-neural-v1 before
      // training) -- a hard failure the caller must surface, not a silent
      // empty result.
      throw new DocumentAnalysisError(`model not found: ${request.modelId}`);
    }
    if (res.status !== 202) {
      const text = await res.text().catch(() => '');
      throw new DocumentAnalysisError(`Azure DI request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const operationLocation = res.headers.get('Operation-Location');
    if (!operationLocation) {
      throw new DocumentAnalysisError('Azure DI accepted the request but returned no Operation-Location');
    }
    return operationLocation;
  }

  private async pollUntilDone(operationLocation: string): Promise<AzureAnalyzeOperation> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    for (;;) {
      const res = await fetch(operationLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': this.apiKey },
      });
      if (!res.ok) {
        throw new DocumentAnalysisError(`Azure DI poll failed (${res.status})`);
      }
      const body = (await res.json()) as AzureAnalyzeOperation;
      if (body.status === 'succeeded' || body.status === 'failed') {
        return body;
      }
      if (Date.now() >= deadline) {
        throw new DocumentAnalysisError('document analysis timed out');
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  private mapFields(
    request: ModelRequest,
    analyzeResult: NonNullable<AzureAnalyzeOperation['analyzeResult']>,
  ): Record<string, ExtractedField> {
    const document = analyzeResult.documents?.[0];
    const rawFields = document?.fields ?? {};
    const fields: Record<string, ExtractedField> = {};

    for (const [rawKey, field] of Object.entries(rawFields)) {
      const key = request.kind === 'query-fields' ? (QUERY_FIELD_TO_PORT_KEY[rawKey] ?? rawKey) : rawKey;
      const value = extractValue(field);
      if (value === null) continue;

      // A missing/null confidence must floor to 0 (routes to human review),
      // never default to 1 (would sail through the 0.90 auto-accept gate).
      // It is not established that queryFields returns a per-field
      // confidence for PH corporate documents at all -- this is the safe
      // assumption until that is confirmed against a real response. An
      // out-of-range value (e.g. a malformed 1.5) also floors to 0, never
      // clamps up to 1.
      const confidence =
        typeof field.confidence === 'number' && Number.isFinite(field.confidence) && field.confidence >= 0 && field.confidence <= 1
          ? field.confidence
          : 0;

      fields[key] = { value, confidence };
    }

    return fields;
  }
}

function extractValue(field: AzureAnalyzeField): string | null {
  if (typeof field.valueString === 'string') return field.valueString;
  if (typeof field.valueNumber === 'number') return String(field.valueNumber);
  if (typeof field.valueInteger === 'number') return String(field.valueInteger);
  if (typeof field.valueDate === 'string') return field.valueDate;
  if (typeof field.valueTime === 'string') return field.valueTime;
  if (typeof field.valueBoolean === 'boolean') return String(field.valueBoolean);
  if (typeof field.valueSelectionMark === 'string') return field.valueSelectionMark;
  if (typeof field.content === 'string') return field.content;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
