import { z } from 'zod';

export const KycExtractRequestSchema = z.object({
  customerId: z.string().uuid(),
  documentType: z.string().min(1),
  fileUri: z.string().min(1),
});
export type KycExtractRequest = z.infer<typeof KycExtractRequestSchema>;

// No fileUri: the controller derives it from the upload; a client can never supply it.
export const KycExtractFieldsSchema = z.object({
  customerId: z.string().uuid(),
  documentType: z.string().min(1),
});
export type KycExtractFields = z.infer<typeof KycExtractFieldsSchema>;

// Always a human's reading of the SEC/BIR portals (CAPTCHA by design), never a scraped value.
export const KycConfirmRequestSchema = z.object({
  registryStatus: z.enum(['active', 'suspended', 'revoked']),
  portalMatchScore: z.number().min(0).max(1),
});
export type KycConfirmRequest = z.infer<typeof KycConfirmRequestSchema>;

export const TIN_REGEX = /^\d{3}-\d{3}-\d{3}(-\d{3}|-\d{5})?$/;
// ponytail: prefix list is not exhaustive; widen only on a real rejected cert.
export const SEC_REGEX = /^(?:[A-Z]{1,3}\d{3}-?\d{4,9}|\d{10,13}(?:-\d{2})?)$/i;
// ponytail: checked against the BNRS sample layout only; tighten on real certs.
export const DTI_REGEX = /^(?:BN-?)?\d{6,10}$/i;
export const PHILSYS_PCN_REGEX = /^\d{4}-\d{4}-\d{4}-\d{4}$/;

function regroupDigits(value: string, groupings: number[][]): string {
  const digits = value.replace(/\D/g, '');
  const groups = groupings.find((g) => g.reduce((a, b) => a + b, 0) === digits.length);
  if (!groups) return value.trim();
  let at = 0;
  return groups.map((n) => digits.slice(at, (at += n))).join('-');
}
export const normalizeTin = (value: string) => regroupDigits(value, [[3, 3, 3], [3, 3, 3, 3], [3, 3, 3, 5]]);
export const normalizePcn = (value: string) => regroupDigits(value, [[4, 4, 4, 4]]);

// ponytail: formats are the numbers as printed on current cards; widen one
// on a real card that fails, never drop the check.
const upperAlnum = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
export interface PhIdType {
  label: string;
  numberLabel: string;
  placeholder: string;
  re: RegExp;
  normalize: (value: string) => string;
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

export function sameTin(a: string, b: string): boolean {
  const split = (v: string) => {
    const d = v.replace(/\D/g, '');
    return [d.slice(0, 9), Number(d.slice(9) || '0')] as const;
  };
  const [baseA, branchA] = split(a);
  const [baseB, branchB] = split(b);
  return baseA.length === 9 && baseA === baseB && branchA === branchB;
}

export const normalizeSecNumber = (value: string) =>
  value.trim().toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');

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

// Even a "strong" match still requires the human portal-confirm step (RFC-2).
export function matchBand(score: number): MatchBand {
  if (score < 0.85) return 'mismatch';
  if (score < 0.9) return 'confirm_manually';
  return 'strong';
}

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
