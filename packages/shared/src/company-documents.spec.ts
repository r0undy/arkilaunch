import { describe, expect, it } from 'vitest';
import {
  CompanyDecisionSchema,
  CompanyDocumentUploadSchema,
  cureDocumentsFor,
  hasRequiredCompanyDocuments,
  isPrimaryRegistration,
  KYC_REJECTION_REASONS,
} from './customers.js';

const docs = (...types: string[]) => types.map((documentType) => ({ documentType }));

describe('company documents (CR truck-booking-and-kyc-docs)', () => {
  it('needs the ID plus a BIR COR or SEC certificate; no selfie', () => {
    expect(hasRequiredCompanyDocuments(docs('government_id', 'bir_cor'))).toBe(true);
    expect(hasRequiredCompanyDocuments(docs('government_id', 'sec_certificate'))).toBe(true);
    expect(hasRequiredCompanyDocuments(docs('sec_certificate'))).toBe(false);
    expect(hasRequiredCompanyDocuments(docs('government_id'))).toBe(false);
    expect(hasRequiredCompanyDocuments(docs('government_id', 'company_registration'))).toBe(true); // legacy
  });

  it('never accepts DTI alone as the primary registration', () => {
    expect(isPrimaryRegistration('dti_certificate')).toBe(false);
    expect(hasRequiredCompanyDocuments(docs('government_id', 'dti_certificate'))).toBe(false);
    expect(hasRequiredCompanyDocuments(docs('bir_cor', 'dti_certificate'))).toBe(false);
  });
});

describe('CompanyDocumentUploadSchema (customer-confirmed fields)', () => {
  const ok = (body: Record<string, string>) => CompanyDocumentUploadSchema.safeParse(body).success;

  it('refuses a National ID upload the customer has not confirmed', () => {
    expect(ok({ documentType: 'government_id' })).toBe(false);
    expect(ok({ documentType: 'government_id', firstName: 'Juan', lastName: 'Cruz' })).toBe(false);
    expect(
      ok({ documentType: 'government_id', firstName: 'Juan', lastName: 'Cruz', idNumber: '1234-5678-9012-3456' }),
    ).toBe(true);
  });

  it('refuses a malformed PCN, birth date or DTI number', () => {
    const id = { documentType: 'government_id', firstName: 'Juan', lastName: 'Cruz' };
    expect(ok({ ...id, idNumber: '1234' })).toBe(false);
    expect(ok({ ...id, idNumber: '1234-5678-9012-3456', birthDate: 'January 2' })).toBe(false);
    expect(ok({ documentType: 'dti_certificate', dtiNumber: 'CS202312345' })).toBe(false);
    expect(ok({ documentType: 'dti_certificate', dtiNumber: '1234567' })).toBe(true);
  });

  it('asks nothing extra of the company papers', () => {
    expect(ok({ documentType: 'bir_cor' })).toBe(true);
    expect(ok({ documentType: 'sec_certificate' })).toBe(true);
  });
});

describe('registration review: approve or reject (CR pricebook-kyc-weather)', () => {
  const parse = (body: Record<string, unknown>) => CompanyDecisionSchema.safeParse(body).success;

  it('approves only with both identity checks', () => {
    expect(parse({ decision: 'approved' })).toBe(false);
    expect(parse({ decision: 'approved', identity: { philsysVerified: true, holderAuthorized: false } })).toBe(false);
    expect(parse({ decision: 'approved', identity: { philsysVerified: true, holderAuthorized: true } })).toBe(true);
  });

  it('rejects only with a reason, and never carries edits to what the customer sent', () => {
    expect(parse({ decision: 'rejected' })).toBe(false);
    expect(parse({ decision: 'rejected', reason: 'sec_not_in_good_standing' })).toBe(true);
    expect(CompanyDecisionSchema.parse({ decision: 'rejected', reason: 'dti_expired', companyName: 'Edited' })).not.toHaveProperty('companyName');
  });

  it('asks for the papers that cure each reason', () => {
    expect(cureDocumentsFor('bir_registration_invalid')).toEqual(['bir_cor', 'business_permit']);
    expect(cureDocumentsFor('sec_not_in_good_standing')).toEqual(['sec_good_standing', 'sec_gis']);
    expect(cureDocumentsFor('document_unreadable', ['government_id'])).toEqual(['government_id']);
    expect(KYC_REJECTION_REASONS.fraudulent.final).toBe(true);
    expect(cureDocumentsFor('fraudulent')).toEqual([]);
  });
});
