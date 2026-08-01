import type { GoldSample } from '@arkilaunch/shared';

// Synthetic placeholder golden set (RFC-2 §5, QAD-T39). Swap this file's
// contents for real anchor-tenant labeled samples once collected -- the
// harness in apps/api/src/edtr/accuracy-harness.spec.ts is what changes
// nothing when that swap happens, only this data does. Real fixtures land
// via `pnpm ocr:fixtures:pull` per QAD §2 (>= 200 EDTR pages, >= 50 KYC
// docs); this set is intentionally tiny and does not claim to measure the
// real >= 90.06% target, only to prove the measurement code is correct.
export const EDTR_GOLDEN_SET: GoldSample[] = [
  { fieldType: 'hours_active', extractedValue: 8.0, groundTruth: 8.0, confidence: 0.97 },
  { fieldType: 'hours_active', extractedValue: 7.5, groundTruth: 7.5, confidence: 0.95 },
  { fieldType: 'hours_active', extractedValue: 6.0, groundTruth: 6.5, confidence: 0.92 }, // wrong, high confidence
  { fieldType: 'hours_idle', extractedValue: 1.0, groundTruth: 1.0, confidence: 0.96 },
  { fieldType: 'hours_idle', extractedValue: 0.5, groundTruth: 0.5, confidence: 0.6 }, // correct, low confidence
  { fieldType: 'breakdown_status', extractedValue: 'none', groundTruth: 'none', confidence: 0.98 },
  { fieldType: 'breakdown_status', extractedValue: 'minor', groundTruth: 'minor', confidence: 0.91 },
  { fieldType: 'breakdown_status', extractedValue: 'none', groundTruth: 'major', confidence: 0.5 }, // wrong, below gate
];

export const KYC_GOLDEN_SET: GoldSample[] = [
  { fieldType: 'sec_number', extractedValue: 'CS202312345', groundTruth: 'CS202312345', confidence: 0.94 },
  { fieldType: 'tin', extractedValue: '123-456-789', groundTruth: '123-456-789', confidence: 0.93 },
  { fieldType: 'tin', extractedValue: '123-456-780', groundTruth: '123-456-789', confidence: 0.91 }, // wrong, high confidence
];
