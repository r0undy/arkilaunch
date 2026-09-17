import { describe, expect, it } from 'vitest';
import { parseEdtrSheet, resolveSheetDate } from './edtr-sheet.js';
import type { ExtractedTable } from './document-intelligence-port.js';

// The header shape prebuilt-layout actually returned for the real Almara
// sheet: row 0 groups, row 1 IN/OUT sub-labels, data from row 2. Verified
// against the live di-arkilaunch-dev resource
// (docs/cr-arkilaunch-edtr-real-form.md).
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
      row.map((content, columnIndex) => ({ rowIndex, columnIndex, content })),
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
    // 07:00-11:30 plus 13:00-17:00 is 8.5 worked hours, but the sheet says
    // 10.5. Two of the three readings on the page disagree, so this day
    // must reach a human even though it parses cleanly.
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
    // The load-bearing case: silently dropping this row would lose a
    // billable day, and nothing downstream could ever tell it had existed.
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
    // An IN with no OUT is an unknown, not zero worked time. Treating it as
    // zero would invent a disagreement with the written total and send a
    // good day to review.
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
    // prebuilt-layout returns the CHARGE TO / EQPT. TYPE block as its own
    // 2x2 table; it has no DATE+TOTAL header pair and must not be mistaken
    // for the grid.
    const headerBlock: ExtractedTable = {
      rowCount: 2,
      columnCount: 2,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: 'CHARGE TO' },
        { rowIndex: 0, columnIndex: 1, content: 'Tower 3 Podium Works' },
        { rowIndex: 1, columnIndex: 0, content: 'EQPT. TYPE' },
        { rowIndex: 1, columnIndex: 1, content: 'Crawler Crane CC-07' },
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
    // The case that makes "just use the capture's year" wrong: a sheet
    // filled through December and photographed on 2 January would
    // otherwise be filed eleven months in the future.
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
