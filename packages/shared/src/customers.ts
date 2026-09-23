import { z } from 'zod';

// Customer prerequisites CR: self-signup, companies (Figma 582:3946 "Add
// New Company") and customer-owned project sites.

// POST /auth/register-customer. The storefront tenant is the API's
// ANCHOR_TENANT_SLUG; nothing here names a tenant.
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
  tin: TinSchema,
  billingAddress: z.string().trim().min(5).max(500),
  // No name field here: the customer's legal name comes only from their
  // National ID scan, read by staff and confirmed on approval (decide()).
  contactMobile: z.string().trim().min(7).max(30),
});
export type CompanyCreate = z.infer<typeof CompanyCreateSchema>;

export const COMPANY_DOCUMENT_TYPES = ['government_id', 'company_registration'] as const;
export const CompanyDocumentUploadSchema = z.object({
  documentType: z.enum(COMPANY_DOCUMENT_TYPES),
});

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
    // Populated instead of the company fields above when the document read
    // is the National ID, not the registration certificate.
    firstName: z.string().nullable(),
    middleName: z.string().nullable(),
    lastName: z.string().nullable(),
  }),
  formatValid: z.object({ tin: z.boolean(), secNumber: z.boolean() }),
  confidence: z.number().nullable(),
  extractionAvailable: z.boolean(),
});
export type CompanyDocumentReadResponse = z.infer<typeof CompanyDocumentReadResponseSchema>;

export const KycScanResponseSchema = z.object({
  suggestions: z.object({
    companyName: z.string().nullable(),
    tin: z.string().nullable(),
    secNumber: z.string().nullable(),
  }),
  extractionAvailable: z.boolean(),
});
export type KycScanResponse = z.infer<typeof KycScanResponseSchema>;

export const CompanyResponseSchema = z.object({
  id: z.string().uuid(),
  companyName: z.string(),
  tin: z.string().nullable(),
  billingAddress: z.string().nullable(),
  kycStatus: z.string(), // pending | approved | rejected
  // The staff-confirmed legal name off the National ID, read from the
  // linked user's account. Null until an admin approves one.
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
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

export const CustomerSiteCreateSchema = z.object({
  customerId: z.string().uuid(),
  line1: z.string().trim().min(3).max(300),
  city: z.string().trim().min(2).max(120),
  province: z.string().trim().min(2).max(120),
  // The Philippines, with margin: a pin outside it is a slipped click.
  latitude: z.number().finite().min(4).max(22),
  longitude: z.number().finite().min(116).max(128),
});
export type CustomerSiteCreate = z.infer<typeof CustomerSiteCreateSchema>;

export const CustomerSiteResponseSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  line1: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
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
export const CompanyDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  companyName: z.string().trim().min(2).max(200).optional(),
  tin: TinSchema.optional(),
  secNumber: z.string().trim().max(50).optional(),
  // The reviewer-confirmed legal name off the National ID. Written onto the
  // customer's user account only on approval, same human gate as above.
  firstName: z.string().trim().min(1).max(200).optional(),
  middleName: z.string().trim().max(200).optional(),
  lastName: z.string().trim().min(1).max(200).optional(),
});
export type CompanyDecision = z.infer<typeof CompanyDecisionSchema>;
