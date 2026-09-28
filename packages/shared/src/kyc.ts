import { z } from 'zod';

// RFC-2 §3 KYC sub-flow (PRD-F6). File upload / Supabase Storage wiring is a
// follow-up, same as EDTR capture: accepts an already-uploaded file
// reference rather than a multipart body for now.
export const KycExtractRequestSchema = z.object({
  customerId: z.string().uuid(),
  documentType: z.string().min(1),
  fileUri: z.string().min(1),
});
export type KycExtractRequest = z.infer<typeof KycExtractRequestSchema>;

// POST /api/v1/kyc/extract wire contract (backend-unblock plan workstream
// 4): the client-facing fields, WITHOUT fileUri -- the document now arrives
// as a multipart `file` field, validated and uploaded to Supabase Storage
// by the controller (RFC-2 §6), which derives fileUri itself as the
// storage object key. A client can never supply fileUri directly.
export const KycExtractFieldsSchema = z.object({
  customerId: z.string().uuid(),
  documentType: z.string().min(1),
});
export type KycExtractFields = z.infer<typeof KycExtractFieldsSchema>;

// The human portal-confirmation step (RFC-2 §2 step 6). ORUS CAPTCHA blocks
// automation by design (scrutiny FC-11) -- this is always a human filling
// in what they saw on the SEC/BIR portals, never a scraped/automated value.
export const KycConfirmRequestSchema = z.object({
  registryStatus: z.enum(['active', 'suspended', 'revoked']),
  portalMatchScore: z.number().min(0).max(1),
});
export type KycConfirmRequest = z.infer<typeof KycConfirmRequestSchema>;

// RFC-2 §3 format checks. TIN's format is a stable BIR convention; the SEC
// registration number pattern is approximate here (exact format needs a
// CLR-level confirmation against current SEC issuance conventions) --
// flagged rather than asserted as authoritative.
// The branch code is 3 digits on older CORs and 5 on the ones BIR now
// issues (000-000-000-00000; eBIRForms widened it under RMC 36-2026).
export const TIN_REGEX = /^\d{3}-\d{3}-\d{3}(-\d{3}|-\d{5})?$/;
// SEC registration numbers as issued over the years: a letter prefix
// (A, AS, CS, CN, PG, ...) plus digits, optionally with a dash after the
// year digits (AS094-008814), or the eSPARC-era all-digit number with an
// optional -00 suffix (2021060012345-00).
// ponytail: prefix list is not exhaustive; widen only on a real rejected cert.
export const SEC_REGEX = /^(?:[A-Z]{1,3}\d{3}-?\d{4,9}|\d{10,13}(?:-\d{2})?)$/i;
// DTI Business Name registration number (BNRS certificate "Business Name
// No."), 6-10 digits, sometimes printed with a BN prefix.
// ponytail: checked against the BNRS sample layout only; tighten on real certs.
export const DTI_REGEX = /^(?:BN-?)?\d{6,10}$/i;
// PhilSys Card Number (PCN), the 16 digits printed on the National ID.
export const PHILSYS_PCN_REGEX = /^\d{4}-\d{4}-\d{4}-\d{4}$/;

// OCR and people both type these with spaces, no dashes or stray dashes.
// When the digit count matches, re-dash into the canonical groups; otherwise
// return the trimmed input untouched so the format check reports it.
function regroupDigits(value: string, groupings: number[][]): string {
  const digits = value.replace(/\D/g, '');
  const groups = groupings.find((g) => g.reduce((a, b) => a + b, 0) === digits.length);
  if (!groups) return value.trim();
  let at = 0;
  return groups.map((n) => digits.slice(at, (at += n))).join('-');
}
export const normalizeTin = (value: string) => regroupDigits(value, [[3, 3, 3], [3, 3, 3, 3], [3, 3, 3, 5]]);
export const normalizePcn = (value: string) => regroupDigits(value, [[4, 4, 4, 4]]);

