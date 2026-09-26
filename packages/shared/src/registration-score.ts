import { z } from 'zod';
import { hasRequiredCompanyDocuments, isPrimaryRegistration } from './customers.js';
import { PHILSYS_PCN_REGEX, SEC_REGEX, TIN_REGEX, normalizePcn, normalizeTin } from './kyc.js';

// Advisory confidence for a company registration under review
// (cr-arkilaunch-registration-scoring.md). Pure: the API adds the one fact
// only it can know (duplicates in the tenant) and the reviewer reads the
// result. It never approves or rejects; the staff decision stays the human
// gate (RFC-2 KYC path).

export interface ScoreDocument {
  documentType: string;
  confidence: number | null;
  // What the upload-time scan read, and what the customer confirmed.
  ocr: Record<string, string>;
  customer: Record<string, string>;
}

export interface ScoreInput {
  companyName: string;
  tin: string | null;
  secNumber: string | null;
  documents: ScoreDocument[];
  // Another company in this tenant already holds the same value.
  duplicates: { tin: boolean; pcn: boolean; mobile: boolean };
  // YYYY-MM-DD, for the age check.
  today: string;
}

export const REGISTRATION_CHECK_IDS = ['ocr_confidence', 'agreement', 'id_formats', 'dob', 'duplicates', 'doc_quality'] as const;
export type RegistrationCheckId = (typeof REGISTRATION_CHECK_IDS)[number];

export const RegistrationCheckSchema = z.object({
  id: z.enum(REGISTRATION_CHECK_IDS),
  label: z.string(),
  weight: z.number(),
  // 0..1 share of the weight earned.
  credit: z.number(),
  status: z.enum(['pass', 'warn', 'fail']),
  // A failed hard check caps the whole score at Low.
  hard: z.boolean(),
  reason: z.string(),
});
export type RegistrationCheck = z.infer<typeof RegistrationCheckSchema>;

export const RegistrationScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  band: z.enum(['high', 'medium', 'low']),
  checks: z.array(RegistrationCheckSchema),
});
export type RegistrationScore = z.infer<typeof RegistrationScoreSchema>;

export const SCORE_BANDS = { high: 85, medium: 60 } as const;

const alnum = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
// Case, spaces and dashes say nothing different.
export const sameValue = (a: string, b: string) => alnum(a) === alnum(b);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

