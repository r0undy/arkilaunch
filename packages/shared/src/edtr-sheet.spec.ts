import { describe, expect, it } from 'vitest';
import { parseEdtrSheet, resolveSheetDate } from './edtr-sheet.js';
import type { ExtractedTable } from './document-intelligence-port.js';

// The header shape prebuilt-layout returned for the real Almara sheet: row 0 groups, row 1 IN/OUT, data from row 2.
const HEADER = [
  ['DATE', 'AM', '', 'PM', '', 'OVERTIME', '', 'TOTAL HOURS', 'SIGNATURE'],
  ['', 'IN', 'OUT', 'IN', 'OUT', 'IN', 'OUT', '', ''],
];

function table(dataRows: string[][]): ExtractedTable {
  const rows = [...HEADER, ...dataRows];
  return {
    rowCount: rows.length,
    columnCount: 9,
    cells: rows.flatMap((row, rowIndex) =>
      row.map((content, columnIndex) => ({ rowIndex, columnIndex, content, confidence: 0.99 })),
    ),
  };
}

const CAPTURE = '2026-03-06';

describe('parseEdtrSheet', () => {
  it('reads every dated row off one sheet, not just the first', () => {
    const result = parseEdtrSheet(
      [
        table([
          ['03/01', '07:00', '11:30', '13:00', '17:00', '18:00', '20:00', '10.5', ''],
          ['03/02', '07:00', '12:00', '13:00', '17:00', '', '', '9.0', ''],
          ['03/03', '08:00', '11:00', '13:30', '16:30', '', '', '6.0', ''],
          // The rest of the form is blank, which is the normal case.
          ['', '', '', '', '', '', '', '', ''],
          ['', '', '', '', '', '', '', '', ''],
        ]),
      ],
      CAPTURE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toHaveLength(3);
    expect(result.days.map((d) => d.reportDate)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    // The written total is the reading, never the computed one.
    expect(result.days.map((d) => d.hoursActive)).toEqual([10.5, 9, 6]);
    expect(result.days.every((d) => !d.totalMismatch)).toBe(true);
  });

  it('flags a row whose in/out times contradict the written total', () => {
    // 8.5 worked hours against a written 10.5: the page disagrees with itself, so a human must see it.
    const result = parseEdtrSheet(
      [table([['03/01', '07:00', '11:30', '13:00', '17:00', '', '', '10.5', '']])],
      CAPTURE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0]!.computedHours).toBe(8.5);
    expect(result.days[0]!.hoursActive).toBe(10.5);
    expect(result.days[0]!.totalMismatch).toBe(true);
  });

  it('refuses the whole sheet when a dated row has an unreadable total, naming the day', () => {
    // Load-bearing: silently dropping this row would lose a billable day.
    const result = parseEdtrSheet(
      [
        table([
          ['03/01', '07:00', '11:30', '13:00', '17:00', '', '', '10.5', ''],
          ['03/02', '07:00', '12:00', '13:00', '17:00', '', '', '', ''],
        ]),
      ],
      CAPTURE,
    );

    expect(result).toEqual({ ok: false, reason: 'unreadable_total_hours:2026-03-02' });
  });

  it('refuses a sheet listing the same date twice', () => {
    const result = parseEdtrSheet(
      [
        table([
          ['03/01', '07:00', '11:30', '13:00', '17:00', '', '', '10.5', ''],
          ['03/01', '07:00', '12:00', '13:00', '17:00', '', '', '9.0', ''],
        ]),
      ],
      CAPTURE,
    );

    expect(result).toEqual({ ok: false, reason: 'duplicate_date:2026-03-01' });
  });

  it('leaves computedHours null rather than short when a time pair is half filled', () => {
    // An IN with no OUT is unknown, not zero worked time.
    const result = parseEdtrSheet(
      [table([['03/01', '07:00', '', '13:00', '17:00', '', '', '8.0', '']])],
      CAPTURE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0]!.computedHours).toBeNull();
    expect(result.days[0]!.totalMismatch).toBe(false);
  });

  it('picks the timesheet out of the header tables on the same page', () => {
    // The CHARGE TO / EQPT. TYPE block is its own 2x2 table and must not be mistaken for the grid.
    const headerBlock: ExtractedTable = {
      rowCount: 2,
      columnCount: 2,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: 'CHARGE TO', confidence: 0.99 },
        { rowIndex: 0, columnIndex: 1, content: 'Tower 3 Podium Works', confidence: 0.99 },
        { rowIndex: 1, columnIndex: 0, content: 'EQPT. TYPE', confidence: 0.99 },
        { rowIndex: 1, columnIndex: 1, content: 'Crawler Crane CC-07', confidence: 0.99 },
      ],
    };
    const result = parseEdtrSheet(
      [headerBlock, table([['03/01', '07:00', '11:30', '13:00', '17:00', '', '', '8.5', '']])],
      CAPTURE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toHaveLength(1);
  });

  it('reads the merged-header shape the real form actually produces', () => {
    // The span-expanded real grid; the blank-padded HEADER above is the other variant, and both must parse.
    const merged = [
      ['DATE', 'AM', 'AM', 'PM', 'PM', 'OVERTIME', 'OVERTIME', 'TOTAL HOURS', 'SIGNATURE'],
      ['DATE', 'IN', 'OUT', 'IN', 'OUT', 'IN', 'OUT', 'TOTAL HOURS', 'SIGNATURE'],
      ['03/01', '07:00', '11:30', '13:00', '17:00', '18:00', '20:00', '10.5', ''],
    ];
    const result = parseEdtrSheet(
      [
        {
          rowCount: merged.length,
          columnCount: 9,
          cells: merged.flatMap((row, rowIndex) =>
            row.map((content, columnIndex) => ({ rowIndex, columnIndex, content, confidence: 0.99 })),
          ),
        },
      ],
      CAPTURE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toEqual([
      {
        reportDate: '2026-03-01',
        hoursActive: 10.5,
        computedHours: 10.5,
        totalMismatch: false,
        confidence: 0.99,
      },
    ]);
  });

  it('refuses a page with no timesheet grid at all', () => {
    expect(parseEdtrSheet([], CAPTURE)).toEqual({ ok: false, reason: 'no_timesheet_table' });
    expect(parseEdtrSheet(undefined, CAPTURE)).toEqual({ ok: false, reason: 'no_timesheet_table' });
  });

  it('does not let OVERTIME reach into the TOTAL HOURS column', () => {
    // Guards the column-bounding logic: if the OVERTIME group scanned past
    // its own block it would read 10.5 as an out-time and compute nonsense.
    const result = parseEdtrSheet(
      [table([['03/01', '07:00', '11:30', '13:00', '17:00', '18:00', '20:00', '10.5', '']])],
      CAPTURE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0]!.computedHours).toBe(10.5);
  });
});

