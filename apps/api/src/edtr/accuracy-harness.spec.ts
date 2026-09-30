import { describe, expect, it } from 'vitest';
import {
  assertAccuracyGate,
  computeAccuracy,
  meetsCorpusFloor,
  OCR_ACCURACY_THRESHOLD,
  OCR_CORPUS_FLOOR,
  type GoldSample,
  type OcrCorpusKind,
} from '@arkilaunch/shared';
import { EDTR_GOLDEN_SET, KYC_GOLDEN_SET } from '@arkilaunch/db/dist/seed/ocr-fixtures/golden-set.js';

// Corpus-INDEPENDENT: asserts internal consistency, that the gate BINDS at the corpus floor, and that below it
// the result is an absent measurement, never a pass (a too-small corpus is no evidence, not a failing model).
function describeCorpus(kind: OcrCorpusKind, samples: GoldSample[]) {
  describe(`${kind} golden set`, () => {
    const report = computeAccuracy(samples);

    it('reports a per-field and overall accuracy consistent with the corpus', () => {
      expect(report.sampleCount).toBe(samples.length);
      expect(report.overall).toBeGreaterThanOrEqual(0);
      expect(report.overall).toBeLessThanOrEqual(1);
      // Every field type present in the corpus is scored; none silently
      // dropped, which would flatter the aggregate.
      const fieldTypes = new Set(samples.map((s) => s.fieldType));
      expect(Object.keys(report.perField).sort()).toEqual([...fieldTypes].sort());
    });

    it('reports the auto-accept error rate separately from raw accuracy', () => {
      // Accuracy vs confident-but-wrong: the second is what calibrates the 0.90 gate.
      expect(report.autoAcceptErrorRate).toBeGreaterThanOrEqual(0);
      expect(report.autoAcceptErrorRate).toBeLessThanOrEqual(1);
    });

    if (meetsCorpusFloor(kind, samples.length)) {
      it(`meets the QAD §2 floor, so QAD-T39 binds: >= ${(OCR_ACCURACY_THRESHOLD * 100).toFixed(2)}%`, () => {
        const gate = assertAccuracyGate(report);
        // Deliberately not softened. If this fails, the answer is more
        // fixtures or a retrained model -- never a lower threshold.
        expect(gate.reason ?? 'passed').toBe('passed');
        expect(gate.passed).toBe(true);
      });
    } else {
      it(`is below the QAD §2 floor (${samples.length}/${OCR_CORPUS_FLOOR[kind]}), so QAD-T39 is NOT measured`, () => {
        expect(meetsCorpusFloor(kind, samples.length)).toBe(false);
        // The honest record: the gate over this corpus does not pass, and no
        // QAD-T39 claim may be made from it in either direction.
        expect(assertAccuracyGate(report).passed).toBe(false);
      });
    }
  });
}

describe('OCR accuracy harness (RFC-2 §5, QAD-T39)', () => {
  describeCorpus('edtr', EDTR_GOLDEN_SET);
  describeCorpus('kyc', KYC_GOLDEN_SET);

  it('an empty golden set reports zero and fails the gate, rather than passing vacuously', () => {
    const report = computeAccuracy([]);
    expect(report.overall).toBe(0);
    expect(report.autoAcceptErrorRate).toBe(0);
    expect(report.sampleCount).toBe(0);
    expect(assertAccuracyGate(report).passed).toBe(false);
  });
});
