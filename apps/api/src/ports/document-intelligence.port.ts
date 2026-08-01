// Canonical source moved to packages/shared/src/document-intelligence-port.ts
// so the ACA Jobs package (RFC2-02 edtr-ocr-worker) can share the same port
// contract and stub adapter without reaching into apps/api's internals.
export {
  type DocumentExtractionResult,
  type DocumentIntelligencePort,
  type ExtractedField,
  StubDocumentIntelligenceAdapter,
  FixtureDocumentIntelligenceAdapter,
} from '@arkilaunch/shared';
