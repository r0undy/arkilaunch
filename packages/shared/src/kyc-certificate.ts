import { spanConfidence, type DocumentText, type ExtractedField } from './document-intelligence-port.js';
import { normalizeSecNumber, normalizeTin, SEC_REGEX, TIN_REGEX } from './kyc.js';

// Anchored on printed labels: queryFields alone read the SEC letterhead address and the RCC effectivity date as the company's.

export type CertificateLayout = 'sec_coi' | 'bir_2303';
export type CertificateFieldKey = 'company_name' | 'sec_number' | 'tin' | 'registered_address' | 'registration_date';

export interface CertificateParse {
  layout: CertificateLayout | null;
  fields: Partial<Record<CertificateFieldKey, ExtractedField>>;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

const MONTH_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?/i;
const MONTH_PREFIXES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

export function yearFromWords(text: string): number | null {
  const words: string[] = [];
  for (const t of text.toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
    if (t in UNITS || t in TENS || t === 'hundred' || t === 'thousand' || t === 'and') words.push(t);
    else if (words.length > 0) break;
  }
  if (words.length === 0) return null;
  if (words.includes('hundred') || words.includes('thousand')) {
    let total = 0;
    let current = 0;
    for (const w of words) {
      if (w === 'and') continue;
      if (w === 'hundred') current *= 100;
      else if (w === 'thousand') {
        total += current * 1000;
        current = 0;
      } else current += UNITS[w] ?? TENS[w] ?? 0;
    }
    return total + current;
  }
  const groups: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === 'and') continue;
    if (w in TENS) {
      const next = words[i + 1];
      const unit = next !== undefined ? UNITS[next] : undefined;
      if (unit !== undefined && unit > 0 && unit < 10) {
        groups.push(TENS[w]! + unit);
        i++;
      } else groups.push(TENS[w]!);
    } else groups.push(UNITS[w]!);
  }
  return groups.length === 2 ? groups[0]! * 100 + groups[1]! : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function isoIfValid(y: number, m: number, d: number, today: Date): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1936 || date.getTime() > today.getTime()) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseCertificateDate(raw: string, today: Date = new Date()): string | null {
  const s = clean(raw);
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return isoIfValid(+m[1]!, +m[2]!, +m[3]!, today);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) {
    let [month, day] = [+m[1]!, +m[2]!];
    if (month > 12 && day <= 12) [month, day] = [day, month];
    return isoIfValid(+m[3]!, month, day, today);
  }
  const month = MONTH_RE.exec(s);
  if (!month) return null;
  const monthIndex = MONTH_PREFIXES.indexOf(month[1]!.slice(0, 3).toLowerCase()) + 1;
  const before = s.slice(0, month.index);
  const after = s.slice(month.index + month[0].length);
  const dayBefore = /(\d{1,2})\s*(?:st|nd|rd|th)?\b\D*$/i.exec(before);
  const dayAfter = /^\D*?\b(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(after);
  const day = dayBefore ? +dayBefore[1]! : dayAfter ? +dayAfter[1]! : NaN;
  const digits = /\b(\d{4})\b/.exec(after);
  const year = digits ? +digits[1]! : yearFromWords(after);
  return year === null ? null : isoIfValid(year, monthIndex, day, today);
}

const SEC_HEADER = /SECURITIES\s+AND\s+EXCHANGE\s+COMMISSION/i;
const SEC_REG_LABEL = /\b(?:COMPANY|SEC)\s+REG(?:ISTRATION)?\s*\.?\s*(?:NO|NUMBER)\s*\.?\s*:?/i;
const SEC_TITLE = /CERTIFICATE\s+OF\s+(?:INCORPORATION|REGISTRATION|RECORDING|FILING)/i;
const WATERMARK_LINE = /^\W*(?:SAMPLE|SPECIMEN)\W*T?\W*(?:ONLY|COPY)?\W*$/i;

interface Piece {
  value: string;
  start: number;
  end: number;
}

