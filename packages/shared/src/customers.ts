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
export const COMPANY_DOCUMENT_TYPES = [
  'government_id',
  ...PRIMARY_REGISTRATION_TYPES,
  'dti_certificate',
] as const;
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
  // On a rejected company, the reviewer's reason and what would cure it.
  // unlockedFields is legacy: reviewers no longer unlock anything, so
  // nothing is editable once the documents are in.
  reviewComment: z.string().nullable(),
  unlockedFields: z.array(z.string()),
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
// What the customer may change on a company the customer-side form reads.
// Reviewers no longer unlock anything (the review is approve or reject), so
// in practice nothing is unlocked once the documents are in.
export const UNLOCKABLE_COMPANY_FIELDS = ['tin', 'secNumber', 'billingAddress'] as const;

// Why a reviewer rejected a company, and what the customer should bring to
// a fresh registration to cure it. A rejection is final for that record:
// the customer registers the company anew with valid papers. The reason is
// required so the customer always knows what to fix.
export const REJECTION_REASONS = {
  bir_cor_invalid: {
    label: 'BIR Certificate of Registration outdated or not matching ORUS',
    cure: "An updated BIR Form 2303 (reissued after any change in address, line of business or tax type) that matches the BIR ORUS record.",
  },
  sec_not_active: {
    label: 'SEC status suspended, revoked or delinquent',
    cure: 'An SEC Certificate of Good Standing, or the SEC Order lifting the suspension or revocation, with the latest General Information Sheet (GIS) and its SEC filing acknowledgement.',
  },
  dti_expired: {
    label: 'DTI business name registration expired',
    cure: 'The renewed DTI Business Name Certificate, valid today.',
  },
  registry_mismatch: {
    label: 'Details do not match the public registry',
    cure: 'Documents whose registered name, TIN and registration number match the SEC, BIR and DTI records exactly, or the amended certificate if the name changed.',
  },
  id_invalid: {
    label: 'National ID unreadable, altered or not matching the registrant',
    cure: "A clear photo of the PhilSys ID or ePhilID (QR visible) of the owner or an authorized officer, with a Secretary's Certificate or board resolution naming them if they are not the owner.",
  },
  document_unreadable: {
    label: 'Document unreadable, cropped or incomplete',
    cure: 'A full, uncropped, readable scan of every page of the same documents.',
  },
  other: {
    label: 'Other',
    cure: 'See the note from the rental team.',
  },
} as const;
export type RejectionReason = keyof typeof REJECTION_REASONS;
export const REJECTION_REASON_CODES = Object.keys(REJECTION_REASONS) as [RejectionReason, ...RejectionReason[]];

// PATCH /customers/:id/kyc. The reviewer decides on what the customer
// submitted and never edits it: approval writes the customer's own values,
// and a rejection must say why ('other' must also say what).
export const CompanyDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    // The SEC/BIR/DTI documents the reviewer ticked as checked on the public
    // registry. Approval is refused unless every such document is listed.
    registryChecked: z.array(z.string().uuid()).max(20).optional(),
    rejectionReason: z.enum(REJECTION_REASON_CODES).optional(),
    rejectionNote: z.string().trim().max(1000).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.decision !== 'rejected') return;
    if (!body.rejectionReason)
      ctx.addIssue({ code: 'custom', path: ['rejectionReason'], message: 'A rejection needs a reason.' });
    if (body.rejectionReason === 'other' && !body.rejectionNote)
      ctx.addIssue({ code: 'custom', path: ['rejectionNote'], message: 'Say what is wrong.' });
  });
export type CompanyDecision = z.infer<typeof CompanyDecisionSchema>;
