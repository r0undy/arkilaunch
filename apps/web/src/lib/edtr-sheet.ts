import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { WEATHER_CODES, type EdtrSheetContext } from '@arkilaunch/shared';

// EDTR v2 printable sheet (docs/cr-arkilaunch-edtr-v2-weather.md). One SVG
// template, A4 landscape in millimetres, rendered to a 300 dpi PNG and a PDF
// wrapping that PNG, so both files are the same pixels.
//
// The layout is the OCR contract: parseEdtrSheet (packages/shared/src/
// edtr-sheet.ts) finds the timesheet by these exact header labels, reads
// only MM/DD in the DATE cell, and reads each tick group by box count.
// Keep, when editing:
// - row 0 labels DATE / AM / PM / OVERTIME / TOTAL HOURS, row 1 IN / OUT;
// - nothing but the date in a DATE cell (the weekday has its own column);
// - no totals row inside the table (a non-date DATE cell fails the sheet);
// - digit fields as open comb underlines, never closed boxes, which DI
//   could read as tick boxes; tick boxes exactly WEATHER_CODES /
//   IDLE_REASONS long, in that order.

export interface EdtrSheetInput {
  // Omitted = the blank fallback sheet (manual transcription path).
  context?: EdtrSheetContext;
  equipmentId?: string;
  // Monday of the covered week, YYYY-MM-DD.
  weekStart?: string;
}

const W = 297;
const H = 210;
const M = 8;
const INK = '#111111';
const MUTED = '#555555';
const FONT = 'Arial, Helvetica, sans-serif';

// Printed short labels, one per IDLE_REASONS entry and in its order.
export const IDLE_LABELS = ['Wx', 'Brk', 'NoOp', 'Hold', 'Oth'];
const COLUMNS: { key: string; w: number }[] = [
  { key: 'date', w: 16 },
  { key: 'day', w: 10 },
  { key: 'amIn', w: 17 },
  { key: 'amOut', w: 17 },
  { key: 'pmIn', w: 17 },
  { key: 'pmOut', w: 17 },
  { key: 'otIn', w: 15 },
  { key: 'otOut', w: 15 },
  { key: 'total', w: 16 },
  { key: 'idle', w: 13 },
  { key: 'idleReason', w: 40 },
  { key: 'weatherAm', w: 38 },
  { key: 'weatherPm', w: 38 },
  { key: 'initial', w: 12 },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// ponytail: truncates by character count, not measured width; fine for
// the Arial sizes used here, measure text if names start clipping.
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function text(x: number, y: number, s: string, size: number, opts: { bold?: boolean; anchor?: 'start' | 'middle' | 'end'; fill?: string } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" ${opts.bold ? 'font-weight="700"' : ''} text-anchor="${opts.anchor ?? 'start'}" fill="${opts.fill ?? INK}">${esc(s)}</text>`;
}
const line = (x1: number, y1: number, x2: number, y2: number, w = 0.25, color = INK) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>`;
const rect = (x: number, y: number, w: number, h: number, sw = 0.25) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${INK}" stroke-width="${sw}"/>`;

// Open comb: a baseline with short ticks between digit slots.
function comb(cx: number, baseline: number, slots: number, slotW: number, colonAfter?: number) {
  const gap = colonAfter !== undefined ? 1.6 : 0;
  const width = slots * slotW + gap;
  let x = cx - width / 2;
  let out = '';
  for (let i = 0; i < slots; i++) {
    out += line(x + 0.3, baseline, x + slotW - 0.3, baseline, 0.3);
    out += line(x, baseline, x, baseline - 1.2, 0.2) + line(x + slotW, baseline, x + slotW, baseline - 1.2, 0.2);
    x += slotW;
    if (colonAfter === i) {
      out += text(x + gap / 2, baseline - 0.6, ':', 3.4, { anchor: 'middle', bold: true });
      x += gap;
    }
  }
  return out;
}

// Boxes centred under the option codes printed in header row 1, so a cell
// holds only its tick boxes (content = exactly N selection marks).
function tickGroup(x: number, y: number, width: number, count: number) {
  const slot = width / count;
  return Array.from({ length: count }, (_, i) => rect(x + i * slot + slot / 2 - 1.6, y - 3.2, 3.2, 3.2, 0.35)).join('');
}

function qrPath(payload: string, x: number, y: number, size: number) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = size / n;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) d += `M${(x + c * cell).toFixed(3)} ${(y + r * cell).toFixed(3)}h${cell.toFixed(3)}v${cell.toFixed(3)}h-${cell.toFixed(3)}z`;
    }
  }
  return `<path d="${d}" fill="${INK}"/>`;
}

