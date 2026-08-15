import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  buildManualTranscriptionPayload,
  isManualTranscription,
  CONFIDENCE_GATE,
  DEFAULT_TOLERANCE_HOURS,
  MANUAL_TRANSCRIPTION_MODEL_ID,
} from './edtr.js';

describe('evaluateGate (RFC-2 §3 state machine, pure)', () => {
  it('auto-accepts when both confidences meet the gate and delta is within tolerance', () => {
    const result = evaluateGate(0.95, 0.93, 0.1, DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: true, reason: 'auto_accept' });
  });

  it('routes to review on low confidence even when delta is within tolerance', () => {
    const result = evaluateGate(CONFIDENCE_GATE - 0.01, 0.95, 0, DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'low_confidence' });
  });

  it('routes to review on tolerance-exceeded even when both confidences are high', () => {
    const result = evaluateGate(0.95, 0.95, DEFAULT_TOLERANCE_HOURS + 0.01, DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });

  it('low confidence takes priority when both conditions fail', () => {
    const result = evaluateGate(0.5, 0.5, 999, DEFAULT_TOLERANCE_HOURS);
    expect(result.reason).toBe('low_confidence');
  });
});

// cr-arkilaunch-pilot-honesty.md §2.1. Without this path the pilot cannot
// approve a single deposit deduction: reconciliation needs one paper_ocr
// and one digital_entry row, and with no OCR adapter the paper side could
// never carry line items.
describe('buildManualTranscriptionPayload (human-read paper sheet)', () => {
  const payload = buildManualTranscriptionPayload({
    hoursActive: 8,
    hoursIdle: 1.5,
    analyzedAt: '2026-08-13T09:00:00.000Z',
  });

  it('records the hours a human read off the sheet', () => {
    expect(payload.fields).toEqual([
      { name: 'hours_active', value: 8, value_type: 'number', confidence: 1 },
      { name: 'hours_idle', value: 1.5, value_type: 'number', confidence: 1 },
    ]);
  });

  it('is permanently identifiable as a transcription, not a model result', () => {
    expect(payload.model_id).toBe(MANUAL_TRANSCRIPTION_MODEL_ID);
    expect(isManualTranscription(payload)).toBe(true);
    expect(isManualTranscription({ model_id: 'arkilaunch-edtr-neural-v1' })).toBe(false);
    expect(isManualTranscription(null)).toBe(false);
  });

  // A confidence of 1 here is correct rather than a fudge: reconciliation
  // already returns 1 for digital_entry because it "has no OCR step", and a
  // human transcription has no OCR step either. The gate exists to gate
  // MODEL output; the real control on this row is the double-entry
  // tolerance check against the counterpart log.
  it('passes the confidence gate, leaving the tolerance check as the real control', () => {
    expect(payload.min_field_confidence).toBe(1);
    expect(payload.min_field_confidence).toBeGreaterThanOrEqual(CONFIDENCE_GATE);

    const withinTolerance = evaluateGate(payload.min_field_confidence, 1, 0.1, DEFAULT_TOLERANCE_HOURS);
    expect(withinTolerance).toEqual({ matched: true, reason: 'auto_accept' });

    // Two humans who disagree beyond tolerance are still stopped.
    const disagreeing = evaluateGate(payload.min_field_confidence, 1, 2, DEFAULT_TOLERANCE_HOURS);
    expect(disagreeing).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });
});
