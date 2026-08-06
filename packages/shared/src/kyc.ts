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
export const SEC_REGEX = /^[A-Za-z0-9-]{7,15}$/;

export type MatchBand = 'mismatch' | 'confirm_manually' | 'strong';

// RFC-2 §3: <0.85 mismatch, 0.85-0.90 confirm_manually, >=0.90 strong. Even
// a "strong" match still requires the human portal-confirm step (§2).
export function matchBand(score: number): MatchBand {
  if (score < 0.85) return 'mismatch';
  if (score < 0.9) return 'confirm_manually';
  return 'strong';
}
