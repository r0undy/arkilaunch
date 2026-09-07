import { describe, expect, it } from 'vitest';
import {
  computeAccuracy,
  assertAccuracyGate,
  OCR_ACCURACY_THRESHOLD,
  type AccuracyReport,
} from './ocr-accuracy.js';

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

// The QAD-T39 threshold enforcement itself. These tests exist so the
// ocr-accuracy-gate CI job runs real enforcement code rather than an
// `echo`: the gate's INPUT (a labeled golden corpus of real Almara sheets)
// does not exist yet and arkilaunch-edtr-neural-v1 is untrained, so the
// >= 90.06% product claim is deliberately NOT asserted anywhere. What is
// asserted is that the decision function will fail correctly the moment
// real fixtures do land.
describe('assertAccuracyGate (QAD-T39 threshold enforcement)', () => {
  const report = (over: Partial<AccuracyReport> = {}): AccuracyReport => ({
    overall: 1,
    perField: {},
    autoAcceptErrorRate: 0,
    sampleCount: 10,
    ...over,
  });

  it('passes a corpus at or above the threshold', () => {
    expect(assertAccuracyGate(report({ overall: 0.95 }))).toEqual({ passed: true, reason: null });
    expect(assertAccuracyGate(report({ overall: OCR_ACCURACY_THRESHOLD })).passed).toBe(true);
  });

  it('fails just below the threshold and says by how much', () => {
    const result = assertAccuracyGate(report({ overall: OCR_ACCURACY_THRESHOLD - 0.0001 }));
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/below the 90\.06% gate/);
  });

  it('fails the synthetic placeholder corpus, which is the honest result today', () => {
    // 6 of 8 fixture samples correct by construction = 75%. The gate must
    // report this as a failure rather than being softened to accommodate
    // it; QAD-T39 stays unchecked until real labeled samples exist.
    expect(assertAccuracyGate(report({ overall: 6 / 8, sampleCount: 8 })).passed).toBe(false);
  });

  // The case a naive `!(overall < threshold)` spelling would wave through.
  // A gate that greens because nobody supplied any evidence is worse than
  // no gate at all.
  it('fails an empty golden set instead of vacuously passing', () => {
    const result = assertAccuracyGate(computeAccuracy([]));
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/empty/);
  });
});
