import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  worstDelta,
  type HourDeltas,
  buildManualTranscriptionPayload,
  isManualTranscription,
  CONFIDENCE_GATE,
  DEFAULT_TOLERANCE_HOURS,
  MANUAL_TRANSCRIPTION_MODEL_ID,
} from './edtr.js';

// A delta with every dimension in agreement, so a test can vary one field
// at a time instead of restating the whole shape.
function deltas(over: Partial<HourDeltas> = {}): HourDeltas {
  return { active: 0, idle: 0, total: 0, ...over };
}

describe('evaluateGate (RFC-2 §3 state machine, pure)', () => {
  it('auto-accepts when both confidences meet the gate and delta is within tolerance', () => {
    const result = evaluateGate(0.95, 0.93, deltas({ active: 0.1, total: 0.1 }), DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: true, reason: 'auto_accept' });
  });

  it('routes to review on low confidence even when delta is within tolerance', () => {
    const result = evaluateGate(CONFIDENCE_GATE - 0.01, 0.95, deltas(), DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'low_confidence' });
  });

  it('routes to review on tolerance-exceeded even when both confidences are high', () => {
    const over = DEFAULT_TOLERANCE_HOURS + 0.01;
    const result = evaluateGate(0.95, 0.95, deltas({ active: over, total: over }), DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });

  it('low confidence takes priority when both conditions fail', () => {
    const result = evaluateGate(0.5, 0.5, deltas({ active: 999, total: 999 }), DEFAULT_TOLERANCE_HOURS);
    expect(result.reason).toBe('low_confidence');
  });

  // THE regression test for the money-path false-accept this signature
  // exists to close. One log reads 8h active / 0h idle, the counterpart
  // reads 0h active / 8h idle. They agree on the TOTAL (8h either way), so
  // the old summed-scalar gate saw delta 0 and auto-accepted -- while the
  // deduction it then approved prices hours_active alone. Do not "simplify"
  // this back into a single summed comparison.
  it('rejects an equal-and-opposite active/idle swap that nets to a zero total', () => {
    const result = evaluateGate(1, 1, { active: 8, idle: 8, total: 0 }, DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });

  it('rejects divergence on active hours alone', () => {
    const result = evaluateGate(1, 1, deltas({ active: 8, total: 8 }), DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });

  // Idle hours are not priced, but two logs disagreeing about how to
  // classify an hour is still evidence the sheets disagree, which is what
  // the double-entry check is for. Blocking here is deliberate, not an
  // over-strict accident -- a review-queue backlog is not a reason to drop
  // this case.
  it('rejects divergence on idle hours alone, even though idle is never priced', () => {
    const result = evaluateGate(1, 1, deltas({ idle: 8, total: 8 }), DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });

  // The summed total is still a checked dimension, so the new gate cannot
  // be looser than the one it replaced: two same-signed errors that each
  // clear the tolerance individually still accumulate past it.
  it('rejects two same-signed errors that individually clear tolerance but accumulate past it', () => {
    const result = evaluateGate(1, 1, { active: 0.2, idle: 0.2, total: 0.4 }, DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });

  it('treats the tolerance as inclusive on every dimension', () => {
    const t = DEFAULT_TOLERANCE_HOURS;
    expect(evaluateGate(1, 1, { active: t, idle: t, total: t }, t)).toEqual({
      matched: true,
      reason: 'auto_accept',
    });
    expect(evaluateGate(1, 1, deltas({ active: t + 0.01 }), t).matched).toBe(false);
  });
});

describe('worstDelta (what edtr_reconciliations.delta_hours stores)', () => {
  it('reports the worst dimension, not the summed total', () => {
    expect(worstDelta({ active: 0.4, idle: 0.3, total: 0.7 })).toBe(0.7);
    // The swap case: the total agrees, so the stored delta must come from
    // the per-dimension disagreement or the column would read as a match.
    expect(worstDelta({ active: 8, idle: 8, total: 0 })).toBe(8);
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

    const withinTolerance = evaluateGate(
      payload.min_field_confidence,
      1,
      { active: 0.1, idle: 0, total: 0.1 },
      DEFAULT_TOLERANCE_HOURS,
    );
    expect(withinTolerance).toEqual({ matched: true, reason: 'auto_accept' });

    // Two humans who disagree beyond tolerance are still stopped.
    const disagreeing = evaluateGate(
      payload.min_field_confidence,
      1,
      { active: 2, idle: 0, total: 2 },
      DEFAULT_TOLERANCE_HOURS,
    );
    expect(disagreeing).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });
});
