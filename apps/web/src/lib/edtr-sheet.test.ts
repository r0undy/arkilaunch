import { describe, expect, it } from 'vitest';
import { WEATHER_CODES, parseEdtrSheet } from '@arkilaunch/shared';
import { PAGE, buildEdtrSheetSvg, edtrSheetFilename, edtrSheetQrPayload, sheetIndex } from './edtr-sheet.js';

const context = {
  rentalId: '11111111-2222-3333-4444-555555555555',
  chargeTo: 'Acme Builders Inc.',
  projectLocation: '12 Katipunan Ave, Quezon City, Metro Manila',
  bookingCode: 'EQR-2026-0042',
  siteRep: 'Engr. Reyes',
  // Unit on site Tue 22 Sep .. Fri 25 Sep (Manila).
  equipment: [
    {
      id: 'eeeeeeee-0000-0000-0000-000000000001',
      type: 'Excavator',
      model: 'PC200',
      serialNo: 'SN-778',
      start: '2026-09-21T16:00:00.000Z',
      end: '2026-09-25T09:00:00.000Z',
      operatorName: 'Jun Cruz',
      lastHourMeter: 1234.5,
    },
  ],
  tenant: { name: 'Almara Construction', address: 'Pasig City', contact: '0917 000 0000', logoUrl: null },
};

// The printed sheet is the OCR contract (parseEdtrSheet): these checks fail
// if a layout edit drifts from what the reader expects.
describe('buildEdtrSheetSvg (EDTR v3)', () => {
  const svg = buildEdtrSheetSvg({ context, equipmentId: context.equipment[0]!.id, weekStart: '2026-09-21' });

  it('prints every header word the parser finds the v3 grid by', () => {
    for (const word of ['DATE', 'DAY', 'AM', 'PM', 'OVERTIME', 'TOTAL', 'RUNNING', 'IDLE', 'BREAKDOWN', 'WEATHER', 'OTHER', 'HRS', 'METER', 'START', 'END', 'IN', 'OUT', 'WEATHER AM', 'WEATHER PM', 'INITIAL']) {
      expect(svg).toContain(`>${word}<`);
    }
    expect(svg).not.toContain('>IDLE REASON<');
  });

  it('pre-prints seven MM/DD dates, hatching the days outside the rental', () => {
    for (const d of ['09/21', '09/22', '09/23', '09/24', '09/25', '09/26', '09/27']) expect(svg).toContain(`>${d}<`);
    // Mon 21, Sat 26, Sun 27 are outside the unit's span.
    expect(svg.match(/OUTSIDE RENTAL — DO NOT FILL/g)).toHaveLength(3);
    expect(svg).toContain('>TUE<');
    expect(svg).not.toContain('>MON<');
  });

  it('prints one weather tick box per code, per half-day, on each fillable row', () => {
    const boxes = svg.match(/width="3.2" height="3.2"/g) ?? [];
    expect(boxes).toHaveLength(4 * 2 * WEATHER_CODES.length);
  });

  it('carries the booking code, tenant, site rep, operator and hour meter; the QR names no tenant', () => {
    for (const s of ['EQR-2026-0042', 'ALMARA CONSTRUCTION', 'Engr. Reyes', 'Jun Cruz', '1234.5', 'Excavator · PC200 · SN SN-778']) {
      expect(svg).toContain(s);
    }
    expect(edtrSheetQrPayload(context.rentalId, 'e1', '2026-09-21')).toBe(`ARKI-EDTR3:${context.rentalId}:e1:2026-09-21`);
    expect(svg).toContain('Sheet 1 of 1 for this rental unit');
  });

  it('sizes the page from one constant, Legal by default and Letter on request', () => {
    expect(svg).toContain(`viewBox="0 0 ${PAGE.legal.w} ${PAGE.legal.h}"`);
    const letter = buildEdtrSheetSvg({ context, equipmentId: context.equipment[0]!.id, weekStart: '2026-09-21', page: 'letter' });
    expect(letter).toContain(`viewBox="0 0 ${PAGE.letter.w} ${PAGE.letter.h}"`);
    expect(letter).toContain('Page: Letter');
  });

  it('names the file by booking code, unit and week', () => {
    expect(edtrSheetFilename({ context, equipmentId: context.equipment[0]!.id, weekStart: '2026-09-21' }, 'pdf')).toBe(
      'edtr-v3-EQR-2026-0042-SN-778-2026-09-21.pdf',
    );
  });

  it('prints a blank fallback with no dates, no QR and a hand-fill booking box', () => {
    const blank = buildEdtrSheetSvg({});
    expect(blank).toContain('BLANK SHEET');
    expect(blank).toContain('BOOKING CODE');
    expect(blank).not.toContain('>09/21<');
  });

  it('counts weekly sheets across a rental', () => {
    expect(sheetIndex('2026-09-22', '2026-10-20', '2026-10-05')).toEqual({ index: 3, count: 5 });
    expect(sheetIndex('2026-09-22', null, '2026-09-21')).toEqual({ index: 1, count: null });
  });

  // Round trip at the contract level: the grid as a layout model would
  // return it for this printed header parses back into the v3 fields.
  it('round-trips through the parser with the printed header labels', () => {
    const header0 = ['DATE', 'DAY', 'AM', 'AM', 'PM', 'PM', 'OVERTIME', 'OVERTIME', 'TOTAL HOURS', 'RUNNING HRS', 'IDLE HRS', 'BREAKDOWN HRS', 'WEATHER HRS', 'OTHER HRS', 'METER START', 'METER END', 'WEATHER AM', 'WEATHER PM', 'INITIAL'];
    const header1 = ['', '', 'IN', 'OUT', 'IN', 'OUT', 'IN', 'OUT', '', '', '', '', '', '', '', '', '', '', ''];
    const rows = [
      header0,
      header1,
      ['09/21', 'OUTSIDE RENTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['09/22', 'TUE', '07:00', '12:00', '13:00', '17:00', '', '', '9', '7', '0.5', '1.5', '', '', '1234.5', '1241.5', '', '', 'ER'],
    ];
    const parsed = parseEdtrSheet(
      [
        {
          rowCount: rows.length,
          columnCount: header0.length,
          cells: rows.flatMap((row, rowIndex) => row.map((content, columnIndex) => ({ rowIndex, columnIndex, content, confidence: 0.98 }))),
        },
      ],
      '2026-09-23',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.days).toHaveLength(1);
    expect(parsed.days[0]).toMatchObject({
      reportDate: '2026-09-22',
      hoursActive: 7,
      totalMismatch: false,
      v3: { total: 9, running: 7, idle: 0.5, breakdown: 1.5, weather: 0, other: 0, meterStart: 1234.5, meterEnd: 1241.5 },
    });
    // Every label the parser matches exactly is printed (as words) on the sheet.
    for (const label of header0) for (const word of label.split(' ')) expect(svg).toContain(`>${word}<`);
  });
});
