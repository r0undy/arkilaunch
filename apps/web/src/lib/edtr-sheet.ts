import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { WEATHER_CODES, manilaDate, type EdtrSheetContext } from '@arkilaunch/shared';

// The layout is the OCR contract (parseEdtrSheet in packages/shared): keep the header labels, only a date in DATE
// cells, no totals row in the table, open comb underlines (DI reads closed boxes as ticks), black-ink grid.

export type PageSize = 'letter' | 'legal';

// One constant drives SVG, PNG and PDF sizes; changing one alone stretches the scan.
export const PAGE: Record<PageSize, { w: number; h: number; label: string }> = {
  letter: { w: 279.4, h: 215.9, label: 'Letter 11 x 8.5 in' },
  legal: { w: 355.6, h: 215.9, label: 'Legal 14 x 8.5 in' },
};

const MM_TO_PT = 72 / 25.4;

export interface EdtrSheetInput {
  context?: EdtrSheetContext;
  equipmentId?: string;
  weekStart?: string;
  companyName?: string;
  page?: PageSize;
  logoDataUri?: string | null;
  accent?: string | null;
  tin?: string | null;
}

const M = 8;
const INK = '#111111';
const MUTED = '#555555';
const AMBER = '#d97706';
const FONT = 'Arial, Helvetica, sans-serif';

