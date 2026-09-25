import { describe, expect, it } from 'vitest';
import { IDLE_REASONS, WEATHER_CODES } from '@arkilaunch/shared';
import { buildEdtrSheetSvg, edtrSheetQrPayload, IDLE_LABELS } from './edtr-sheet.js';

const context = {
  rentalId: '11111111-2222-3333-4444-555555555555',
  chargeTo: 'Acme Builders Inc.',
  projectLocation: '12 Katipunan Ave, Quezon City, Metro Manila',
  equipment: [{ id: 'eeeeeeee-0000-0000-0000-000000000001', type: 'Excavator', model: 'PC200', serialNo: 'SN-778' }],
};

// The printed sheet is the OCR contract (parseEdtrSheet): these checks fail
// if a layout edit drifts from what the reader expects.
describe('buildEdtrSheetSvg', () => {
  const svg = buildEdtrSheetSvg({ context, equipmentId: context.equipment[0]!.id, weekStart: '2026-09-21' });

  it('prints the header labels the parser finds the grid by', () => {
    for (const label of ['DATE', 'AM', 'PM', 'OVERTIME', 'TOTAL', 'IN', 'OUT', 'IDLE REASON', 'WEATHER AM', 'WEATHER PM']) {
      expect(svg).toContain(`>${label}<`);
    }
  });

  it('pre-prints seven MM/DD dates and nothing else in the DATE cells', () => {
    for (const d of ['09/21', '09/22', '09/23', '09/24', '09/25', '09/26', '09/27']) expect(svg).toContain(`>${d}<`);
    expect(svg).toContain('>MON<');
  });

  it('prints one tick box per option, per group, per row', () => {
    const boxes = svg.match(/width="3.2" height="3.2"/g) ?? [];
    expect(boxes).toHaveLength(7 * (IDLE_LABELS.length + 2 * WEATHER_CODES.length));
    expect(IDLE_LABELS).toHaveLength(IDLE_REASONS.length);
  });

  it('fills the header and carries the rental, unit and week in the QR (never a tenant)', () => {
    expect(svg).toContain('Acme Builders Inc.');
    expect(svg).toContain('Excavator · PC200 · SN SN-778');
    expect(edtrSheetQrPayload(context.rentalId, 'e1', '2026-09-21')).toBe(`ARKI-EDTR2:${context.rentalId}:e1:2026-09-21`);
  });

  it('prints a blank fallback with no dates and no QR', () => {
    const blank = buildEdtrSheetSvg({});
    expect(blank).toContain('BLANK SHEET');
    expect(blank).not.toContain('>09/21<');
  });
});
