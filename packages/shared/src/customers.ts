import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';
import { DTI_REGEX, idTypeOf, normalizeSecNumber, PH_ID_TYPE_CODES, PH_ID_TYPES, SEC_REGEX, sameTin, validIdNumber } from './kyc.js';
import { PhMobileSchema } from './phone.js';
import { UserPasswordSchema } from './users.js';

// The tenant is the request host's; nothing here names a tenant.
export const CustomerSignupSchema = z.object({
  email: z.string().trim().email().max(254),
  password: UserPasswordSchema,
  acceptedTerms: z.literal(true),
});
export type CustomerSignup = z.infer<typeof CustomerSignupSchema>;

const TinSchema = z
  .string()
  .trim()
  .regex(/^\d{3}-?\d{3}-?\d{3}(-?\d{3}|-?\d{5})?$/, 'TIN is 9, 12 or 14 digits');

export const CompanyCreateSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  tin: TinSchema.optional(),
  secNumber: z.string().trim().regex(SEC_REGEX, 'Not a valid SEC registration number').optional(),
  billingAddress: z.string().trim().min(5).max(500),
  // No name field: the legal name comes only from the staff-confirmed National ID.
  contactMobile: PhMobileSchema,
});
export type CompanyCreate = z.infer<typeof CompanyCreateSchema>;

export const CompanyUpdateSchema = CompanyCreateSchema.pick({
  tin: true,
  secNumber: true,
  billingAddress: true,
})
  .partial()
  .strict();
export type CompanyUpdate = z.infer<typeof CompanyUpdateSchema>;

// 'company_registration' is the pre-split generic upload: readable on old rows, never offered.
export const PRIMARY_REGISTRATION_TYPES = ['bir_cor', 'sec_certificate'] as const;
// Cure papers: shown to the reviewer, never read by OCR.
export const CURE_DOCUMENT_TYPES = [
  'business_permit',
  'sec_good_standing',
  'sec_gis',
  'secretary_certificate',
] as const;
export const COMPANY_DOCUMENT_TYPES = [
  'government_id',
  // Never sent to OCR.
  'selfie_with_id',
  ...PRIMARY_REGISTRATION_TYPES,
  'dti_certificate',
  ...CURE_DOCUMENT_TYPES,
] as const;
export type CompanyDocumentType = (typeof COMPANY_DOCUMENT_TYPES)[number];
export type PrimaryRegistrationType = (typeof PRIMARY_REGISTRATION_TYPES)[number];

export function isOcrDocument(documentType: string): boolean {
  return documentType === 'government_id' || documentType === 'dti_certificate' || isPrimaryRegistration(documentType);
}

export function isPrimaryRegistration(documentType: string): boolean {
  return (
    (PRIMARY_REGISTRATION_TYPES as readonly string[]).includes(documentType) ||
    documentType === 'company_registration'
  );
}

export function hasRequiredCompanyDocuments(documents: { documentType: string }[]): boolean {
  return (
    documents.some((d) => d.documentType === 'government_id') &&
    documents.some((d) => d.documentType === 'selfie_with_id') &&
    documents.some((d) => isPrimaryRegistration(d.documentType))
  );
}

type CompanyIdentity = { companyName: string; tin?: string | null | undefined; secNumber?: string | null | undefined };
export function findSameCompany<T extends CompanyIdentity>(candidate: CompanyIdentity, existing: T[]): T | undefined {
  const name = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  return existing.find(
    (c) =>
      (candidate.tin && c.tin && sameTin(candidate.tin, c.tin)) ||
      (candidate.secNumber && c.secNumber && normalizeSecNumber(candidate.secNumber) === normalizeSecNumber(c.secNumber)) ||
      (name(candidate.companyName).length > 0 && name(candidate.companyName) === name(c.companyName)),
  );
}