// QA 15: the Philippine primary IDs a customer may verify with, not only
// the PhilSys National ID. The number format is checked per type; the
// same layout-plus-query read (model-registry.ts) serves every card.
// ponytail: formats are the numbers as printed on current cards; widen one
// on a real card that fails, never drop the check.
const upperAlnum = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
export interface PhIdType {
  label: string;
  numberLabel: string;
  placeholder: string;
  re: RegExp;
  normalize: (value: string) => string;
  // What the reviewer checks the card against.
  verifyHint: string;
}
export const PH_ID_TYPES = {
  philsys: {
    label: 'Philippine National ID (PhilSys) or ePhilID',
    numberLabel: 'PhilSys Card Number (PCN)',
    placeholder: '0000-0000-0000-0000',
    re: PHILSYS_PCN_REGEX,
    normalize: normalizePcn,
    verifyHint: 'Scan the QR on PhilSys Check (verify.philsys.gov.ph); the name, birth date and photo must match.',
  },
  passport: {
    label: 'Philippine passport',
    numberLabel: 'Passport number',
    placeholder: 'P1234567A',
    re: /^[A-Z]{1,2}\d{6,7}[A-Z]?$/,
    normalize: upperAlnum,
    verifyHint: 'Check the data page and MRZ are intact and the passport is not expired.',
  },
  drivers_license: {
    label: "Driver's license (LTO)",
    numberLabel: 'License number',
    placeholder: 'A01-23-456789',
    re: /^[A-Z]\d{2}-\d{2}-\d{6}$/,
    normalize: (value) => {
      const v = upperAlnum(value);
      return /^[A-Z]\d{10}$/.test(v) ? `${v.slice(0, 3)}-${v.slice(3, 5)}-${v.slice(5)}` : value.trim().toUpperCase();
    },
    verifyHint: 'Check the license on the LTMS portal or the card QR, and that it is not expired.',
  },
  umid: {
    label: 'UMID card',
    numberLabel: 'CRN',
    placeholder: '0000-0000000-0',
    re: /^\d{4}-\d{7}-\d$/,
    normalize: (value) => regroupDigits(value, [[4, 7, 1]]),
    verifyHint: 'Check the CRN and photo against the SSS or GSIS record.',
  },
  sss: {
    label: 'SSS ID',
    numberLabel: 'SS number',
    placeholder: '00-0000000-0',
    re: /^\d{2}-\d{7}-\d$/,
    normalize: (value) => regroupDigits(value, [[2, 7, 1]]),
    verifyHint: 'Check the SS number against the member record.',
  },
  prc: {
    label: 'PRC professional ID',
    numberLabel: 'Registration number',
    placeholder: '0123456',
    re: /^\d{6,7}$/,
    normalize: (value) => value.replace(/\D/g, ''),
    verifyHint: 'Look the license up on PRC LERIS verification and check it is not expired.',
  },
  postal: {
    label: 'Postal ID',
    numberLabel: 'PRN',
    placeholder: '100141234567P',
    re: /^[A-Z0-9]{12,13}$/,
    normalize: upperAlnum,
    verifyHint: 'Check the PRN and validity date printed on the card.',
  },
  voters: {
    label: "Voter's ID or certificate (COMELEC)",
    numberLabel: 'VIN',
    placeholder: '0000-0000A-A0000AAA00000-0',
    re: /^[A-Z0-9-]{10,30}$/,
    normalize: (value) => value.trim().toUpperCase().replace(/\s+/g, ''),
    verifyHint: 'Check the VIN, name and precinct against the COMELEC record.',
  },
  tin_id: {
    label: 'TIN ID (BIR)',
    numberLabel: 'TIN',
    placeholder: '000-000-000',
    re: TIN_REGEX,
    normalize: normalizeTin,
    verifyHint: 'Check the TIN and name on the BIR record.',
  },
} as const satisfies Record<string, PhIdType>;
export type PhIdTypeCode = keyof typeof PH_ID_TYPES;
export const PH_ID_TYPE_CODES = Object.keys(PH_ID_TYPES) as [PhIdTypeCode, ...PhIdTypeCode[]];
// An upload or row from before QA 15 carries no type: it was a PhilSys card.
export const idTypeOf = (value: unknown): PhIdTypeCode =>
  typeof value === 'string' && value in PH_ID_TYPES ? (value as PhIdTypeCode) : 'philsys';
