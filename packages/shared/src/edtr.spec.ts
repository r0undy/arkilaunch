import { describe, expect, it } from 'vitest';
import {
  EdtrApproveRequestSchema,
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
  // The real paper form has no idle column, so this is the normal case.
  it('decides on active hours alone when neither log recorded idle time', () => {
    const result = evaluateGate(0.95, 0.95, { active: 0.1, idle: null, total: null }, DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: true, reason: 'auto_accept' });
  });

  it('still blocks on active hours when the idle dimension is absent', () => {
    // The dimension the deduction is priced on is never skipped; dropping
    // idle must not make the gate blind to a real disagreement.
    const result = evaluateGate(0.95, 0.95, { active: 8, idle: null, total: null }, DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });

  it('does not treat an absent idle reading as agreement at zero', () => {
    // worstDelta must skip null rather than coerce it: a 0 would assert the
    // two logs agree about idle hours, a claim neither of them made.
    expect(worstDelta({ active: 0.3, idle: null, total: null })).toBe(0.3);
  });

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

  // Money-path false-accept regression: 8h/0h vs 0h/8h agree on the TOTAL, yet the deduction prices
  // hours_active alone. Do not simplify this back into a single summed comparison.
  it('rejects an equal-and-opposite active/idle swap that nets to a zero total', () => {
    const result = evaluateGate(1, 1, { active: 8, idle: 8, total: 0 }, DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });

  it('rejects divergence on active hours alone', () => {
    const result = evaluateGate(1, 1, deltas({ active: 8, total: 8 }), DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });

  // Deliberate: an idle-classification disagreement still blocks (it is double-entry evidence).
  it('rejects divergence on idle hours alone, even though idle is never priced', () => {
    const result = evaluateGate(1, 1, deltas({ idle: 8, total: 8 }), DEFAULT_TOLERANCE_HOURS);
    expect(result).toEqual({ matched: false, reason: 'tolerance_exceeded' });
  });

  // Same-signed errors that each clear the tolerance still accumulate past it.
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

// Without this path no deposit deduction can be approved: the paper side needs line items and there is no OCR adapter.
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

  // Confidence 1 is correct: no model output to gate; the double-entry tolerance check is the control.
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

describe('EdtrApproveRequestSchema adjustments', () => {
  const reconciliationId = '00000000-0000-4000-8000-000000000001';
  it('caps adjusted hours at 24 per day', () => {
    expect(EdtrApproveRequestSchema.safeParse({ reconciliationId, adjustments: { hoursActive: 80, hoursIdle: 0 } }).success).toBe(false);
    expect(EdtrApproveRequestSchema.safeParse({ reconciliationId, adjustments: { hoursActive: 0, hoursIdle: 25 } }).success).toBe(false);
    expect(EdtrApproveRequestSchema.safeParse({ reconciliationId, adjustments: { hoursActive: 24, hoursIdle: 0 } }).success).toBe(true);
  });
});