export const KYC_REJECTION_REASONS = {
  bir_registration_invalid: {
    label: 'BIR registration not current',
    detail: 'The Form 2303 is outdated or the TIN is not found on BIR ORUS.',
    customer:
      'Update your registration with your BIR RDO (BIR Form 1905), then upload the new Certificate of Registration (Form 2303) and a current Mayor\'s or Business Permit.',
    cure: ['bir_cor', 'business_permit'],
    final: false,
  },
  sec_not_in_good_standing: {
    label: 'SEC registration suspended or revoked',
    detail: 'Check with SEC shows the company as suspended, revoked or delinquent.',
    customer:
      'Have the SEC lift the suspension or revocation, then upload the SEC order lifting it (or a Certificate of Good Standing) and your latest General Information Sheet (GIS) stamped received by the SEC.',
    cure: ['sec_good_standing', 'sec_gis'],
    final: false,
  },
  dti_expired: {
    label: 'DTI business name expired',
    detail: 'The DTI business name registration has lapsed on BNRS.',
    customer: 'Renew your business name on DTI BNRS, then upload the renewed certificate and a current Mayor\'s or Business Permit.',
    cure: ['dti_certificate', 'business_permit'],
    final: false,
  },
  id_not_verified: {
    label: 'ID could not be verified',
    detail: 'The ID did not check out with its issuer (PhilSys Check for the National ID), or it is unreadable or expired.',
    customer:
      "Upload a clear photo of a valid Philippine primary ID (National ID with its QR visible, passport, driver's license, UMID, SSS, PRC, postal, voter's or TIN ID), and a new selfie holding it.",
    cure: ['government_id', 'selfie_with_id'],
    final: false,
  },
  id_holder_mismatch: {
    label: 'Applicant does not match the ID or the company',
    detail: 'The selfie does not match the ID, or the ID holder is not a listed officer of the company.',
    customer:
      'Upload a Secretary\'s Certificate or Board Resolution naming you as authorized to transact for the company (a Special Power of Attorney for sole proprietors), with your National ID and a new selfie holding it.',
    cure: ['secretary_certificate', 'government_id', 'selfie_with_id'],
    final: false,
  },
  document_unreadable: {
    label: 'Document unreadable or incomplete',
    detail: 'A page is cut off, blurred or missing.',
    customer: 'Upload clear, complete copies of the documents listed.',
    cure: [],
    final: false,
  },
  fraudulent: {
    label: 'Tampered or fraudulent document',
    detail: 'A document was altered or does not exist on its registry.',
    customer: 'This registration cannot be approved. Contact the rental team if you believe this is a mistake.',
    cure: [],
    final: true,
  },
} as const satisfies Record<string, { label: string; detail: string; customer: string; cure: readonly CompanyDocumentType[]; final: boolean }>;
export type KycRejectionReason = keyof typeof KYC_REJECTION_REASONS;
export const KYC_REJECTION_REASON_CODES = Object.keys(KYC_REJECTION_REASONS) as [KycRejectionReason, ...KycRejectionReason[]];

export const PHILSYS_CHECK_URL = 'https://verify.philsys.gov.ph';
// Multipart fields, so every value is a string.
export const CompanyDocumentUploadSchema = z
  .object({
    documentType: z.enum(COMPANY_DOCUMENT_TYPES),
    firstName: z.string().trim().min(1).max(200).optional(),
    middleName: z.string().trim().max(200).optional(),
    lastName: z.string().trim().min(1).max(200).optional(),
    idType: z.enum(PH_ID_TYPE_CODES).optional(),
    idNumber: z.string().trim().min(1).max(40).optional(),
    birthDate: z.string().trim().date().optional(),
    sex: z.enum(['M', 'F']).optional(),
    address: z.string().trim().max(500).optional(),
    dtiNumber: z.string().trim().regex(DTI_REGEX, 'Not a valid DTI business name number').optional(),
  })
  .refine(
    (body) => body.documentType !== 'government_id' || (body.idNumber && body.firstName && body.lastName),
    { message: 'Confirm your name and ID number before uploading your ID', path: ['idNumber'] },
  )
  .superRefine((body, ctx) => {
    if (!body.idNumber) return;
    const type = idTypeOf(body.idType);
    if (!validIdNumber(type, body.idNumber)) {
      ctx.addIssue({
        code: 'custom',
        path: ['idNumber'],
        message: `Not a valid ${PH_ID_TYPES[type].numberLabel}: it looks like ${PH_ID_TYPES[type].placeholder}`,
      });
    }
  });
export type CompanyDocumentUpload = z.infer<typeof CompanyDocumentUploadSchema>;

// Evidence, never a decision: staff edit these and approve explicitly (RFC-2).
export const CompanyDocumentReadResponseSchema = z.object({
  documentId: z.string().uuid(),
  suggestions: z.object({
    companyName: z.string().nullable(),
    tin: z.string().nullable(),
    secNumber: z.string().nullable(),
    dtiNumber: z.string().nullable(),
    registeredAddress: z.string().nullable(),
    registrationDate: z.string().nullable(),
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

export const KycScanRequestSchema = z.object({
  documentType: z.enum(COMPANY_DOCUMENT_TYPES),
  idType: z.enum(PH_ID_TYPE_CODES).optional(),
});
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
  confidence: z.number().nullable(),
  extractionAvailable: z.boolean(),
  layoutRecognized: z.boolean().nullable(),
});
export type KycScanResponse = z.infer<typeof KycScanResponseSchema>;

export const CompanyResponseSchema = z.object({
  id: z.string().uuid(),
  companyName: z.string(),
  tin: z.string().nullable(),
  secNumber: z.string().nullable(),
  billingAddress: z.string().nullable(),
  kycStatus: z.string(), // pending | approved | rejected
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  rejection: z
    .object({
      reason: z.enum(KYC_REJECTION_REASON_CODES),
      note: z.string().nullable(),
      cureDocuments: z.array(z.string()),
      rejectedAt: z.coerce.date(),
      final: z.boolean(),
    })
    .nullable(),
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

// Staff-only: never on the customer's own /me responses.
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
  contactPhone: z.string().nullable().optional(),
  // Advisory only; the reviewer decides.
  score: z
    .object({
      score: z.number(),
      band: z.enum(['high', 'medium', 'low']),
      checks: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          weight: z.number(),
          credit: z.number(),
          status: z.enum(['pass', 'warn', 'fail']),
          hard: z.boolean(),
          reason: z.string(),
        }),
      ),
    })
    .optional(),
});
export type CompanyReviewResponse = z.infer<typeof CompanyReviewResponseSchema>;

