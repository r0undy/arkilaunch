import { describe, expect, it } from 'vitest';
import { cornersSteady, steadyHold, type ScanCorners } from './document-scanner.js';

describe('document hold', () => {
  const corners: ScanCorners = [
    { x: 40, y: 40 }, { x: 500, y: 40 }, { x: 500, y: 400 }, { x: 40, y: 400 },
  ];

  it('keeps a small hand tremor inside the steady hold', () => {
    expect(cornersSteady(corners, corners.map(({ x, y }) => ({ x: x + 3, y: y - 2 })) as ScanCorners, 640, 480)).toBe(true);
  });

  it('resets the hold when a document corner moves', () => {
    const moved: ScanCorners = [...corners];
    moved[0] = { x: 70, y: 40 };
    expect(cornersSteady(corners, moved, 640, 480)).toBe(false);
  });

  it('captures after two steady seconds and restarts after movement', () => {
    const first = steadyHold(null, corners, null, 100, 640, 480);
    expect(first.ready).toBe(false);
    expect(steadyHold(corners, corners, first.startedAt, 2099, 640, 480).ready).toBe(false);
    expect(steadyHold(corners, corners, first.startedAt, 2100, 640, 480).ready).toBe(true);
    const moved = [...corners] as ScanCorners;
    moved[0] = { x: 70, y: 40 };
    const reset = steadyHold(corners, moved, first.startedAt, 2200, 640, 480);
    expect(reset).toMatchObject({ startedAt: 2200, progress: 0, ready: false });
  });
});