export const validIdNumber = (type: PhIdTypeCode, value: string) => PH_ID_TYPES[type].re.test(PH_ID_TYPES[type].normalize(value));

// One TIN however it is written: the same 9-digit base, and the same branch
// with a missing branch read as the head office (000 = 00000).
export function sameTin(a: string, b: string): boolean {
  const split = (v: string) => {
    const d = v.replace(/\D/g, '');
    return [d.slice(0, 9), Number(d.slice(9) || '0')] as const;
  };
  const [baseA, branchA] = split(a);
  const [baseB, branchB] = split(b);
  return baseA.length === 9 && baseA === baseB && branchA === branchB;
}

// SEC numbers are typed and OCR'd with stray spaces ("CS 2023 10876",
// "2022090068683 - 02"); the printed number has none.
export const normalizeSecNumber = (value: string) =>
  value.trim().toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');

// The public registries an admin checks a parsed number against. None of
// them take a value in the URL, and each searches differently (checked in
// Chromium, 2026-09): BIR's ORUS splits the TIN into three ### boxes beside
// a registered-name field behind reCAPTCHA, and DTI's BNRS allows an exact
// business-name search only. So the review card copies what each one
// actually accepts as a paste and says how to fill in the rest.
export const REGISTRY_LINKS = {
  sec_certificate: {
    registry: 'SEC',
    url: 'https://checkwithsec.sec.gov.ph/check-with-sec/index',
    copy: 'number',
    hint: 'Paste the SEC number into the search.',
  },
  bir_cor: {
    registry: 'BIR',
    url: 'https://orus.bir.gov.ph/search/tinverification',
    copy: 'name',
    hint: 'Pick Non-Individual, type the TIN into the three boxes, then paste the registered name.',
  },
  dti_certificate: {
    registry: 'DTI',
    url: 'https://bnrs.dti.gov.ph/search',
    copy: 'name',
    hint: 'BNRS searches by exact business name only: paste the registered name.',
  },
} as const;
export type RegistryDocumentType = keyof typeof REGISTRY_LINKS;
export const REGISTRY_DOCUMENT_TYPES = Object.keys(REGISTRY_LINKS) as RegistryDocumentType[];

export type MatchBand = 'mismatch' | 'confirm_manually' | 'strong';

// RFC-2 §3: <0.85 mismatch, 0.85-0.90 confirm_manually, >=0.90 strong. Even
// a "strong" match still requires the human portal-confirm step (§2).
export function matchBand(score: number): MatchBand {
  if (score < 0.85) return 'mismatch';
  if (score < 0.9) return 'confirm_manually';
  return 'strong';
}

// --- Response schemas (egress allowlists). ---

export const KycExtractResponseSchema = z.object({
  kycDocumentId: z.string().uuid(),
  status: z.literal('queued'),
});
export type KycExtractResponse = z.infer<typeof KycExtractResponseSchema>;

export const KycDetailResponseSchema = z.object({
  kycDocumentId: z.string().uuid(),
  status: z.string(),
  extracted: z.object({ secNumber: z.string().nullable(), tin: z.string().nullable() }),
  confidence: z.object({ secNumber: z.number().nullable(), tin: z.number().nullable() }),
  formatValid: z.object({ secNumber: z.boolean(), tin: z.boolean() }),
  portalMatchScore: z.number().nullable(),
  matchBand: z.enum(['mismatch', 'confirm_manually', 'strong']).nullable(),
  registryStatus: z.string().nullable(),
  requiresHumanConfirmation: z.literal(true),
});
export type KycDetailResponse = z.infer<typeof KycDetailResponseSchema>;
