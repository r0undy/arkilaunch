import { describe, expect, it } from 'vitest';
import { computeAccuracy } from '@arkilaunch/shared';
import { EDTR_GOLDEN_SET, KYC_GOLDEN_SET } from '@arkilaunch/db';

// RFC-2 §5 / QAD-T39: the accuracy-measurement code, exercised against a
// small synthetic placeholder golden set (decided for this pass -- swap
// packages/db/src/seed/ocr-fixtures/golden-set.ts for real labeled anchor
// samples later; this proves the metric itself is correct, not that
// ArkiLaunch's real extraction hits >= 90.06%).
describe('OCR accuracy harness (RFC-2 §5, QAD-T39)', () => {
  it('computes per-field and overall exact-match accuracy on the EDTR golden set', () => {
    const report = computeAccuracy(EDTR_GOLDEN_SET);
    expect(report.sampleCount).toBe(EDTR_GOLDEN_SET.length);
    // 6 of 8 fixture samples are correct by construction (see golden-set.ts).
    expect(report.overall).toBeCloseTo(6 / 8, 5);
    expect(report.perField.hours_active).toBeCloseTo(2 / 3, 5);
    expect(report.perField.hours_idle).toBe(1);
  });

  it('reports the auto-accept error rate separately from raw accuracy (gate calibration)', () => {
    const report = computeAccuracy(EDTR_GOLDEN_SET);
    // Two samples are >= 0.90 confidence and wrong (hours_active 6.0 vs 6.5,
    // and breakdown_status has none that qualify -- only hours_active does);
    // the auto-accept error rate must be > 0, which is exactly the signal
    // that would push the gate above 0.90 in a real calibration pass.
    expect(report.autoAcceptErrorRate).toBeGreaterThan(0);
  });

  it('computes accuracy on the KYC golden set the same way', () => {
    const report = computeAccuracy(KYC_GOLDEN_SET);
    expect(report.perField.sec_number).toBe(1);
    expect(report.perField.tin).toBeCloseTo(0.5, 5);
  });

  it('an empty golden set reports zero, not NaN or a thrown error', () => {
    const report = computeAccuracy([]);
    expect(report.overall).toBe(0);
    expect(report.autoAcceptErrorRate).toBe(0);
    expect(report.sampleCount).toBe(0);
  });
});
