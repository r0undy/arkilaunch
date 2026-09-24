import { describe, expect, it } from 'vitest';
import { hasRequiredCompanyDocuments, isPrimaryRegistration } from './customers.js';

const docs = (...types: string[]) => types.map((documentType) => ({ documentType }));

describe('company documents (CR truck-booking-and-kyc-docs)', () => {
  it('needs the ID plus a BIR COR or SEC certificate', () => {
    expect(hasRequiredCompanyDocuments(docs('government_id', 'bir_cor'))).toBe(true);
    expect(hasRequiredCompanyDocuments(docs('government_id', 'sec_certificate'))).toBe(true);
    expect(hasRequiredCompanyDocuments(docs('government_id', 'company_registration'))).toBe(true); // legacy
  });

  it('never accepts DTI alone as the primary registration', () => {
    expect(isPrimaryRegistration('dti_certificate')).toBe(false);
    expect(hasRequiredCompanyDocuments(docs('government_id', 'dti_certificate'))).toBe(false);
    expect(hasRequiredCompanyDocuments(docs('bir_cor', 'dti_certificate'))).toBe(false);
  });
});