function secNumber(content: string): Piece | null {
  const label = SEC_REG_LABEL.exec(content);
  if (label) {
    const from = label.index + label[0].length;
    const lineEnd = content.indexOf('\n', from);
    const rest = content.slice(from, lineEnd === -1 ? undefined : lineEnd);
    const tokens = [...rest.matchAll(/[A-Za-z0-9]+(?:\s*-\s*[A-Za-z0-9]+)*/g)];
    let best: Piece | null = null;
    for (let i = 0; i < Math.min(tokens.length, 3); i++) {
      for (let j = i; j < Math.min(tokens.length, i + 3); j++) {
        const value = normalizeSecNumber(tokens.slice(i, j + 1).map((t) => t[0]).join(''));
        if (!SEC_REGEX.test(value)) continue;
        const start = from + tokens[i]!.index!;
        const end = from + tokens[j]!.index! + tokens[j]![0].length;
        if (!best || value.length > best.value.length) best = { value, start, end };
      }
      if (best) break;
    }
    if (best) return best;
  }
  const found = [...content.matchAll(/\b(?:\d{13}\s*-\s*\d{2}|C[SN]\d{9})\b/g)];
  const distinct = new Set(found.map((f) => normalizeSecNumber(f[0])));
  if (distinct.size !== 1) return null;
  const f = found[0]!;
  return { value: normalizeSecNumber(f[0]), start: f.index!, end: f.index! + f[0].length };
}

function secCompanyName(content: string): Piece[] | null {
  const anchor =
    /Articles\s+of\s+(?:Incorporation|Partnership)(?:\s+and\s+By[\s-]*Laws)?(?:\s+of\b)?\s*:?/i.exec(content);
  if (!anchor) return null;
  const from = anchor.index + anchor[0].length;
  const tail = content.slice(from, from + 400);
  const stop = /\bDOING\s+BUSINESS\s+UNDER\b|\bwere\s+duly\b|\bwas\s+duly\b|\bhas\s+been\s+duly\b/i.exec(tail);
  if (!stop) return null;
  const pieces: Piece[] = [];
  let at = from;
  for (const line of tail.slice(0, stop.index).split('\n')) {
    const lead = line.length - line.trimStart().length;
    const value = line.trim();
    if (value && !WATERMARK_LINE.test(value)) pieces.push({ value, start: at + lead, end: at + lead + value.length });
    at += line.length + 1;
  }
  const name = clean(pieces.map((p) => p.value).join(' '));
  return /[A-Za-z]{2}/.test(name) && name.length <= 200 ? pieces : null;
}

// Only the IN WITNESS WHEREOF clause dates the certificate.
function secDate(content: string, today: Date): { iso: string; piece: Piece } | null {
  const witness = /IN\s+WITNESS\s+WHEREOF/i.exec(content);
  if (!witness) return null;
  const tail = content.slice(witness.index, witness.index + 700);
  const clause = /\bthis\s+((?:\d{1,2}\s*(?:st|nd|rd|th)?\s+)?day\s+of\s+[^.\n]{3,80})/i.exec(tail);
  if (!clause) return null;
  const iso = parseCertificateDate(clause[1]!, today);
  if (!iso) return null;
  const start = witness.index + clause.index + clause[0].length - clause[1]!.length;
  return { iso, piece: { value: clause[1]!, start, end: start + clause[1]!.length } };
}

function parseSec(text: DocumentText, today: Date): CertificateParse {
  const { content, words } = text;
  if (!SEC_HEADER.test(content) || !(SEC_REG_LABEL.test(content) || SEC_TITLE.test(content))) {
    return { layout: null, fields: {} };
  }
  const conf = (pieces: Piece[]) => Math.min(...pieces.map((p) => spanConfidence(words, p.start, p.end)));
  const fields: CertificateParse['fields'] = {};
  const number = secNumber(content);
  if (number) fields.sec_number = { value: number.value, confidence: conf([number]) };
  const name = secCompanyName(content);
  if (name) fields.company_name = { value: clean(name.map((p) => p.value).join(' ')), confidence: conf(name) };
  const date = secDate(content, today);
  if (date) fields.registration_date = { value: date.iso, confidence: conf([date.piece]) };
  return { layout: 'sec_coi', fields };
}

const BIR_HEADER = /RENTAS\s+INTERNAS|INTERNAL\s+REVENUE|\bBIR\b/i;
const BIR_TITLE = /CERTIFICATE\s+OF\s+REGISTRATION|\b2303\b/;

