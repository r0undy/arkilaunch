import { z } from 'zod';
import { DTI_REGEX, PHILSYS_PCN_REGEX, SEC_REGEX } from './kyc.js';

// Customer prerequisites CR: self-signup, companies (Figma 582:3946 "Add
// New Company") and customer-owned project sites.

// POST /auth/register-customer. The storefront tenant is the request host's
// (X-Tenant-Slug); nothing here names a tenant.
export const CustomerSignupSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(200),
  acceptedTerms: z.literal(true),
});
export type CustomerSignup = z.infer<typeof CustomerSignupSchema>;

// Loose PH TIN shape: 9 or 12 digits, dashes optional (000-000-000[-000]).
const TinSchema = z
  .string()
  .trim()
  .regex(/^\d{3}-?\d{3}-?\d{3}(-?\d{3})?$/, 'TIN is 9 or 12 digits');

export const CompanyCreateSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  // Each number comes from the paper that carries it: the TIN off the BIR
  // Form 2303, the SEC number off the SEC certificate. A company registered
  // with SEC papers only has no 2303 to read a TIN from, so neither is
  // required here; the DTI number rides on the DTI document upload.
  tin: TinSchema.optional(),
  secNumber: z.string().trim().regex(SEC_REGEX, 'Not a valid SEC registration number').optional(),
  billingAddress: z.string().trim().min(5).max(500),
  // No name field here: the customer's legal name comes only from their
  // National ID scan, read by staff and confirmed on approval (decide()).
  contactMobile: z.string().trim().min(7).max(30),
});
export type CompanyCreate = z.infer<typeof CompanyCreateSchema>;

// PATCH /me/companies/:id. The name is not editable (it is what was
// registered and verified); TIN and SEC are refused by the service once the
// company is approved.
export const CompanyUpdateSchema = CompanyCreateSchema.pick({
  tin: true,
  secNumber: true,
  billingAddress: true,
})
  .partial()
  .strict();
export type CompanyUpdate = z.infer<typeof CompanyUpdateSchema>;

// Primary proof of registration is the BIR Certificate of Registration
// (Form 2303) or the SEC certificate; DTI business-name registration is a
// secondary, optional paper (sole proprietors). 'company_registration' is
// the pre-split generic upload, still readable on old rows, never offered.
// docs/cr-arkilaunch-truck-booking-and-kyc-docs.md.
export const PRIMARY_REGISTRATION_TYPES = ['bir_cor', 'sec_certificate'] as const;
// Supporting papers (CR pricebook-kyc-weather). A selfie holding the ID
// lets a reviewer match the face to the PhilSys card; the rest are what a
// rejected company uploads to prove it is legitimate (CURE_DOCUMENTS).
export const SUPPORTING_DOCUMENT_TYPES = [
  'selfie_with_id',
  'bir_1905',
  'sec_good_standing',
  'sec_lifting_order',
  'sec_gis',
  'business_permit',
  'audited_fs',
] as const;
export const COMPANY_DOCUMENT_TYPES = [
  'government_id',
  ...PRIMARY_REGISTRATION_TYPES,
  'dti_certificate',
  ...SUPPORTING_DOCUMENT_TYPES,
] as const;
export type CompanyDocumentType = (typeof COMPANY_DOCUMENT_TYPES)[number];

// Why a reviewer rejects a company. Each reason but a fraudulent document
// can be cured: the customer uploads at least one of its cure documents and
// reapplies, and the new application goes back to the pending queue for a
// fresh approve-or-reject. A tampered or fake document is final.
export const REJECTION_REASONS = [
  'bir_expired_or_invalid',
  'sec_suspended_or_revoked',
  'id_mismatch',
  'document_unreadable',
  'fraudulent_document',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  bir_expired_or_invalid: 'BIR registration expired, outdated or not found on ORUS',
  sec_suspended_or_revoked: 'SEC registration suspended, revoked or delinquent',
  id_mismatch: 'National ID does not match the company signatory, or could not be verified',
  document_unreadable: 'A document is unreadable, cropped or incomplete',
  fraudulent_document: 'A document appears altered or fake (final, cannot reapply)',
};
// What cures each reason. required: at least one must be uploaded after the
// rejection before the customer can reapply. optional: strengthens the case.
export const CURE_DOCUMENTS: Record<RejectionReason, { required: CompanyDocumentType[]; optional: CompanyDocumentType[] }> = {
  bir_expired_or_invalid: { required: ['bir_cor'], optional: ['bir_1905', 'business_permit', 'audited_fs'] },
  sec_suspended_or_revoked: { required: ['sec_lifting_order', 'sec_good_standing'], optional: ['sec_gis', 'business_permit', 'audited_fs'] },
  id_mismatch: { required: ['government_id', 'selfie_with_id'], optional: ['sec_gis'] },
  document_unreadable: { required: ['government_id', 'bir_cor', 'sec_certificate', 'dti_certificate'], optional: [] },
  fraudulent_document: { required: [], optional: [] },
};
export type PrimaryRegistrationType = (typeof PRIMARY_REGISTRATION_TYPES)[number];

