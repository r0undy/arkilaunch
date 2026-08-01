import { describe, expect, it } from 'vitest';
import { evaluateGate, CONFIDENCE_GATE, DEFAULT_TOLERANCE_HOURS } from './edtr.js';

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
