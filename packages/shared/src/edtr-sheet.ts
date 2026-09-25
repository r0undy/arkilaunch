import { CONFIDENCE_GATE, DEFAULT_TOLERANCE_HOURS } from './edtr.js';
import {
  IDLE_REASONS,
  WEATHER_CODES,
  readTickGroup,
  type IdleReason,
  type WeatherCode,
} from './weather-attestation.js';
import type { BoundingRegion, ExtractedTable } from './document-intelligence-port.js';

// Parses the real Almara "EQUIPMENT DAILY TIME REPORT" sheet
// (docs/cr-arkilaunch-edtr-real-form.md) out of the table prebuilt-layout
// returns. Pure: no network, no DB, no Azure types beyond the port's own
// ExtractedTable, so the whole thing is unit-testable offline.
//
// The sheet is NOT the one-equipment-day document the EDTR schema was
// built for. One sheet carries up to ~22 dated rows over a DATE COVERED
// range, and the columns are AM/PM/OVERTIME in-out pairs plus a written
// TOTAL HOURS -- there is no hours-active field and no idle column at all.
// This module turns one sheet into N day readings; the worker fans those
// out into N edtr rows so reconciliation keeps pairing on
// (equipment_id, report_date) exactly as before.

export interface EdtrSheetDay {
  // ISO yyyy-mm-dd, year resolved against the capture date (see below).
  reportDate: string;
  // What the operator wrote in TOTAL HOURS and signed for. This is the
  // reading; it is never replaced by the computed figure below, because a
  // derived number is not what anyone on site recorded.
  hoursActive: number;
  // Re-derived from the AM/PM/OVERTIME in-out pairs on the same row, or
  // null when the row carries no usable time pair at all.
  computedHours: number | null;
  // computedHours disagrees with hoursActive beyond tolerance. The sheet
  // contradicts itself, so this day must reach a human even if a digital
  // counterpart happens to agree with the written total.
  totalMismatch: boolean;
  // Lowest OCR confidence across the two cells whose values become the
  // record: the date and the written total. The time cells are deliberately
  // excluded -- they never become a stored reading, they only corroborate,
  // and a smudged time that produces a wrong cross-check already routes the
  // day to review via totalMismatch. Feeds min_field_confidence and so the
  // 0.90 gate.
  confidence: number;
  // Where the written TOTAL HOURS cell sits on the page, so the review
  // screen can point at the figure that becomes the billed reading rather
  // than at the sheet in general. Absent when the response carried no
  // usable polygon for that cell.
  boundingRegion?: BoundingRegion;
  // EDTR v2 columns (docs/cr-arkilaunch-edtr-v2-weather.md), present only
  // when the sheet carries them. Unread or ambiguous ticks are null.
  v2?: {
    idleHours: number | null;
    idleReason: IdleReason | null;
    weatherAm: WeatherCode | null;
    weatherPm: WeatherCode | null;
    // The row's own AM/PM in-out pairs, minutes since midnight.
    amWindow: [number, number] | null;
    pmWindow: [number, number] | null;
  };
}

export type EdtrSheetParse =
  | { ok: true; days: EdtrSheetDay[] }
  | { ok: false; reason: string };

// Header labels, matched case-insensitively on normalised cell text. Kept
// as substrings rather than exact equality because prebuilt-layout returns
// the printed label verbatim, including the trailing colon and whatever
// stray punctuation the scan picked up.
const DATE_HEADER = 'DATE';
const TOTAL_HEADER = 'TOTAL';
const GROUPS = ['AM', 'PM', 'OVERTIME'] as const;

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

interface Grid {
  rows: string[][];
  confidences: number[][];
  regions: (BoundingRegion | undefined)[][];
  rowCount: number;
  columnCount: number;
}

function toGrid(table: ExtractedTable): Grid | null {
  const rows: string[][] = Array.from({ length: table.rowCount }, () =>
    Array<string>(table.columnCount).fill(''),
  );
  const confidences: number[][] = Array.from({ length: table.rowCount }, () =>
    Array<number>(table.columnCount).fill(0),
  );
  const regions: (BoundingRegion | undefined)[][] = Array.from({ length: table.rowCount }, () =>
    Array<BoundingRegion | undefined>(table.columnCount).fill(undefined),
  );
  for (const cell of table.cells) {
    // A cell outside the declared bounds means the grid we were handed is
    // not the grid Azure described. Refuse rather than read hours off a
    // shape we do not understand.
    if (cell.rowIndex >= table.rowCount || cell.columnIndex >= table.columnCount) return null;
    if (cell.rowIndex < 0 || cell.columnIndex < 0) return null;
    rows[cell.rowIndex]![cell.columnIndex] = cell.content;
    confidences[cell.rowIndex]![cell.columnIndex] = cell.confidence;
    regions[cell.rowIndex]![cell.columnIndex] = cell.boundingRegion;
  }
  return { rows, confidences, regions, rowCount: table.rowCount, columnCount: table.columnCount };
}