export function isPrimaryRegistration(documentType: string): boolean {
  return (
    (PRIMARY_REGISTRATION_TYPES as readonly string[]).includes(documentType) ||
    documentType === 'company_registration'
  );
}

// Complete = the applicant's ID plus one primary registration. DTI never
// counts toward it.
export function hasRequiredCompanyDocuments(documents: { documentType: string }[]): boolean {
  return (
    documents.some((d) => d.documentType === 'government_id') &&
    documents.some((d) => isPrimaryRegistration(d.documentType))
  );
}
// What the customer confirmed they read off the document, sent with the
// upload and kept on the row beside the raw OCR (as customer_* keys) so the
// reviewer sees both. Multipart fields, so every value is a string.
export const CompanyDocumentUploadSchema = z
  .object({
    documentType: z.enum(COMPANY_DOCUMENT_TYPES),
    firstName: z.string().trim().min(1).max(200).optional(),
    middleName: z.string().trim().max(200).optional(),
    lastName: z.string().trim().min(1).max(200).optional(),
    idNumber: z.string().trim().regex(PHILSYS_PCN_REGEX, 'PCN is 16 digits: 0000-0000-0000-0000').optional(),
    birthDate: z.string().trim().date().optional(),
    sex: z.enum(['M', 'F']).optional(),
    address: z.string().trim().max(500).optional(),
    dtiNumber: z.string().trim().regex(DTI_REGEX, 'Not a valid DTI business name number').optional(),
  })
  // The customer must check their ID before it reaches a reviewer: an ID
  // upload without the confirmed name and PCN is refused, not queued.
  .refine(
    (body) => body.documentType !== 'government_id' || (body.idNumber && body.firstName && body.lastName),
    { message: 'Confirm your name and PCN before uploading the National ID', path: ['idNumber'] },
  );
export type CompanyDocumentUpload = z.infer<typeof CompanyDocumentUploadSchema>;

// POST /me/kyc/scan. Suggestions a customer can edit before they submit
// the form -- never a verification decision, and never stored as fact: the
// staff review queue and RFC-2's human gate are untouched by this.
// POST /customers/:id/documents/:documentId/read. What the reviewer's
// "Read document" click found, persisted on the document as evidence. Never
// a decision: staff edit these and approve explicitly.
export const CompanyDocumentReadResponseSchema = z.object({
  documentId: z.string().uuid(),
  suggestions: z.object({
    companyName: z.string().nullable(),
    tin: z.string().nullable(),
    secNumber: z.string().nullable(),
    dtiNumber: z.string().nullable(),
    registeredAddress: z.string().nullable(),
    registrationDate: z.string().nullable(),
    // Populated instead of the company fields above when the document read
    // is the National ID, not the registration certificate.
    firstName: z.string().nullable(),
    middleName: z.string().nullable(),
    lastName: z.string().nullable(),
    idNumber: z.string().nullable(),
    birthDate: z.string().nullable(),
    sex: z.string().nullable(),
    address: z.string().nullable(),
  }),
  formatValid: z.object({
    tin: z.boolean(),
    secNumber: z.boolean(),
    dtiNumber: z.boolean(),
    idNumber: z.boolean(),
  }),
  confidence: z.number().nullable(),
  extractionAvailable: z.boolean(),
});
export type CompanyDocumentReadResponse = z.infer<typeof CompanyDocumentReadResponseSchema>;

