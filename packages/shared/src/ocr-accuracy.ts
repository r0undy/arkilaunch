// RFC-2 §5 accuracy measurement method (BRD-M2, QAD-T39): field-level
// exact-match accuracy after normalization, reported per field type and in
// aggregate, plus the auto-accept error rate that calibrates the 0.90
// confidence gate. Pure/DB-free so it can run against a real or synthetic
// golden set identically.
export interface GoldSample {
  fieldType: string;
  extractedValue: string | number;
  groundTruth: string | number;
  confidence: number;
}

export interface AccuracyReport {
  overall: number;
  perField: Record<string, number>;
  autoAcceptErrorRate: number;
  sampleCount: number;
}

function normalize(value: string | number): string {
  if (typeof value === 'number') return value.toFixed(2);
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeAccuracy(samples: GoldSample[], confidenceGate = 0.9): AccuracyReport {
  const perFieldCounts = new Map<string, { correct: number; total: number }>();
  let autoAcceptTotal = 0;
  let autoAcceptWrong = 0;
  let correctTotal = 0;

  for (const sample of samples) {
    const isCorrect = normalize(sample.extractedValue) === normalize(sample.groundTruth);
    const bucket = perFieldCounts.get(sample.fieldType) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (isCorrect) bucket.correct += 1;
    perFieldCounts.set(sample.fieldType, bucket);
    if (isCorrect) correctTotal += 1;

    if (sample.confidence >= confidenceGate) {
      autoAcceptTotal += 1;
      if (!isCorrect) autoAcceptWrong += 1;
    }
  }

  const perField: Record<string, number> = {};
  for (const [field, counts] of perFieldCounts) {
    perField[field] = counts.total > 0 ? counts.correct / counts.total : 0;
  }

  return {
    overall: samples.length > 0 ? correctTotal / samples.length : 0,
    perField,
    autoAcceptErrorRate: autoAcceptTotal > 0 ? autoAcceptWrong / autoAcceptTotal : 0,
    sampleCount: samples.length,
  };
}

// QAD-T39's release threshold: mean per-field exact-match accuracy on the
// labeled golden set must reach 90.06% before the OCR path may carry a
// deduction. 90.06 is the thesis' measured figure, carried into the PRD as
// the bar to beat, not a round number chosen for looking like one.
export const OCR_ACCURACY_THRESHOLD = 0.9006;

export interface AccuracyGateResult {
  passed: boolean;
  /** Human-readable reason a gate failed; null when it passed. */
  reason: string | null;
}

// Enforcement for the QAD-T39 threshold, separated from computeAccuracy()
// so the decision is testable without a golden set and cannot be quietly
// reduced to a console.log at the call site.
//
// An empty sample set FAILS. This is the load-bearing part: computeAccuracy
// returns overall 0 for no samples, and a naive `overall >= threshold`
// check would then report "0 >= 0.9006 is false" for the right reason by
// accident, while a `!(overall < threshold)` spelling would pass an empty
// corpus outright. A gate that greens because nobody supplied any evidence
// is worse than no gate, so absence of data is an explicit failure with its
// own reason string.
export function assertAccuracyGate(
  report: AccuracyReport,
  threshold = OCR_ACCURACY_THRESHOLD,
): AccuracyGateResult {
  if (report.sampleCount === 0) {
    return { passed: false, reason: 'golden set is empty: no samples to measure accuracy against' };
  }
  if (report.overall < threshold) {
    return {
      passed: false,
      reason:
        `mean field accuracy ${(report.overall * 100).toFixed(2)}% is below the ` +
        `${(threshold * 100).toFixed(2)}% gate over ${report.sampleCount} samples`,
    };
  }
  return { passed: true, reason: null };
}