export interface CompanyReviewListResponse {
  items: CompanyReviewResponse[];
  total: number;
}

export const CustomerSiteCreateSchema = z.object({
  customerId: z.string().uuid(),
  line1: z.string().trim().min(3).max(300),
  barangay: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(120),
  province: z.string().trim().min(2).max(120),
  postalCode: z.string().trim().regex(/^\d{4}$/, 'A Philippine ZIP code is 4 digits').optional(),
  latitude: z.number().finite().min(4).max(22),
  longitude: z.number().finite().min(116).max(128),
});
export type CustomerSiteCreate = z.infer<typeof CustomerSiteCreateSchema>;

export const SITE_PROOF_TYPES = ['building_permit', 'ntp_or_contract', 'lot_title_or_lease', 'barangay_clearance'] as const;
export const SITE_DOCUMENT_TYPES = ['site_photo', ...SITE_PROOF_TYPES] as const;
export type SiteDocumentType = (typeof SITE_DOCUMENT_TYPES)[number];
export const SITE_DOCUMENT_LABELS: Record<SiteDocumentType, string> = {
  site_photo: 'Photo of the site',
  building_permit: 'Building or excavation permit',
  ntp_or_contract: 'Notice to Proceed or construction contract',
  lot_title_or_lease: 'Land title, lease or owner\'s authorization',
  barangay_clearance: 'Barangay clearance for the works',
};
export const SiteDocumentUploadSchema = z.object({ documentType: z.enum(SITE_DOCUMENT_TYPES) });
export type SiteDocumentUpload = z.infer<typeof SiteDocumentUploadSchema>;

export function hasSiteProof(documents: { documentType: string }[]): boolean {
  return (
    documents.some((d) => d.documentType === 'site_photo') &&
    documents.some((d) => (SITE_PROOF_TYPES as readonly string[]).includes(d.documentType))
  );
}

export const SiteDocumentSchema = z.object({
  id: z.string().uuid(),
  documentType: z.string(),
  status: z.string(),
  createdAt: z.coerce.date(),
});
export type SiteDocument = z.infer<typeof SiteDocumentSchema>;

export const CustomerSiteResponseSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  documents: z.array(SiteDocumentSchema),
  proofComplete: z.boolean(),
  line1: z.string().nullable(),
  barangay: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  postalCode: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
});
export type CustomerSiteResponse = z.infer<typeof CustomerSiteResponseSchema>;

export const CompanyReviewQuerySchema = PaginationQuerySchema.extend({
  kycStatus: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});
// One flat object, not a union: a Nest DTO class cannot extend a union.
export const CompanyDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    registryChecked: z.array(z.string().uuid()).max(20).default([]),
    identity: z
      .object({
        philsysVerified: z.literal(true),
        selfieMatches: z.literal(true),
        holderAuthorized: z.literal(true),
      })
      .optional(),
    reason: z.enum(KYC_REJECTION_REASON_CODES).optional(),
    note: z.string().trim().max(1000).optional(),
    cureDocuments: z.array(z.enum(COMPANY_DOCUMENT_TYPES)).max(COMPANY_DOCUMENT_TYPES.length).default([]),
  })
  .refine((body) => body.decision !== 'approved' || body.identity, {
    message: 'Confirm the PhilSys QR, the selfie and the holder before approving',
    path: ['identity'],
  })
  .refine((body) => body.decision !== 'rejected' || body.reason, {
    message: 'A rejection needs a reason',
    path: ['reason'],
  });
export type CompanyDecision = z.infer<typeof CompanyDecisionSchema>;

export function cureDocumentsFor(reason: KycRejectionReason, extra: readonly string[] = []): string[] {
  return [...new Set([...KYC_REJECTION_REASONS[reason].cure, ...extra])];
}