interface Columns {
  date: number;
  total: number;
  // [inCol, outCol] per AM/PM/OVERTIME group, for groups actually present.
  pairs: Array<[number, number]>;
  // AM and PM pairs by name, for the v2 weather windows.
  am: [number, number] | null;
  pm: [number, number] | null;
  // v2 columns, -1 when absent.
  idleHours: number;
  idleReason: number;
  weatherAm: number;
  weatherPm: number;
  headerRows: number;
}

// The header occupies two rows: row 0 carries DATE / AM / PM / OVERTIME /
// TOTAL HOURS / SIGNATURE, and row 1 carries the IN and OUT sub-labels
// under each group. A group's IN/OUT columns are therefore found by
// scanning row 1 to the right of the group's own label in row 0.
function findColumns(grid: Grid): Columns | null {
  const row0 = grid.rows[0];
  const row1 = grid.rows[1];
  if (!row0 || !row1) return null;

  const date = row0.findIndex((c) => norm(c).includes(DATE_HEADER));
  const total = row0.findIndex((c) => norm(c).includes(TOTAL_HEADER));
  if (date < 0 || total < 0) return null;

  const pairs: Array<[number, number]> = [];
  const named: Partial<Record<(typeof GROUPS)[number], [number, number]>> = {};
  for (const group of GROUPS) {
    const at = row0.findIndex((c) => norm(c) === group);
    if (at < 0) continue;
    const ins: number[] = [];
    const outs: number[] = [];
    // Bounded by the next DIFFERENT row-0 label, so OVERTIME cannot reach
    // across into the TOTAL HOURS column and read a total as a time. The
    // label either repeats across the block (a merged header cell expanded
    // by the adapter, which is what the real form produces) or is followed
    // by blanks; both shapes are accepted.
    for (let c = at; c < grid.columnCount; c++) {
      const label = norm(row0[c] ?? '');
      if (c > at && label !== '' && label !== group) break;
      const sub = norm(row1[c] ?? '');
      if (sub === 'IN') ins.push(c);
      if (sub === 'OUT') outs.push(c);
    }
    if (ins.length === 1 && outs.length === 1) {
      pairs.push([ins[0]!, outs[0]!]);
      named[group] = [ins[0]!, outs[0]!];
    }
  }

  const at = (label: string) => row0.findIndex((c) => norm(c) === label);
  return {
    date,
    total,
    pairs,
    am: named.AM ?? null,
    pm: named.PM ?? null,
    idleHours: at('IDLE HRS'),
    idleReason: at('IDLE REASON'),
    weatherAm: at('WEATHER AM'),
    weatherPm: at('WEATHER PM'),
    headerRows: 2,
  };
}

// "07:00" / "7:00" / "07.00" -> minutes since midnight. Anything else is
// absent, not zero.
function parseTime(raw: string): number | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(norm(raw));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function parseHours(raw: string): number | null {
  const t = norm(raw).replace(/\s*(HRS?|HOURS?)$/, '');
  if (t === '') return null;
  const n = Number(t);
  // Negative or absurd hour counts are a misread, not a reading. 24 is the
  // ceiling for a single equipment-day.
  return Number.isFinite(n) && n >= 0 && n <= 24 ? n : null;
}

