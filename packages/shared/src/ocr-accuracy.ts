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

export function normalize(value: string | number): string {
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

// QAD-T39 release gate: 90.06 is the thesis' measured figure, not a round number.
export const OCR_ACCURACY_THRESHOLD = 0.9006;

// One floor for the fixture generator and the harness, so they cannot drift on "enough samples".
export const OCR_CORPUS_FLOOR = { edtr: 200, kyc: 50 } as const;

export type OcrCorpusKind = keyof typeof OCR_CORPUS_FLOOR;

// Below the floor is an absent measurement, not a failing model.
export function meetsCorpusFloor(kind: OcrCorpusKind, sampleCount: number): boolean {
  return sampleCount >= OCR_CORPUS_FLOOR[kind];
}

export interface AccuracyGateResult {
  passed: boolean;
  reason: string | null;
}

// An empty sample set FAILS: a gate that greens on no evidence is worse than no gate.
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
