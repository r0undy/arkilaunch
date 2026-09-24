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
export const TIN_REGEX = /^\d{3}-\d{3}-\d{3}(-\d{3})?$/;
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
export const normalizeTin = (value: string) => regroupDigits(value, [[3, 3, 3], [3, 3, 3, 3]]);
export const normalizePcn = (value: string) => regroupDigits(value, [[4, 4, 4, 4]]);

// The public registries an admin checks a parsed number against. None of
// them take the number in the URL (BIR's ORUS is CAPTCHA-gated by design),
// so the review card copies the value and opens the page for a human paste.
export const REGISTRY_LINKS = {
  sec_certificate: { registry: 'SEC', url: 'https://checkwithsec.sec.gov.ph/check-with-sec/index' },
  bir_cor: { registry: 'BIR', url: 'https://orus.bir.gov.ph/search/tinverification' },
  dti_certificate: { registry: 'DTI', url: 'https://bnrs.dti.gov.ph/search' },
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