function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStart}T00:00:00`);
    d.setDate(d.getDate() + i);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
}

// The QR carries the rental, unit and week only, never a tenant: the worker
// takes tenant_id from the capture's own row (RFC-1).
export function edtrSheetQrPayload(rentalId: string, equipmentId: string, weekStart: string): string {
  return `ARKI-EDTR2:${rentalId}:${equipmentId}:${weekStart}`;
}

export function buildEdtrSheetSvg(input: EdtrSheetInput): string {
  const { context, equipmentId, weekStart } = input;
  const machine = context?.equipment.find((e) => e.id === equipmentId) ?? context?.equipment[0];
  const dates = weekStart ? weekDates(weekStart) : [];
  const fmt = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
  const dayName = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const out: string[] = [];

  // Title block.
  out.push(text(M, 15, 'ALMARA', 7, { bold: true }));
  out.push(text(M, 21.5, 'EQUIPMENT DAILY TIME REPORT', 4.6, { bold: true }));
  out.push(text(M, 26.5, 'Form EDTR v2 · Times in 24-hour format (07:30, 13:00) · Tick ONE box per group', 2.4, { fill: MUTED }));
  out.push(line(M, 30.5, W - M, 30.5, 0.6));

  // Pre-printed header, the same 2 x 2 the paper form has always carried.
  const hx = 98;
  const hw = 158;
  const cw = hw / 2;
  const field = (x: number, y: number, label: string, value: string) =>
    rect(x, y, cw, 11) + text(x + 1.2, y + 3, label, 2.1, { bold: true, fill: MUTED }) + text(x + 1.2, y + 8.6, fit(value, 44), 3.3, { bold: true });
  const covered = dates.length ? `${fmt(dates[0]!)} - ${fmt(dates[6]!)}/${dates[6]!.slice(0, 4)}` : '';
  const eqpt = machine ? `${machine.type} · ${machine.model} · SN ${machine.serialNo}` : '';
  out.push(field(hx, 7, 'CHARGE TO', context?.chargeTo ?? ''));
  out.push(field(hx + cw, 7, 'EQPT. TYPE', eqpt));
  out.push(field(hx, 18, 'PROJECT LOCATION', context?.projectLocation ?? ''));
  out.push(field(hx + cw, 18, 'DATE COVERED', covered));

  // QR, or the blank-sheet note in its place.
  const qx = W - M - 23;
  if (context && machine && weekStart) {
    out.push(qrPath(edtrSheetQrPayload(context.rentalId, machine.id, weekStart), qx, 6.5, 23));
  } else {
    out.push(`<rect x="${qx}" y="6.5" width="23" height="23" fill="none" stroke="${MUTED}" stroke-width="0.3" stroke-dasharray="1 1"/>`);
    out.push(text(qx + 11.5, 17, 'BLANK SHEET', 2.2, { anchor: 'middle', bold: true, fill: MUTED }));
    out.push(text(qx + 11.5, 20.5, 'fill header by hand', 1.9, { anchor: 'middle', fill: MUTED }));
  }

  // Timesheet grid.
  const tx = M;
  const ty = 34;
  const r0 = 7;
  const r1 = 6;
  const rowH = 15.4;
  const xs: number[] = [];
  COLUMNS.reduce((x, c) => (xs.push(x), x + c.w), tx);
  const colX = (key: string) => xs[COLUMNS.findIndex((c) => c.key === key)]!;
  const colW = (key: string) => COLUMNS.find((c) => c.key === key)!.w;
  const tableW = COLUMNS.reduce((s, c) => s + c.w, 0);
  const tableH = r0 + r1 + rowH * 7;
  const center = (key: string, span = 1) => colX(key) + COLUMNS.slice(COLUMNS.findIndex((c) => c.key === key), COLUMNS.findIndex((c) => c.key === key) + span).reduce((s, c) => s + c.w, 0) / 2;

  // Header rows: spanning group labels over IN/OUT, singles over both rows.
  const single = ['date', 'day', 'total', 'idle', 'initial'];
  const labels: Record<string, string> = { date: 'DATE', day: 'DAY', total: 'TOTAL HOURS', idle: 'IDLE HRS', initial: 'INITIAL' };
  for (const key of single) {
    const words = labels[key]!.split(' ');
    words.forEach((w, i) => out.push(text(center(key), ty + (r0 + r1) / 2 + 1 + (i - (words.length - 1) / 2) * 3, w, 2.6, { anchor: 'middle', bold: true })));
  }
  for (const [key, label] of [['amIn', 'AM'], ['pmIn', 'PM'], ['otIn', 'OVERTIME']] as const) {
    out.push(text(center(key, 2), ty + 4.9, label, 2.8, { anchor: 'middle', bold: true }));
    out.push(line(colX(key), ty + r0, colX(key) + colW(key) * 2, ty + r0));
    const outKey = key.replace('In', 'Out');
    out.push(text(center(key), ty + r0 + 4.2, 'IN', 2.4, { anchor: 'middle', bold: true }));
    out.push(text(center(outKey), ty + r0 + 4.2, 'OUT', 2.4, { anchor: 'middle', bold: true }));
  }
  for (const [key, label, codes] of [
    ['idleReason', 'IDLE REASON', IDLE_LABELS],
    ['weatherAm', 'WEATHER AM', WEATHER_CODES as readonly string[]],
    ['weatherPm', 'WEATHER PM', WEATHER_CODES as readonly string[]],
  ] as const) {
    out.push(text(center(key), ty + 4.9, label, 2.8, { anchor: 'middle', bold: true }));
    out.push(line(colX(key), ty + r0, colX(key) + colW(key), ty + r0));
    const slot = colW(key) / codes.length;
    codes.forEach((code, i) => out.push(text(colX(key) + i * slot + slot / 2, ty + r0 + 4.2, code, 2.3, { anchor: 'middle', bold: true })));
  }

  // Data rows, one per day of the covered week.
  const rowsTop = ty + r0 + r1;
  for (let r = 0; r < 7; r++) {
    const y = rowsTop + r * rowH;
    const base = y + rowH - 3.2;
    if (dates[r]) {
      out.push(text(center('date'), base - 0.6, fmt(dates[r]!), 3.4, { anchor: 'middle', bold: true }));
      out.push(text(center('day'), base - 0.6, dayName(dates[r]!), 2.5, { anchor: 'middle', fill: MUTED }));
    }
    for (const key of ['amIn', 'amOut', 'pmIn', 'pmOut', 'otIn', 'otOut']) out.push(comb(center(key), base, 4, 3, 1));
    out.push(comb(center('total'), base, 3, 3.4));
    out.push(comb(center('idle'), base, 2, 3.4));
    out.push(tickGroup(colX('idleReason'), base, colW('idleReason'), IDLE_LABELS.length));
    out.push(tickGroup(colX('weatherAm'), base, colW('weatherAm'), WEATHER_CODES.length));
    out.push(tickGroup(colX('weatherPm'), base, colW('weatherPm'), WEATHER_CODES.length));
    if (r > 0) out.push(line(tx, y, tx + tableW, y));
  }
  out.push(line(tx, rowsTop, tx + tableW, rowsTop, 0.45));
  // Column rules; group interiors start below the group label.
  COLUMNS.forEach((c, i) => {
    if (i === 0) return;
    const inner = ['amOut', 'pmOut', 'otOut'].includes(c.key);
    out.push(line(xs[i]!, inner ? ty + r0 : ty, xs[i]!, ty + tableH));
  });
  out.push(rect(tx, ty, tableW, tableH, 0.6));

  // Below the grid: the handwritten week total (a cross-check only; the
  // system recomputes), then the code legend.
  let y = ty + tableH + 6;
  out.push(text(M, y, 'WEEK TOTAL HOURS (cross-check)', 2.6, { bold: true }));
  out.push(line(M + 50, y + 0.6, M + 80, y + 0.6, 0.3));
  out.push(text(W - M, y, 'Idle hours = equipment on site but not working. Tick the reason for any idle hours.', 2.2, { anchor: 'end', fill: MUTED }));
  y += 5;
  out.push(text(M, y, 'WEATHER (tick one per half-day):  C Clear/Sunny  ·  O Cloudy/Overcast  ·  LR Light rain, work continued  ·  HR Heavy rain  ·  W Strong wind  ·  T Storm/typhoon signal', 2.3));
  y += 4;
  out.push(text(M, y, 'IDLE REASON:  Wx Weather  ·  Brk Breakdown  ·  NoOp No operator  ·  Hold Client hold  ·  Oth Other', 2.3));

  // Signatures: the timekeeper (Almara staff) attests the weather.
  const sy = y + 5;
  const sw = (W - 2 * M - 8) / 3;
  const blocks = [
    ['OPERATOR', 'Printed name', 'Signature'],
    ['TIMEKEEPER · ALMARA (attests the weather)', 'Printed name', 'Signature'],
    ['CERTIFIED CORRECT · CLIENT SITE ENGINEER', 'Printed name', 'Signature and signed on'],
  ];
  blocks.forEach(([title, a, b], i) => {
    const x = M + i * (sw + 4);
    out.push(rect(x, sy, sw, 26, 0.3));
    out.push(text(x + 1.5, sy + 4, title!, 2.4, { bold: true }));
    out.push(line(x + 1.5, sy + 13, x + sw - 1.5, sy + 13, 0.25, MUTED));
    out.push(text(x + 1.5, sy + 15.6, a!, 2, { fill: MUTED }));
    out.push(line(x + 1.5, sy + 22, x + sw - 1.5, sy + 22, 0.25, MUTED));
    out.push(text(x + 1.5, sy + 24.6, b!, 2, { fill: MUTED }));
  });

  const ref = context ? `Ref ${context.rentalId.slice(0, 8).toUpperCase()}${machine ? ` · Unit SN ${machine.serialNo}` : ''}` : 'Blank sheet';
  out.push(text(M, H - 4, `${ref} · Printed ${new Date().toISOString().slice(0, 10)} · One sheet per unit per week`, 2, { fill: MUTED }));
  out.push(text(W - M, H - 4, 'Almara Construction · Quezon City', 2, { anchor: 'end', fill: MUTED }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${out.join('')}</svg>`;
}

// 300 dpi: what Azure DI reads handwriting best from.
const DPI = 300;

export async function svgToPng(svg: string): Promise<Blob> {
  const width = Math.round((W / 25.4) * DPI);
  const height = Math.round((H / 25.4) * DPI);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'));
}

export async function pngToPdf(png: Blob): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Equipment Daily Time Report');
  pdf.setCreator('Almara');
  const image = await pdf.embedPng(await png.arrayBuffer());
  const page = pdf.addPage([841.89, 595.28]); // A4 landscape, points
  page.drawImage(image, { x: 0, y: 0, width: 841.89, height: 595.28 });
  const bytes = await pdf.save();
  return new Blob([bytes.slice().buffer], { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function edtrSheetFilename(input: EdtrSheetInput, ext: 'pdf' | 'png'): string {
  if (!input.context) return `edtr-v2-blank.${ext}`;
  const unit = input.context.equipment.find((e) => e.id === input.equipmentId)?.serialNo ?? 'unit';
  return `edtr-v2-${input.context.rentalId.slice(0, 8)}-${unit}-${input.weekStart ?? 'week'}.${ext}`.replace(/[^\w.-]+/g, '-');
}