// Resolves "03/01" against the capture date by choosing the year that puts
// the row nearest that date. Picking the capture's own year instead would
// misfile every December sheet photographed in January by a full year.
// A cell already carrying a full ISO date is taken as-is.
export function resolveSheetDate(raw: string, captureDate: string): string | null {
  const text = norm(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const md = /^(\d{1,2})[/\-.](\d{1,2})$/.exec(text);
  if (!md) return null;
  const month = Number(md[1]);
  const day = Number(md[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const capture = new Date(`${captureDate}T00:00:00Z`);
  if (Number.isNaN(capture.getTime())) return null;
  const captureYear = capture.getUTCFullYear();

  let best: { date: string; distance: number } | null = null;
  for (const year of [captureYear - 1, captureYear, captureYear + 1]) {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    // Rejects 02/30 and friends: Date rolls them into the next month.
    if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) continue;
    const distance = Math.abs(candidate.getTime() - capture.getTime());
    if (!best || distance < best.distance) {
      best = { date: candidate.toISOString().slice(0, 10), distance };
    }
  }
  return best?.date ?? null;
}

function window(row: string[], pair: [number, number] | null): [number, number] | null {
  if (!pair) return null;
  const start = parseTime(row[pair[0]] ?? '');
  const end = parseTime(row[pair[1]] ?? '');
  return start !== null && end !== null && end > start ? [start, end] : null;
}

function readV2(row: string[], confidences: number[], columns: Columns): EdtrSheetDay['v2'] {
  if (columns.weatherAm < 0 && columns.weatherPm < 0 && columns.idleReason < 0) return undefined;
  const tick = <T extends string>(col: number, options: readonly T[]) =>
    col < 0 ? null : readTickGroup(row[col] ?? '', options, confidences[col] ?? 0, CONFIDENCE_GATE);
  return {
    idleHours: columns.idleHours < 0 ? null : parseHours(row[columns.idleHours] ?? ''),
    idleReason: tick(columns.idleReason, IDLE_REASONS),
    weatherAm: tick(columns.weatherAm, WEATHER_CODES),
    weatherPm: tick(columns.weatherPm, WEATHER_CODES),
    amWindow: window(row, columns.am),
    pmWindow: window(row, columns.pm),
  };
}

function computeHours(row: string[], pairs: Array<[number, number]>): number | null {
  let minutes = 0;
  let sawPair = false;
  for (const [inCol, outCol] of pairs) {
    const start = parseTime(row[inCol] ?? '');
    const end = parseTime(row[outCol] ?? '');
    // A half-filled pair (in without out) is not zero worked time -- it is
    // an unknown, so the whole computed figure becomes unavailable rather
    // than quietly short.
    if (start === null && end === null) continue;
    if (start === null || end === null) return null;
    if (end < start) return null;
    minutes += end - start;
    sawPair = true;
  }
  return sawPair ? minutes / 60 : null;
}

// Picks the timesheet grid out of the tables on the page. The Almara sheet
// also yields two small 2x2 header tables (CHARGE TO / EQPT. TYPE and
// PROJECT LOCATION / DATE COVERED), so "the table with a DATE and a TOTAL
// column" is the discriminator, with row count as the tie-break.
function findTimesheet(tables: ExtractedTable[]): { grid: Grid; columns: Columns } | null {
  let best: { grid: Grid; columns: Columns } | null = null;
  for (const table of tables) {
    const grid = toGrid(table);
    if (!grid) continue;
    const columns = findColumns(grid);
    if (!columns) continue;
    if (!best || grid.rowCount > best.grid.rowCount) best = { grid, columns };
  }
  return best;
}

export function parseEdtrSheet(
  tables: ExtractedTable[] | undefined,
  captureDate: string,
  tolerance: number = DEFAULT_TOLERANCE_HOURS,
): EdtrSheetParse {
  const found = findTimesheet(tables ?? []);
  if (!found) return { ok: false, reason: 'no_timesheet_table' };
  const { grid, columns } = found;

  const days: EdtrSheetDay[] = [];
  const unreadableDates: string[] = [];
  const unreadableTotals: string[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (let r = columns.headerRows; r < grid.rowCount; r++) {
    const row = grid.rows[r]!;
    const rawDate = row[columns.date] ?? '';
    // A blank line on a part-filled sheet, which is the normal case -- the
    // form has ~22 rows and a week uses five.
    if (norm(rawDate) === '') continue;

    const reportDate = resolveSheetDate(rawDate, captureDate);
    if (!reportDate) {
      unreadableDates.push(rawDate);
      continue;
    }

    const hoursActive = parseHours(row[columns.total] ?? '');
    if (hoursActive === null) {
      // A dated row whose total cannot be read is NOT skipped. Dropping it
      // would lose a billable day silently, which is the failure this
      // whole path exists to prevent; the capture fails so a human
      // transcribes the sheet instead.
      unreadableTotals.push(reportDate);
      continue;
    }

    if (seen.has(reportDate)) duplicates.push(reportDate);
    seen.add(reportDate);

    const computedHours = computeHours(row, columns.pairs);
    const cellConfidences = grid.confidences[r]!;
    const v2 = readV2(row, cellConfidences, columns);
    days.push({
      reportDate,
      hoursActive,
      computedHours,
      totalMismatch: computedHours !== null && Math.abs(computedHours - hoursActive) > tolerance,
      confidence: Math.min(cellConfidences[columns.date] ?? 0, cellConfidences[columns.total] ?? 0),
      ...(grid.regions[r]![columns.total]
        ? { boundingRegion: grid.regions[r]![columns.total]! }
        : {}),
      ...(v2 ? { v2 } : {}),
    });
  }

  if (unreadableDates.length > 0) {
    return { ok: false, reason: `unreadable_date:${unreadableDates.join(',')}` };
  }
  if (unreadableTotals.length > 0) {
    return { ok: false, reason: `unreadable_total_hours:${unreadableTotals.join(',')}` };
  }
  // Two rows for one date on one sheet cannot both be the reading for that
  // equipment-day, and picking either would be a guess.
  if (duplicates.length > 0) {
    return { ok: false, reason: `duplicate_date:${[...new Set(duplicates)].join(',')}` };
  }
  if (days.length === 0) return { ok: false, reason: 'no_dated_rows' };

  return { ok: true, days };
}