// Only the fields the scanned document type actually carries are filled
// (SCAN_FIELDS); the rest are null, so a SEC certificate never suggests a
// TIN it does not print.
export const KycScanRequestSchema = z.object({ documentType: z.enum(COMPANY_DOCUMENT_TYPES) });
export const KycScanResponseSchema = z.object({
  suggestions: z.object({
    companyName: z.string().nullable(),
    tin: z.string().nullable(),
    secNumber: z.string().nullable(),
    dtiNumber: z.string().nullable(),
    address: z.string().nullable(),
    firstName: z.string().nullable(),
    middleName: z.string().nullable(),
    lastName: z.string().nullable(),
    idNumber: z.string().nullable(),
    birthDate: z.string().nullable(),
    sex: z.string().nullable(),
  }),
  // The weakest field's confidence, so the page can ask for a retake before
  // the upload-time gate bounces the document.
  confidence: z.number().nullable(),
  extractionAvailable: z.boolean(),
});
export type KycScanResponse = z.infer<typeof KycScanResponseSchema>;

export const CompanyResponseSchema = z.object({
  id: z.string().uuid(),
  companyName: z.string(),
  tin: z.string().nullable(),
  secNumber: z.string().nullable(),
  billingAddress: z.string().nullable(),
  kycStatus: z.string(), // pending | approved | rejected
  // The staff-confirmed legal name off the National ID, read from the
  // linked user's account. Null until an admin approves one.
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  // A reviewer's note on a pending company, and what it unlocked for the
  // customer to fix (UNLOCKABLE_FIELDS). Nothing else is editable once the
  // documents are in.
  reviewComment: z.string().nullable(),
  unlockedFields: z.array(z.string()),
  // Set on a rejected company: why, and when (a cure document must be
  // uploaded after this to reapply). reviewComment carries the note.
  rejectionReason: z.enum(REJECTION_REASONS).nullable(),
  rejectedAt: z.coerce.date().nullable(),
  documents: z.array(
    z.object({
      id: z.string().uuid(),
      documentType: z.string(),
      status: z.string(),
      createdAt: z.coerce.date(),
    }),
  ),
  createdAt: z.coerce.date(),
});
export type CompanyResponse = z.infer<typeof CompanyResponseSchema>;

// GET /customers/review. The staff queue sees what each document says
// without clicking anything: the stored upload-time OCR and what the
// customer confirmed, both keyed by the snake_case port keys (tin,
// sec_number, id_number, ...). Never on the customer's own /me responses.
export const CompanyReviewResponseSchema = CompanyResponseSchema.extend({
  documents: z.array(
    z.object({
      id: z.string().uuid(),
      documentType: z.string(),
      status: z.string(),
      createdAt: z.coerce.date(),
      confidence: z.number().nullable(),
      ocr: z.record(z.string(), z.string()),
      customer: z.record(z.string(), z.string()),
      registryChecked: z.boolean(),
    }),
  ),
});
export type CompanyReviewResponse = z.infer<typeof CompanyReviewResponseSchema>;

export const CustomerSiteCreateSchema = z.object({
  customerId: z.string().uuid(),
  line1: z.string().trim().min(3).max(300),
  barangay: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(120),
  province: z.string().trim().min(2).max(120),
  postalCode: z.string().trim().regex(/^\d{4}$/, 'A Philippine ZIP code is 4 digits').optional(),
  // The Philippines, with margin: a pin outside it is a slipped click.
  latitude: z.number().finite().min(4).max(22),
  longitude: z.number().finite().min(116).max(128),
});
export type CustomerSiteCreate = z.infer<typeof CustomerSiteCreateSchema>;

export const CustomerSiteResponseSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  line1: z.string().nullable(),
  barangay: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  postalCode: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
});
export type CustomerSiteResponse = z.infer<typeof CustomerSiteResponseSchema>;

// Staff verification queue.
export const CompanyReviewQuerySchema = z.object({
  kycStatus: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});

// A reviewer may correct what the document says before approving. The
// corrections are the human's, not the OCR's: they are what gets written
// onto the company, and approval still requires this explicit call.
// The reviewer approves or rejects what the customer submitted; they never
// edit it (CR pricebook-kyc-weather). A wrong value is a rejection with a
// reason, which tells the customer what to upload to reapply.
export const CompanyDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    // The SEC/BIR/DTI documents the reviewer ticked as checked on the public
    // registry. Approval is refused unless every such document is listed.
    registryChecked: z.array(z.string().uuid()).max(20).optional(),
    // The reviewer verified the PhilSys QR, compared the selfie with the ID,
    // and matched the holder's name to the registration. Required to approve.
    identityChecked: z.boolean().optional(),
    rejectionReason: z.enum(REJECTION_REASONS).optional(),
    rejectionNote: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.decision !== 'rejected' || d.rejectionReason, {
    message: 'A rejection needs a reason',
    path: ['rejectionReason'],
  });
export type CompanyDecision = z.infer<typeof CompanyDecisionSchema>;
