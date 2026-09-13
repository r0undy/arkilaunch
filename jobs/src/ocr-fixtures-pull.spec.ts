import { describe, expect, it } from 'vitest';
import { computeAccuracy, type GoldSample } from '@arkilaunch/shared';
import { parseArgs, redactValue, renderGoldenSet } from './ocr-fixtures-pull.js';

describe('ocr-fixtures-pull argument parsing', () => {
  it('defaults to training mode over both kinds', () => {
    const opts = parseArgs([]);
    expect(opts.mode).toBe('training');
    expect(opts.kinds).toEqual(['edtr', 'kyc']);
    expect(opts.partial).toBe(false);
  });

  it('rejects an unknown mode rather than falling back to a default', () => {
    expect(() => parseArgs(['--mode=guess'])).toThrow(/unknown --mode/);
  });

  it('rejects an unknown kind', () => {
    expect(() => parseArgs(['--kind=invoices'])).toThrow(/unknown --kind/);
  });
});

describe('PII redaction', () => {
  // The load-bearing property: redaction must not change what
  // computeAccuracy() measures. If it did, the committed corpus would report
  // a different number from the real one it was derived from.
  it('preserves exact-match equality for a correct sample', () => {
    expect(redactValue('tin', '123-456-789')).toBe(redactValue('tin', '123-456-789'));
  });

  it('preserves inequality for a wrong sample', () => {
    expect(redactValue('tin', '123-456-780')).not.toBe(redactValue('tin', '123-456-789'));
  });

  it('survives the normalization computeAccuracy applies', () => {
    // ocr-accuracy.ts normalizes case and whitespace before comparing, so a
    // value differing only that way must still redact to the same surrogate.
    expect(redactValue('sec_number', '  CS202312345 ')).toBe(redactValue('sec_number', 'cs202312345'));
  });

  it('leaves non-PII hour readings verbatim', () => {
    expect(redactValue('hours_active', 8)).toBe(8);
    expect(redactValue('hours_idle', 0.5)).toBe(0.5);
  });

  it('scores a redacted corpus identically to its unredacted original', () => {
    const raw: GoldSample[] = [
      { fieldType: 'tin', extractedValue: '123-456-789', groundTruth: '123-456-789', confidence: 0.95 },
      { fieldType: 'tin', extractedValue: '123-456-780', groundTruth: '123-456-789', confidence: 0.93 },
      { fieldType: 'sec_number', extractedValue: 'CS202312345', groundTruth: 'CS202312345', confidence: 0.91 },
    ];
    const redacted = raw.map((s) => ({
      ...s,
      extractedValue: redactValue(s.fieldType, s.extractedValue),
      groundTruth: redactValue(s.fieldType, s.groundTruth),
    }));
    expect(computeAccuracy(redacted)).toEqual(computeAccuracy(raw));
  });

  it('emits no recognizable SEC or TIN shape', () => {
    expect(String(redactValue('tin', '123-456-789'))).toMatch(/^redacted:[0-9a-f]{12}$/);
    expect(String(redactValue('sec_number', 'CS202312345'))).not.toContain('CS202312345');
  });
});

describe('golden set rendering', () => {
  const sample: GoldSample = {
    fieldType: 'hours_active',
    extractedValue: 8,
    groundTruth: 8,
    confidence: 0.97,
  };

  it('stamps the sample count and the QAD floor into the file header', () => {
    const out = renderGoldenSet({ edtr: [sample], kyc: [] }, { partial: true, skipped: { edtr: 0, kyc: 0 } });
    expect(out).toContain('EDTR samples: 1 (QAD §2 floor: 200)');
    expect(out).toContain('KYC samples:  0 (QAD §2 floor: 50)');
  });

  it('marks a partial corpus as not measuring QAD-T39', () => {
    const out = renderGoldenSet({ edtr: [sample], kyc: [] }, { partial: true, skipped: { edtr: 0, kyc: 0 } });
    // A thin corpus must never be mistakable for a full one at a glance.
    expect(out).toContain('PARTIAL -- below the QAD §2 floor, does NOT measure QAD-T39');
  });

  it('records documents excluded for having no extraction', () => {
    const out = renderGoldenSet({ edtr: [sample], kyc: [] }, { partial: true, skipped: { edtr: 3, kyc: 0 } });
    expect(out).toContain('3 document(s) excluded for having no extraction');
  });

  it('renders samples the accuracy harness can consume unchanged', () => {
    const out = renderGoldenSet({ edtr: [sample], kyc: [] }, { partial: true, skipped: { edtr: 0, kyc: 0 } });
    expect(out).toContain("import type { GoldSample } from '@arkilaunch/shared';");
    expect(out).toContain('export const EDTR_GOLDEN_SET: GoldSample[] = [');
    expect(out).toContain('export const KYC_GOLDEN_SET: GoldSample[] = [');
    expect(out).toContain('{ fieldType: "hours_active", extractedValue: 8, groundTruth: 8, confidence: 0.97 },');
  });
});
