export interface ExtractedField {
  value: string;
  confidence: number;
}

export interface DocumentExtractionResult {
  fields: Record<string, ExtractedField>;
}

// Azure AI Document Intelligence is extraction only -- it never decides,
// activates a tenant, or moves money (RFC-2 §5, AGENTS.md golden path).
// Real Azure DI adapter lands with RFC2-02; this interface lets the
// reconciliation gate and abuse tests run offline until then.
export interface DocumentIntelligencePort {
  analyze(modelId: string, imageStream: Buffer): Promise<DocumentExtractionResult>;
}

export class StubDocumentIntelligenceAdapter implements DocumentIntelligencePort {
  async analyze(): Promise<DocumentExtractionResult> {
    return { fields: {} };
  }
}
