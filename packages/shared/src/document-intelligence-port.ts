// Moved here (from apps/api/src/ports) so both the API and the ACA Jobs
// package (RFC-2 RFC2-02 edtr-ocr-worker) can share one port contract and
// one stub adapter, instead of the jobs package reaching into apps/api's
// internals across a workspace boundary.
export interface ExtractedField {
  value: string;
  confidence: number;
}

export interface DocumentExtractionResult {
  fields: Record<string, ExtractedField>;
}

// Azure AI Document Intelligence is extraction only -- it never decides,
// activates a tenant, or moves money (RFC-2 §5, AGENTS.md golden path).
// Real Azure DI adapter is a follow-up once live Azure DI credentials and a
// trained custom model exist; this interface lets the reconciliation gate
// and abuse tests run fully offline until then.
export interface DocumentIntelligencePort {
  analyze(modelId: string, imageStream: Buffer): Promise<DocumentExtractionResult>;
}

export class StubDocumentIntelligenceAdapter implements DocumentIntelligencePort {
  async analyze(): Promise<DocumentExtractionResult> {
    return { fields: {} };
  }
}

// Test/dev-only adapter: returns a fixed, injectable extraction result so
// the worker's claim/lock/reconcile/gate logic can be exercised end to end
// without a live Azure DI resource (RFC-2 §2/§5).
export class FixtureDocumentIntelligenceAdapter implements DocumentIntelligencePort {
  constructor(private readonly fixture: DocumentExtractionResult) {}

  async analyze(): Promise<DocumentExtractionResult> {
    return this.fixture;
  }
}