describe('resolveSheetDate', () => {
  it('resolves a bare MM/DD to the year nearest the capture', () => {
    expect(resolveSheetDate('03/01', '2026-03-06')).toBe('2026-03-01');
  });

  it('rolls a December row back a year when captured in January', () => {
    // A December sheet photographed on 2 January must not be filed eleven months ahead.
    expect(resolveSheetDate('12/28', '2027-01-02')).toBe('2026-12-28');
  });

  it('takes a full ISO date as written', () => {
    expect(resolveSheetDate('2026-03-01', '2026-03-06')).toBe('2026-03-01');
  });

  it('rejects a date that does not exist', () => {
    expect(resolveSheetDate('02/30', '2026-03-06')).toBeNull();
    expect(resolveSheetDate('13/01', '2026-03-06')).toBeNull();
    expect(resolveSheetDate('', '2026-03-06')).toBeNull();
  });
});

// EDTR v3 printed header: one hour column per cause plus the hour meter.
const V3_HEADER = [
  ['DATE', 'DAY', 'AM', '', 'PM', '', 'OVERTIME', '', 'TOTAL HOURS', 'RUNNING HRS', 'IDLE HRS', 'BREAKDOWN HRS', 'WEATHER HRS', 'OTHER HRS', 'METER START', 'METER END', 'INITIAL'],
  ['', '', 'IN', 'OUT', 'IN', 'OUT', 'IN', 'OUT', '', '', '', '', '', '', '', '', ''],
];

function v3Table(dataRows: string[][]): ExtractedTable {
  const rows = [...V3_HEADER, ...dataRows];
  return {
    rowCount: rows.length,
    columnCount: V3_HEADER[0]!.length,
    cells: rows.flatMap((row, rowIndex) =>
      row.map((content, columnIndex) => ({ rowIndex, columnIndex, content, confidence: 0.99 })),
    ),
  };
}

describe('parseEdtrSheet v3', () => {
  it('bills RUNNING HRS, keeps each downtime cause, and checks IN/OUT against TOTAL', () => {
    const result = parseEdtrSheet(
      [
        v3Table([
          ['03/02', 'MON', '07:00', '12:00', '13:00', '17:00', '', '', '9', '6', '1', '2', '', '', '1200.5', '1206.5', 'JR'],
        ]),
      ],
      CAPTURE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [day] = result.days;
    expect(day!.hoursActive).toBe(6);
    expect(day!.totalMismatch).toBe(false);
    expect(day!.v3).toEqual({
      total: 9,
      running: 6,
      idle: 1,
      breakdown: 2,
      weather: 0,
      other: 0,
      meterStart: 1200.5,
      meterEnd: 1206.5,
    });
  });

  it('skips a day marked outside the rental and a day left blank, instead of failing the sheet', () => {
    const blank = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
    const result = parseEdtrSheet(
      [
        v3Table([
          ['03/01', 'OUTSIDE RENTAL', ...blank],
          ['03/02', 'MON', '07:00', '11:00', '', '', '', '', '4', '4', '', '', '', '', '', '', ''],
          ['03/03', 'TUE', ...blank],
        ]),
      ],
      CAPTURE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.map((d) => d.reportDate)).toEqual(['2026-03-02']);
  });

  it('still refuses a filled v3 row whose running hours cannot be read', () => {
    const result = parseEdtrSheet(
      [v3Table([['03/02', 'MON', '07:00', '11:00', '', '', '', '', '4', '?!', '', '', '', '', '', '', '']])],
      CAPTURE,
    );
    expect(result).toEqual({ ok: false, reason: 'unreadable_total_hours:2026-03-02' });
  });

  it('leaves a v2 sheet exactly as before: no v3 block, TOTAL is the reading', () => {
    const result = parseEdtrSheet([table([['03/01', '07:00', '11:00', '', '', '', '', '4', '']])], CAPTURE);
    expect(result.ok && result.days[0]!.v3).toBeUndefined();
    expect(result.ok && result.days[0]!.hoursActive).toBe(4);
  });
});