const COLUMNS: { key: string; w: number; label?: string }[] = [
  { key: 'date', w: 14, label: 'DATE' },
  { key: 'day', w: 11, label: 'DAY' },
  { key: 'amIn', w: 13 },
  { key: 'amOut', w: 13 },
  { key: 'pmIn', w: 13 },
  { key: 'pmOut', w: 13 },
  { key: 'otIn', w: 12 },
  { key: 'otOut', w: 12 },
  { key: 'total', w: 13, label: 'TOTAL HOURS' },
  { key: 'running', w: 13, label: 'RUNNING HRS' },
  { key: 'idle', w: 12, label: 'IDLE HRS' },
  { key: 'breakdown', w: 15, label: 'BREAKDOWN HRS' },
  { key: 'weatherHrs', w: 13, label: 'WEATHER HRS' },
  { key: 'other', w: 12, label: 'OTHER HRS' },
  { key: 'meterStart', w: 22, label: 'METER START' },
  { key: 'meterEnd', w: 22, label: 'METER END' },
  { key: 'weatherAm', w: 27 },
  { key: 'weatherPm', w: 27 },
  { key: 'initial', w: 11, label: 'INITIAL' },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// ponytail: truncates by character count, not measured width; measure text if names start clipping.
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function text(
  x: number,
  y: number,
  s: string,
  size: number,
  opts: { bold?: boolean; anchor?: 'start' | 'middle' | 'end'; fill?: string; mono?: boolean } = {},
) {
  const family = opts.mono ? "'Courier New', monospace" : FONT;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" ${opts.bold ? 'font-weight="700"' : ''} text-anchor="${opts.anchor ?? 'start'}" fill="${opts.fill ?? INK}">${esc(s)}</text>`;
}
const line = (x1: number, y1: number, x2: number, y2: number, w = 0.25, color = INK) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>`;
const rect = (x: number, y: number, w: number, h: number, sw = 0.25, color = INK) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;

function comb(cx: number, baseline: number, slots: number, slotW: number, colonAfter?: number, dotAfter?: number) {
  const gap = colonAfter !== undefined || dotAfter !== undefined ? 1.6 : 0;
  const width = slots * slotW + gap;
  let x = cx - width / 2;
  let out = '';
  for (let i = 0; i < slots; i++) {
    out += line(x + 0.3, baseline, x + slotW - 0.3, baseline, 0.3);
    out += line(x, baseline, x, baseline - 1.2, 0.2) + line(x + slotW, baseline, x + slotW, baseline - 1.2, 0.2);
    x += slotW;
    if (colonAfter === i || dotAfter === i) {
      out += text(x + gap / 2, baseline - 0.6, colonAfter === i ? ':' : '.', 3.4, { anchor: 'middle', bold: true });
      x += gap;
    }
  }
  return out;
}

// A cell must hold only its tick boxes: DI expects exactly N selection marks.
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
    const d = new Date(`${weekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

// Never put a tenant in the QR: the worker takes tenant_id from the capture's own row.
export function edtrSheetQrPayload(rentalId: string, equipmentId: string, weekStart: string): string {
  return `ARKI-EDTR3:${rentalId}:${equipmentId}:${weekStart}`;
}

export function buildEdtrSheetSvg(input: EdtrSheetInput): string {
  const { context, equipmentId, weekStart } = input;
  const page = PAGE[input.page ?? 'legal'];
  const W = page.w;
  const H = page.h;
  const machine = context?.equipment.find((e) => e.id === equipmentId) ?? context?.equipment[0];
  const dates = weekStart ? weekDates(weekStart) : [];
  const fmt = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
  const dayName = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase();
  const tenantName = context?.tenant?.name ?? input.companyName ?? '';
  const spanStartIso = machine?.start ?? context?.rentalStart;
  const spanEndIso = machine?.start ? (machine.end ?? null) : (context?.rentalEnd ?? null);
  const spanFrom = spanStartIso ? manilaDate(spanStartIso) : null;
  const spanTo = spanEndIso ? manilaDate(spanEndIso) : null;
  const outside = (iso: string) => !!spanFrom && (iso < spanFrom || (spanTo !== null && iso > spanTo));
  const out: string[] = [];

  let lx = M;
  if (input.logoDataUri) {
    out.push(`<image x="${M}" y="6" width="24" height="24" preserveAspectRatio="xMidYMid meet" href="${esc(input.logoDataUri)}"/>`);
    lx = M + 27;
  }
  out.push(text(lx, 12, fit(tenantName.toUpperCase(), 44), 5, { bold: true }));
  if (context?.tenant?.address) out.push(text(lx, 17.5, fit(context.tenant.address, 70), 2.5, { fill: MUTED }));
  if (context?.tenant?.contact) out.push(text(lx, 21.5, fit(context.tenant.contact, 70), 2.5, { fill: MUTED }));
  if (input.tin) out.push(text(lx, 25.5, `TIN ${fit(input.tin, 30)}`, 2.5, { fill: MUTED }));
  out.push(text(W / 2, 17, 'EQUIPMENT DAILY TIME REPORT', 5.2, { bold: true, anchor: 'middle' }));
  const qx = W - M - 24;
  if (context && machine && weekStart) {
    out.push(qrPath(edtrSheetQrPayload(context.rentalId, machine.id, weekStart), qx, 5, 24));
    out.push(text(qx - 3, 14, context.bookingCode ?? '', 6, { bold: true, anchor: 'end', mono: true }));
    out.push(text(qx - 3, 19, 'BOOKING CODE', 2.2, { anchor: 'end', fill: MUTED }));
  } else {
    out.push(`<rect x="${qx}" y="5" width="24" height="24" fill="none" stroke="${MUTED}" stroke-width="0.3" stroke-dasharray="1 1"/>`);
    out.push(text(qx + 12, 16, 'BLANK SHEET', 2.2, { anchor: 'middle', bold: true, fill: MUTED }));
    out.push(text(qx + 12, 19.5, 'fill header by hand', 1.9, { anchor: 'middle', fill: MUTED }));
    out.push(rect(qx - 44, 8, 40, 10, 0.3));
    out.push(text(qx - 43, 11, 'BOOKING CODE', 2, { bold: true, fill: MUTED }));
  }
  out.push(line(M, 32, W - M, 32, 0.9, input.accent && /^#[0-9a-f]{6}$/i.test(input.accent) ? input.accent : AMBER));

  const fw = (W - 2 * M) / 4;
  const field = (i: number, y: number, label: string, value: string) =>
    rect(M + i * fw, y, fw, 10) +
    text(M + i * fw + 1.2, y + 2.9, label, 2.1, { bold: true, fill: MUTED }) +
    text(M + i * fw + 1.2, y + 8, fit(value, Math.floor(fw / 1.7)), 3.1, { bold: true });
  const covered = dates.length ? `${fmt(dates[0]!)} - ${fmt(dates[6]!)}/${dates[6]!.slice(0, 4)}` : '';
  const eqpt = machine ? `${machine.type} · ${machine.model} · SN ${machine.serialNo}` : '';
  const period = spanFrom ? `${shortDate(spanFrom)} – ${spanTo ? shortDate(spanTo) : 'open'}` : '';
  const meter = machine?.lastHourMeter != null ? machine.lastHourMeter.toFixed(1) : '';
  out.push(field(0, 34, 'CHARGE TO', context?.chargeTo ?? ''));
  out.push(field(1, 34, 'EQPT. TYPE', eqpt));
  out.push(field(2, 34, 'PROJECT LOCATION', context?.projectLocation ?? ''));
  out.push(field(3, 34, 'DATE COVERED', covered));
  out.push(field(0, 44, 'OPERATOR', machine?.operatorName ?? ''));
  out.push(field(1, 44, 'CLIENT SITE REP', context?.siteRep ?? ''));
  out.push(field(2, 44, 'RENTAL PERIOD', period));
  out.push(field(3, 44, 'HOUR METER AT START OF WEEK', meter));

  out.push(
    text(
      M,
      58.5,
      'HOW TO FILL:  1. Write IN/OUT in 24-hour time (07:30, 13:00).   2. Split the day into RUNNING / IDLE / BREAKDOWN / WEATHER / OTHER.   3. Tick the weather for each half-day.   4. Read the hour meter at the start and end of the day.',
      2.4,
    ),
  );

  const tx = M;
  const ty = 61;
  const r0 = 8;
  const r1 = 6;
  const rowH = 10;
  const scale = (W - 2 * M) / COLUMNS.reduce((s, c) => s + c.w, 0);
  const cols = COLUMNS.map((c) => ({ ...c, w: c.w * scale }));
  const xs: number[] = [];
  cols.reduce((x, c) => (xs.push(x), x + c.w), tx);
  const idx = (key: string) => cols.findIndex((c) => c.key === key);
  const colX = (key: string) => xs[idx(key)]!;
  const colW = (key: string) => cols[idx(key)]!.w;
  const center = (key: string, span = 1) =>
    colX(key) + cols.slice(idx(key), idx(key) + span).reduce((s, c) => s + c.w, 0) / 2;
  const tableW = W - 2 * M;
  const tableH = r0 + r1 + rowH * 7;

  const fitSize = (word: string, width: number, max: number) => Math.min(max, (width - 1) / (word.length * 0.72));
  for (const c of cols) {
    if (!c.label) continue;
    const words = c.label.split(' ');
    const size = Math.min(...words.map((w) => fitSize(w, c.w, 2.4)));
    words.forEach((w, i) =>
      out.push(
        text(center(c.key), ty + (r0 + r1) / 2 + 1 + (i - (words.length - 1) / 2) * 2.9, w, size, { anchor: 'middle', bold: true }),
      ),
    );
  }
  for (const [key, label] of [
    ['amIn', 'AM'],
    ['pmIn', 'PM'],
    ['otIn', 'OVERTIME'],
  ] as const) {
    out.push(text(center(key, 2), ty + 5.2, label, 2.6, { anchor: 'middle', bold: true }));
    out.push(line(colX(key), ty + r0, colX(key) + colW(key) * 2, ty + r0));
    out.push(text(center(key), ty + r0 + 4.2, 'IN', 2.3, { anchor: 'middle', bold: true }));
    out.push(text(center(key.replace('In', 'Out')), ty + r0 + 4.2, 'OUT', 2.3, { anchor: 'middle', bold: true }));
  }
  for (const [key, label] of [
    ['weatherAm', 'WEATHER AM'],
    ['weatherPm', 'WEATHER PM'],
  ] as const) {
    out.push(text(center(key), ty + 5.2, label, 2.6, { anchor: 'middle', bold: true }));
    out.push(line(colX(key), ty + r0, colX(key) + colW(key), ty + r0));
    const slot = colW(key) / WEATHER_CODES.length;
    WEATHER_CODES.forEach((code, i) =>
      out.push(text(colX(key) + i * slot + slot / 2, ty + r0 + 4.2, code, 2.2, { anchor: 'middle', bold: true })),
    );
  }

  const rowsTop = ty + r0 + r1;
  const labels: string[] = [];
  for (let r = 0; r < 7; r++) {
    const y = rowsTop + r * rowH;
    const base = y + rowH - 2.8;
    const iso = dates[r];
    // Alternate-row tint keeps handwriting on its line; pale enough not to read as ink.
    if (r % 2 === 1 && !(iso && outside(iso))) out.push(`<rect x="${tx}" y="${y}" width="${tableW}" height="${rowH}" fill="#f3f3f3"/>`);
    if (iso) {
      out.push(text(center('date'), base - 0.6, fmt(iso), 3.3, { anchor: 'middle', bold: true }));
      if (outside(iso)) {
        // The date stays: the parser needs one in every DATE cell.
        out.push(text(center('day'), y + 4.6, 'OUTSIDE', 1.9, { anchor: 'middle', bold: true, fill: MUTED }));
        out.push(text(center('day'), y + 7.4, 'RENTAL', 1.9, { anchor: 'middle', bold: true, fill: MUTED }));
        const hx = colX('amIn');
        const hw = colX('initial') - hx;
        let hatch = '';
        for (let x = hx - rowH; x < hx + hw; x += 3) {
          const x1 = Math.max(hx, x);
          const x2 = Math.min(hx + hw, x + rowH);
          hatch += line(x1, y + rowH - (x1 - x), x2, y + rowH - (x2 - x), 0.15, '#cccccc');
        }
        out.push(hatch);
        // Drawn after the grid lines so no column rule strikes through it.
        labels.push(
          `<rect x="${hx + hw / 2 - 24}" y="${y + rowH / 2 - 2.4}" width="48" height="4.8" fill="#ffffff"/>` +
            text(hx + hw / 2, y + rowH / 2 + 1.1, 'OUTSIDE RENTAL — DO NOT FILL', 3, { anchor: 'middle', fill: '#999999' }),
        );
        if (r > 0) out.push(line(tx, y, tx + tableW, y));
        continue;
      }
      out.push(text(center('day'), base - 0.6, dayName(iso), 2.4, { anchor: 'middle', fill: MUTED }));
    }
    const slotFor = (key: string, slots: number, max: number) => Math.min(max, (colW(key) - 3.2) / slots);
    for (const key of ['amIn', 'amOut', 'pmIn', 'pmOut', 'otIn', 'otOut']) out.push(comb(center(key), base, 4, slotFor(key, 4, 3), 1));
    for (const key of ['total', 'running', 'idle', 'breakdown', 'weatherHrs', 'other']) {
      out.push(comb(center(key), base, 3, slotFor(key, 3, 3.2), undefined, 1));
    }
    out.push(comb(center('meterStart'), base, 6, slotFor('meterStart', 6, 2.6), undefined, 4));
    out.push(comb(center('meterEnd'), base, 6, slotFor('meterEnd', 6, 2.6), undefined, 4));
    out.push(tickGroup(colX('weatherAm'), base, colW('weatherAm'), WEATHER_CODES.length));
    out.push(tickGroup(colX('weatherPm'), base, colW('weatherPm'), WEATHER_CODES.length));
    if (r > 0) out.push(line(tx, y, tx + tableW, y));
  }
  out.push(line(tx, rowsTop, tx + tableW, rowsTop, 0.45));
  cols.forEach((c, i) => {
    if (i === 0) return;
    const inner = ['amOut', 'pmOut', 'otOut'].includes(c.key);
    out.push(line(xs[i]!, inner ? ty + r0 : ty, xs[i]!, ty + tableH));
  });
  out.push(rect(tx, ty, tableW, tableH, 0.6));
  out.push(...labels);
  out.push(
    text(
      M,
      ty + tableH + 4,
      'TOTAL = RUNNING + IDLE + BREAKDOWN + WEATHER + OTHER   ·   WEATHER: C Clear · O Cloudy · LR Light rain, work continued · HR Heavy rain · W Strong wind · T Storm/typhoon signal',
      2.3,
    ),
  );

  // Remarks and summary stay outside the table: the parser fails on a totals row.
  const ry = ty + tableH + 6;
  out.push(rect(M, ry, tableW, 10, 0.3));
  out.push(text(M + 1.5, ry + 3.4, 'REMARKS / DOWNTIME NOTES (e.g. Breakdown 13:00–15:00 · reason for OTHER HRS)', 2.2, { bold: true }));
  out.push(line(M + 1.5, ry + 8.6, M + tableW - 1.5, ry + 8.6, 0.2, MUTED));
  const by = ry + 12;
  const bw = (W - 2 * M - 4) / 2;
  const bh = 21;
  out.push(rect(M, by, bw, bh, 0.3));
  out.push(text(M + 1.5, by + 4, 'WEEK SUMMARY (cross-check; the system recomputes)', 2.4, { bold: true }));
  const sum = (y: number, label: string) =>
    text(M + 1.5, y, label, 2.4) + line(M + bw - 30, y + 0.6, M + bw - 3, y + 0.6, 0.3);
  out.push(sum(by + 9, 'Running + Idle = BILLABLE HOURS'));
  out.push(sum(by + 13.5, 'Breakdown + Weather + Other = NOT BILLED'));
  out.push(sum(by + 18, 'Hour meter end − start = METER HOURS'));
  const fx = M + bw + 4;
  out.push(rect(fx, by, bw, bh, 0.3));
  out.push(text(fx + 1.5, by + 4, 'WHAT YOU ARE BILLED FOR', 2.4, { bold: true }));
  out.push(text(fx + 1.5, by + 8.3, 'Billed: RUNNING + IDLE (machine ready on site, not used by your choice).', 2.3));
  out.push(text(fx + 1.5, by + 11.8, 'Not billed: BREAKDOWN, WEATHER stoppage, OTHER (e.g. no operator from us).', 2.3));
  out.push(text(fx + 1.5, by + 15.3, 'Downtime days may extend your rental period on request.', 2.3));
  out.push(text(fx + 1.5, by + 18.8, 'Hour meter readings are used for maintenance.', 2.3, { fill: MUTED }));

  const sy = by + bh + 2;
  const sw = (W - 2 * M - 9) / 4;
  // [title, subtitle, hint]: the subtitle gets its own line so the title is never shrunk or cut.
  const blocks = [
    ['OPERATOR', '', 'Printed name and signature'],
    [`TIMEKEEPER · ${tenantName.toUpperCase()}`, 'Attests hours and weather', 'Printed name and signature'],
    ['CERTIFIED CORRECT · CLIENT SITE REP', '', 'Name, signature and date'],
    ['OFFICE · VERIFIED / APPROVED BY', '', 'Name, signature and date'],
  ];
  blocks.forEach(([title, sub, hint], i) => {
    const x = M + i * (sw + 3);
    out.push(rect(x, sy, sw, H - sy - 8, 0.3));
    out.push(text(x + 1.5, sy + 3.6, fit(title!, Math.floor(sw / 1.45)), 2.2, { bold: true }));
    if (sub) out.push(text(x + 1.5, sy + 6.6, sub, 1.9, { fill: MUTED }));
    out.push(line(x + 1.5, H - 13.5, x + sw - 1.5, H - 13.5, 0.25, MUTED));
    out.push(text(x + 1.5, H - 11, hint!, 1.9, { fill: MUTED }));
  });

  const footer = [
    context?.bookingCode ?? 'Booking ______________',
    machine ? `Unit SN ${machine.serialNo}` : 'Unit SN ________',
    weekStart ? `Week of ${weekStart}` : 'Week of ________',
    `Printed ${manilaDate(new Date().toISOString())}`,
    'One sheet per unit per week',
  ].join(' · ');
  out.push(text(M, H - 3.5, footer, 2, { fill: MUTED }));
  out.push(text(W - M, H - 3.5, `Page: ${page.label}`, 2, { anchor: 'end', fill: MUTED }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${out.join('')}</svg>`;
}

// 300 dpi: what Azure DI reads handwriting best from.
const DPI = 300;

export async function svgToPng(svg: string, pageSize: PageSize = 'legal'): Promise<Blob> {
  const page = PAGE[pageSize];
  const width = Math.round((page.w / 25.4) * DPI);
  const height = Math.round((page.h / 25.4) * DPI);
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

export async function pngToPdf(png: Blob, pageSize: PageSize = 'legal'): Promise<Blob> {
  const page = PAGE[pageSize];
  const w = page.w * MM_TO_PT;
  const h = page.h * MM_TO_PT;
  const pdf = await PDFDocument.create();
  pdf.setTitle('Equipment Daily Time Report');
  pdf.setCreator('ArkiLaunch');
  const image = await pdf.embedPng(await png.arrayBuffer());
  const pdfPage = pdf.addPage([w, h]);
  pdfPage.drawImage(image, { x: 0, y: 0, width: w, height: h });
  const bytes = await pdf.save();
  return new Blob([bytes.slice().buffer], { type: 'application/pdf' });
}

export async function logoDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
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
  if (!input.context) return `edtr-v3-blank-${input.page ?? 'legal'}.${ext}`;
  const unit = input.context.equipment.find((e) => e.id === input.equipmentId)?.serialNo ?? 'unit';
  const ref = input.context.bookingCode ?? input.context.rentalId.slice(0, 8);
  return `edtr-v3-${ref}-${unit}-${input.weekStart ?? 'week'}.${ext}`.replace(/[^\w.-]+/g, '-');
}
