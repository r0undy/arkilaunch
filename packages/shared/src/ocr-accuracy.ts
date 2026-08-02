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
