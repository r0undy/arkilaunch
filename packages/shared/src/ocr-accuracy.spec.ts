import { describe, expect, it } from 'vitest';
import { computeAccuracy } from './ocr-accuracy.js';

describe('computeAccuracy (RFC-2 §5, QAD-T39)', () => {
  it('computes overall and per-field exact-match accuracy', () => {
    const report = computeAccuracy([
      { fieldType: 'hours_active', extractedValue: 8, groundTruth: 8, confidence: 0.95 },
      { fieldType: 'hours_active', extractedValue: 5, groundTruth: 6, confidence: 0.95 },
      { fieldType: 'tin', extractedValue: '123-456-789', groundTruth: '123-456-789', confidence: 0.9 },
    ]);
    expect(report.sampleCount).toBe(3);
    expect(report.perField.hours_active).toBeCloseTo(0.5, 5);
    expect(report.perField.tin).toBe(1);
    expect(report.overall).toBeCloseTo(2 / 3, 5);
  });

  it('normalizes whitespace/case for string fields before comparing', () => {
    const report = computeAccuracy([
      { fieldType: 'breakdown_status', extractedValue: '  None ', groundTruth: 'none', confidence: 0.9 },
    ]);
    expect(report.overall).toBe(1);
  });

  it('the auto-accept error rate only counts fields at or above the confidence gate', () => {
    const report = computeAccuracy([
      { fieldType: 'x', extractedValue: 1, groundTruth: 2, confidence: 0.5 }, // wrong, below gate: excluded
      { fieldType: 'x', extractedValue: 1, groundTruth: 2, confidence: 0.95 }, // wrong, at/above gate: counted
    ]);
    expect(report.autoAcceptErrorRate).toBe(1);
  });

  it('an empty sample set never divides by zero', () => {
    const report = computeAccuracy([]);
    expect(report).toEqual({ overall: 0, perField: {}, autoAcceptErrorRate: 0, sampleCount: 0 });
  });
});
