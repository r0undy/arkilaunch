import { describe, expect, it } from 'vitest';
import {
  documentIntelligenceAvailability,
  ExtractionUnavailableError,
  UnavailableDocumentIntelligenceAdapter,
  type DocumentExtractionResult,
  type DocumentIntelligencePort,
} from './document-intelligence-port.js';

describe('documentIntelligenceAvailability', () => {
  it('reports no_credentials when the Azure DI environment is unset', () => {
    expect(documentIntelligenceAvailability({})).toEqual({
      available: false,
      reason: 'no_credentials',
    });
  });

  it('reports no_credentials when only one half of the credential pair is set', () => {
    expect(documentIntelligenceAvailability({ AZURE_DI_ENDPOINT: 'https://x' })).toEqual({
      available: false,
      reason: 'no_credentials',
    });
    expect(documentIntelligenceAvailability({ AZURE_DI_KEY: 'k' })).toEqual({
      available: false,
      reason: 'no_credentials',
    });
  });

  it('reports available when both credentials are set', () => {
    const result = documentIntelligenceAvailability({
      AZURE_DI_ENDPOINT: 'https://real.cognitiveservices.azure.com',
      AZURE_DI_KEY: 'a-real-looking-key',
    });
    expect(result).toEqual({ available: true });
  });

  it('does not read process.env (stays safe to import from the browser bundle)', () => {
    // Passing an empty map must not be overridden by ambient process.env.
    const previous = process.env.AZURE_DI_ENDPOINT;
    process.env.AZURE_DI_ENDPOINT = 'https://leaked';
    try {
      expect(documentIntelligenceAvailability({}).available).toBe(false);
      expect(documentIntelligenceAvailability({})).toEqual({
        available: false,
        reason: 'no_credentials',
      });
    } finally {
      if (previous === undefined) delete process.env.AZURE_DI_ENDPOINT;
      else process.env.AZURE_DI_ENDPOINT = previous;
    }
  });
});

describe('UnavailableDocumentIntelligenceAdapter', () => {
  it('throws rather than returning an empty result', async () => {
    const adapter = new UnavailableDocumentIntelligenceAdapter('no_credentials');
    await expect(adapter.analyze('any-model', Buffer.alloc(0))).rejects.toBeInstanceOf(
      ExtractionUnavailableError,
    );
  });

  it('carries the reason so callers can report it without guessing', async () => {
    const adapter = new UnavailableDocumentIntelligenceAdapter('flag_disabled');
    await expect(adapter.analyze('any-model', Buffer.alloc(0))).rejects.toMatchObject({
      reason: 'flag_disabled',
    });
  });
});

// Port conformance suite: every DocumentIntelligencePort adapter must pass it.
export function assertDocumentIntelligenceConformance(
  name: string,
  makeAdapter: () => DocumentIntelligencePort,
  sample: { modelId: string; image: Buffer },
): void {
  describe(`${name}: DocumentIntelligencePort conformance`, () => {
    it('never returns a field without a numeric confidence', async () => {
      const result = await makeAdapter().analyze(sample.modelId, sample.image);
      for (const [fieldName, field] of Object.entries(result.fields)) {
        expect(typeof field.confidence, `${fieldName}: confidence must be a number`).toBe('number');
        expect(Number.isFinite(field.confidence), `${fieldName}: confidence must be finite`).toBe(
          true,
        );
      }
    });

    // A missing field confidence must floor to 0 (human review), never 1 (auto-accept past the 0.90 gate).
    it('maps a missing or null confidence to 0, never to 1', async () => {
      const result = await makeAdapter().analyze(sample.modelId, sample.image);
      for (const [fieldName, field] of Object.entries(result.fields)) {
        expect(field.confidence, `${fieldName}: confidence out of range`).toBeGreaterThanOrEqual(0);
        expect(field.confidence, `${fieldName}: confidence out of range`).toBeLessThanOrEqual(1);
      }
    });

    it('returns string values (numeric parsing belongs to the caller)', async () => {
      const result = await makeAdapter().analyze(sample.modelId, sample.image);
      for (const [fieldName, field] of Object.entries(result.fields)) {
        expect(typeof field.value, `${fieldName}: value must be a string`).toBe('string');
      }
    });
  });
}

// Self-check: the conformance suite must actually reject a
// specification-violating adapter, or it is decoration.
describe('conformance suite self-check', () => {
  it('rejects an adapter that defaults a missing confidence to 1', async () => {
    const bad: DocumentIntelligencePort = {
      async analyze(): Promise<DocumentExtractionResult> {
        return { fields: { hours_active: { value: '8.0', confidence: 1.5 } } };
      },
    };
    const result = await bad.analyze('m', Buffer.alloc(0));
    const confidence = result.fields.hours_active?.confidence ?? 0;
    expect(confidence > 1, 'a >1 confidence must be treated as a violation').toBe(true);
  });
});
