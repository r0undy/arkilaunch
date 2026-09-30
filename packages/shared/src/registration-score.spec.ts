import { describe, expect, it } from 'vitest';
import { nameSimilarity, scoreRegistration, type ScoreInput } from './registration-score.js';

const clean = (): ScoreInput => ({
  companyName: 'Acme Builders Inc.',
  tin: '123-456-789-000',
  secNumber: 'CS201912345',
  today: '2026-09-27',
  duplicates: { tin: false, pcn: false, mobile: false },
  documents: [
    {
      documentType: 'sec_certificate',
      confidence: 0.96,
      ocr: { company_name: 'ACME BUILDERS INC', sec_number: 'CS201912345' },
      customer: {},
    },
    {
      documentType: 'government_id',
      confidence: 0.94,
      ocr: { first_name: 'JUAN', last_name: 'DELA CRUZ', id_number: '1234 5678 9012 3456', birth_date: '1985-04-02' },
      customer: { first_name: 'Juan', last_name: 'Dela Cruz', id_number: '1234-5678-9012-3456', birth_date: '1985-04-02' },
    },
  ],
});

describe('scoreRegistration', () => {
  it('scores a clean, complete application High with every check passing', () => {
    const s = scoreRegistration(clean());
    expect(s.band).toBe('high');
    expect(s.score).toBeGreaterThanOrEqual(85);
    expect(s.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('caps at Low on a hard failure: a duplicate TIN', () => {
    const s = scoreRegistration({ ...clean(), duplicates: { tin: true, pcn: false, mobile: false } });
    expect(s.band).toBe('low');
    expect(s.checks.find((c) => c.id === 'duplicates')).toMatchObject({ status: 'fail', hard: true });
  });

  it('caps at Low on an invalid ID format', () => {
    const s = scoreRegistration({ ...clean(), tin: '12-34' });
    expect(s.band).toBe('low');
    expect(s.checks.find((c) => c.id === 'id_formats')?.reason).toContain('TIN');
  });

  it('names the field that disagrees with its scan', () => {
    const input = clean();
    input.documents[1]!.customer.last_name = 'Santos';
    const s = scoreRegistration(input);
    const agreement = s.checks.find((c) => c.id === 'agreement')!;
    expect(agreement.status).toBe('warn');
    expect(agreement.reason).toContain('last name');
    expect(s.score).toBeLessThan(scoreRegistration(clean()).score);
  });

  it('flags an implausible age and missing documents', () => {
    const input = clean();
    input.documents[1]!.customer.birth_date = '2015-01-01';
    input.documents = input.documents.filter((d) => d.documentType === 'government_id');
    const s = scoreRegistration(input);
    expect(s.checks.find((c) => c.id === 'dob')?.status).toBe('fail');
    expect(s.checks.find((c) => c.id === 'doc_quality')?.status).toBe('fail');
  });
});

describe('nameSimilarity', () => {
  it('ignores word order, case and punctuation', () => {
    expect(nameSimilarity('Dela Cruz, Juan', 'JUAN DELA CRUZ')).toBe(1);
    expect(nameSimilarity('Acme Builders Inc.', 'ACME BUILDERS INC')).toBe(1);
    expect(nameSimilarity('Acme Builders', 'Zenith Holdings')).toBeLessThan(0.85);
  });
});