// Order matters where one label is a prefix of another.
const LABELS = {
  tinDate: /^TIN\s+ISSUANCE\s+DATE\b/i,
  tin: /^TIN(?:\s*(?:&|AND)\s*BRANCH\s+CODE)?\b/i,
  tradeName: /^TRADE\s+NAME(?:\s*\d)?\b/i,
  name: /^NAME(?:\s+OF\s+TAXPAYER)?\b/i,
  regDate: /^REGISTRATION\s+DATE\b/i,
  address: /^REGISTERED\s+ADDRESS\b/i,
  taxpayerType: /^TAXPAYER\s+TYPE(?:\/S|S)?\b/i,
  other:
    /^(?:REGISTERING\s+OFFICE|REGISTERED\s+ACTIVIT|TAX\s+TYPES?\b|FORM\s+TYPES?|FILING\b|LINE\s+OF\s+BUSINESS|\(PSIC\)|PSIC\b|CATEGORY\b|BUSINESS\s+INFORMATION|REMINDERS\b|OCN\b|DATE\s+OCN|REVENUE\s+(?:REGION|DISTRICT))/i,
} as const;
type LabelKind = keyof typeof LABELS;

const WATERMARK_WORDS = /^(?:\W*(?:BUREAU|OF|INTERNAL|INTERN\w*|REVENUE|REVEN\w*|BIR)\W*)+$/i;

interface Box {
  text: string;
  start: number;
  end: number;
  page: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  label: LabelKind | null;
  labelLength: number;
}

function labelOf(text: string): [LabelKind | null, number] {
  for (const kind of Object.keys(LABELS) as LabelKind[]) {
    const m = LABELS[kind].exec(text);
    if (m) return [kind, m[0].length];
  }
  return [null, 0];
}

function boxes(text: DocumentText): Box[] {
  // Shear out the page tilt (median slope of line tops) so "the same row" stays true.
  const slopes = text.lines
    .map((l) => (l.polygon[3]! - l.polygon[1]!) / (l.polygon[2]! - l.polygon[0]! || 1))
    .sort((a, b) => a - b);
  const slope = slopes.length ? slopes[Math.floor(slopes.length / 2)]! : 0;
  return text.lines.map((l) => {
    const xs = l.polygon.filter((_, i) => i % 2 === 0);
    const ys = l.polygon.filter((_, i) => i % 2 === 1).map((y, i) => y - slope * xs[i]!);
    const lineText = text.content.slice(l.offset, l.offset + l.length);
    const [label, labelLength] = labelOf(lineText.trim());
    return {
      text: lineText,
      start: l.offset,
      end: l.offset + l.length,
      page: l.page,
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
      label,
      labelLength,
    };
  });
}

// 'row' stops at the next label anywhere below; 'column' only at the next label in its column (first match wins).
function valuesOf(label: Box, all: Box[], reach: 'row' | 'column'): Piece[] {
  const h = label.y1 - label.y0;
  const centre = (b: Box) => (b.y0 + b.y1) / 2;
  const samePage = all.filter((b) => b.page === label.page && b !== label);
  const sameRow = (b: Box) => Math.abs(centre(b) - centre(label)) < 0.75 * Math.max(h, b.y1 - b.y0);
  const right = samePage.filter((b) => sameRow(b) && b.x0 >= label.x1 - 0.01).sort((a, b) => a.x0 - b.x0);
  const cellRight = right.find((b) => b.label)?.x0 ?? 1;
  const inColumn = (b: Box) => b.x1 > label.x0 - 0.01 && b.x0 < cellRight;
  const nextRowY = Math.min(
    1,
    ...samePage
      .filter((b) => b.label && b.y0 > label.y1 - 0.25 * h && (reach === 'row' || inColumn(b)))
      .map((b) => b.y0),
  );

  const out: Piece[] = [];
  const inline = label.text.trim().slice(label.labelLength).replace(/^[\s:.-]+/, '');
  if (inline) {
    const start = label.end - inline.length;
    out.push({ value: inline, start, end: label.end });
  }
  const beside = right[0];
  if (beside && !beside.label && beside.x0 < cellRight) out.push({ value: beside.text, start: beside.start, end: beside.end });
  for (const b of samePage
    .filter((b) => !b.label && b !== beside && b.y0 > label.y0 + 0.5 * h && b.y0 < nextRowY && inColumn(b))
    .sort((a, b) => a.y0 - b.y0)) {
    out.push({ value: b.text, start: b.start, end: b.end });
  }
  return out.filter((p) => !WATERMARK_WORDS.test(p.value.trim()));
}