// Token-sorted similarity for names and addresses: "Dela Cruz, Juan" and
// "JUAN DELA CRUZ" are the same person. 1 = identical.
export function nameSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join(' ');
  const x = norm(a);
  const y = norm(b);
  if (!x && !y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export const FUZZY_MATCH = 0.85;

const FUZZY_KEYS = new Set(['company_name', 'first_name', 'middle_name', 'last_name', 'address', 'registered_address']);

function ageOn(birth: string, today: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth.trim());
  if (!m) return null;
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function scoreRegistration(input: ScoreInput): RegistrationScore {
  const checks: RegistrationCheck[] = [];
  const doc = (type: string) => input.documents.find((d) => d.documentType === type);
  const registration = input.documents.find((d) => isPrimaryRegistration(d.documentType));
  const id = doc('government_id');
  const bir = doc('bir_cor');
  const sec = doc('sec_certificate');

  // 1. OCR field confidence.
  const confidences = input.documents.map((d) => d.confidence).filter((c): c is number => c !== null);
  const mean = confidences.length ? confidences.reduce((s, c) => s + c, 0) / confidences.length : null;
  checks.push({
    id: 'ocr_confidence',
    label: 'Scan read confidence',
    weight: 25,
    credit: mean === null ? 0.5 : clamp01((mean - 0.6) / 0.3),
    status: mean === null ? 'warn' : mean >= 0.9 ? 'pass' : mean >= 0.75 ? 'warn' : 'fail',
    hard: false,
    reason: mean === null ? 'No document was read by the scanner.' : `Average read confidence ${Math.round(mean * 100)}%.`,
  });

  // 2. What the customer typed against what the scan read.
  const pairs: { label: string; typed: string; scanned: string; key: string }[] = [];
  const add = (label: string, key: string, typed: string | null | undefined, scanned: string | undefined) => {
    if (typed && scanned) pairs.push({ label, key, typed, scanned });
  };
  add('Registered name', 'company_name', input.companyName, registration?.ocr.company_name);
  add('TIN', 'tin', input.tin, (bir ?? registration)?.ocr.tin);
  add('SEC number', 'sec_number', input.secNumber, sec?.ocr.sec_number);
  if (id) {
    for (const key of ['first_name', 'middle_name', 'last_name', 'id_number', 'birth_date', 'address']) {
      add(key.replace('_', ' '), key, id.customer[key], id.ocr[key]);
    }
  }
  const disagreeing = pairs.filter((p) =>
    FUZZY_KEYS.has(p.key) ? nameSimilarity(p.typed, p.scanned) < FUZZY_MATCH : !sameValue(p.typed, p.scanned),
  );
  checks.push({
    id: 'agreement',
    label: 'Typed details match the scans',
    weight: 25,
    credit: pairs.length ? 1 - disagreeing.length / pairs.length : 0.5,
    status: pairs.length === 0 ? 'warn' : disagreeing.length === 0 ? 'pass' : disagreeing.length === 1 ? 'warn' : 'fail',
    hard: false,
    reason:
      pairs.length === 0
        ? 'Nothing to compare: no scan read a typed field.'
        : disagreeing.length === 0
          ? `All ${pairs.length} compared fields agree.`
          : `Differs from the scan: ${disagreeing.map((p) => p.label).join(', ')}.`,
  });

  // 3. ID number formats (hard).
  const pcn = id ? (id.customer.id_number ?? id.ocr.id_number) : undefined;
  const invalid: string[] = [];
  if (input.tin && !TIN_REGEX.test(normalizeTin(input.tin))) invalid.push('TIN');
  if (input.secNumber && !SEC_REGEX.test(input.secNumber.trim())) invalid.push('SEC number');
  if (pcn && !PHILSYS_PCN_REGEX.test(normalizePcn(pcn))) invalid.push('PCN');
  const anyNumber = !!(input.tin || input.secNumber || pcn);
  checks.push({
    id: 'id_formats',
    label: 'ID number formats',
    weight: 20,
    credit: !anyNumber ? 0.5 : invalid.length ? 0 : 1,
    status: !anyNumber ? 'warn' : invalid.length ? 'fail' : 'pass',
    hard: invalid.length > 0,
    reason: !anyNumber
      ? 'No TIN, SEC number or PCN given.'
      : invalid.length
        ? `Not a valid format: ${invalid.join(', ')}.`
        : 'TIN, SEC number and PCN are well formed.',
  });

  // 4. Date of birth plausibility.
  const birth = id ? (id.customer.birth_date ?? id.ocr.birth_date) : undefined;
  const age = birth ? ageOn(birth, input.today) : null;
  const plausible = age !== null && age >= 18 && age <= 100;
  checks.push({
    id: 'dob',
    label: 'Applicant age',
    weight: 10,
    credit: age === null ? 0.5 : plausible ? 1 : 0,
    status: age === null ? 'warn' : plausible ? 'pass' : 'fail',
    hard: false,
    reason: age === null ? 'No readable date of birth.' : plausible ? `Age ${age}.` : `Age ${age} is outside 18 to 100.`,
  });

  // 5. Duplicates in this tenant (hard).
  const dups = [
    input.duplicates.tin && 'TIN',
    input.duplicates.pcn && 'PCN',
    input.duplicates.mobile && 'mobile number',
  ].filter(Boolean) as string[];
  checks.push({
    id: 'duplicates',
    label: 'Not already registered',
    weight: 10,
    credit: dups.length ? 0 : 1,
    status: dups.length ? 'fail' : 'pass',
    hard: dups.length > 0,
    reason: dups.length ? `Another company here uses the same ${dups.join(', ')}.` : 'No other company shares its TIN, PCN or mobile.',
  });

  // 6. Document quality.
  const complete = hasRequiredCompanyDocuments(input.documents);
  const weak = input.documents.filter((d) => d.confidence !== null && d.confidence < 0.7);
  checks.push({
    id: 'doc_quality',
    label: 'Documents complete and legible',
    weight: 10,
    credit: (complete ? 0.6 : 0) + (weak.length === 0 ? 0.4 : 0),
    status: complete && weak.length === 0 ? 'pass' : complete ? 'warn' : 'fail',
    hard: false,
    reason: !complete
      ? 'Missing the ID, the selfie with it, or a BIR 2303 / SEC certificate.'
      : weak.length
        ? `${weak.length} document${weak.length === 1 ? '' : 's'} read below 70%.`
        : 'All required documents present and legible.',
  });

  let score = Math.round(checks.reduce((s, c) => s + c.weight * clamp01(c.credit), 0));
  if (checks.some((c) => c.hard)) score = Math.min(score, SCORE_BANDS.medium - 1);
  const band = score >= SCORE_BANDS.high ? 'high' : score >= SCORE_BANDS.medium ? 'medium' : 'low';
  return { score, band, checks };
}