// O/D -> 0 and I/l -> 1 is only safe between digits.
const repairDigits = (s: string) => s.replace(/(?<=\d[\s-]?)[OoD](?=[\s-]?\d)/g, '0').replace(/(?<=\d[\s-]?)[Il|](?=[\s-]?\d)/g, '1');
const TIN_TOKEN = /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}(?:[-\s]?(?:\d{5}|\d{3}))?\b(?![-\s]?\d)/;
const isPlaceholderTin = (tin: string) => /^0{3}-0{3}-0{3}/.test(tin);

function tinIn(piece: Piece): Piece | null {
  const m = TIN_TOKEN.exec(repairDigits(piece.value));
  if (!m) return null;
  const value = normalizeTin(m[0]);
  if (!TIN_REGEX.test(value) || isPlaceholderTin(value)) return null;
  return { value, start: piece.start + m.index, end: piece.start + m.index + m[0].length };
}

const hasWords = (s: string) => /[A-Za-z]{2}/.test(s);
const isTinOrDate = (s: string) => TIN_TOKEN.test(s) || /\d{1,2}\/\d{1,2}\/\d{4}/.test(s);

const ORG_SUFFIX =
  /\b(?:INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|OPC|PARTNERSHIP|COOPERATIVE|FOUNDATION|ASSOCIATION)\b\.?/i;
const INDIVIDUAL_TYPE = /PROPRIETOR|INDIVIDUAL|INCOME\s+EARNER|PROFESSIONAL/i;

function parseBir(text: DocumentText, today: Date): CertificateParse {
  const { content, words } = text;
  if (SEC_HEADER.test(content) || !BIR_HEADER.test(content) || !BIR_TITLE.test(content)) {
    return { layout: null, fields: {} };
  }
  const all = boxes(text);
  const values = (kind: LabelKind, reach: 'row' | 'column') => {
    const label = all.find((b) => b.label === kind);
    return label ? valuesOf(label, all, reach) : [];
  };
  const conf = (p: Piece) => spanConfidence(words, p.start, p.end);
  const confAll = (ps: Piece[]) => Math.min(...ps.map(conf));
  const fields: CertificateParse['fields'] = {};

  let tin: Piece | null = null;
  for (const p of values('tin', 'column')) if ((tin = tinIn(p))) break;
  if (!tin) {
    const found = [...repairDigits(content).matchAll(/\b\d{3}-\d{3}-\d{3}(?:-\d{5}|-\d{3})?\b(?!-?\d)/g)].filter(
      (f) => !isPlaceholderTin(f[0]),
    );
    if (new Set(found.map((f) => f[0])).size === 1) {
      const f = found[0]!;
      tin = { value: normalizeTin(f[0]), start: f.index!, end: f.index! + f[0].length };
    }
  }
  if (tin) fields.tin = { value: tin.value, confidence: conf(tin) };

  const registrant = values('name', 'row').filter((p) => hasWords(p.value) && !isTinOrDate(p.value));
  const registrantName = clean(registrant.map((p) => p.value).join(' '));
  const trade = values('tradeName', 'row').find(
    (p) =>
      hasWords(p.value) &&
      !/^\s*\d{4}\b/.test(p.value) &&
      clean(p.value) !== '-' &&
      !isTinOrDate(p.value) &&
      !parseCertificateDate(p.value, today),
  );
  const taxpayerType = values('taxpayerType', 'row').map((p) => p.value).join(' ');
  const individual =
    INDIVIDUAL_TYPE.test(taxpayerType) || (registrantName.includes(',') && !ORG_SUFFIX.test(registrantName));
  if (individual && trade) fields.company_name = { value: clean(trade.value), confidence: conf(trade) };
  else if (registrant.length) fields.company_name = { value: registrantName, confidence: confAll(registrant) };

  const address = values('address', 'row').filter((p) => hasWords(p.value) || /\d/.test(p.value));
  if (address.length) {
    fields.registered_address = {
      value: clean(address.map((p) => clean(p.value).replace(/,$/, '')).join(', ')),
      confidence: confAll(address),
    };
  }

  for (const p of values('regDate', 'column')) {
    const iso = parseCertificateDate(p.value, today);
    if (iso) {
      fields.registration_date = { value: iso, confidence: conf(p) };
      break;
    }
  }
  return { layout: 'bir_2303', fields };
}

export function parseRegistrationCertificate(
  documentType: string,
  text: DocumentText,
  today: Date = new Date(),
): CertificateParse {
  if (documentType === 'sec_certificate') return parseSec(text, today);
  if (documentType === 'bir_cor') return parseBir(text, today);
  return { layout: null, fields: {} };
}
